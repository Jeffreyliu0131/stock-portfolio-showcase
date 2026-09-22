export type BoundedJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly reason: "UNSUPPORTED_MEDIA_TYPE" | "TOO_LARGE" | "INVALID_JSON";
    };

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/**
 * Rejects browser cross-site requests while continuing to allow non-browser
 * operational smoke tests that do not send Fetch Metadata or Origin headers.
 * This is a CSRF/browser-abuse boundary, not an authentication mechanism.
 */
export function requestIsSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin === null) {
    return true;
  }

  try {
    const requestUrl = new URL(request.url);
    const host =
      firstForwardedValue(request.headers.get("x-forwarded-host")) ??
      request.headers.get("host");
    const forwardedProto = firstForwardedValue(
      request.headers.get("x-forwarded-proto"),
    );
    const protocol = forwardedProto
      ? `${forwardedProto.replace(/:$/, "")}:`
      : requestUrl.protocol;
    const expectedOrigin = host ? `${protocol}//${host}` : requestUrl.origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

/**
 * Keeps raw client addresses out of process state while providing a stable
 * best-effort key for per-instance abuse controls.
 */
export async function callerKey(request: Request): Promise<string> {
  const address =
    firstForwardedValue(request.headers.get("x-forwarded-for")) ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function declaredLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) {
    return null;
  }
  if (!/^\d+$/.test(value.trim())) {
    return Number.NaN;
  }
  return Number(value);
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      length += result.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } catch {
    return new Uint8Array();
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJsonResult> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer");
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false, reason: "UNSUPPORTED_MEDIA_TYPE" };
  }

  const length = declaredLength(request);
  if (
    (length !== null && !Number.isSafeInteger(length)) ||
    (length !== null && length > maximumBytes)
  ) {
    return { ok: false, reason: "TOO_LARGE" };
  }

  const bytes = await readBoundedBody(request, maximumBytes);
  if (bytes === null) {
    return { ok: false, reason: "TOO_LARGE" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "INVALID_JSON" };
  }
}
