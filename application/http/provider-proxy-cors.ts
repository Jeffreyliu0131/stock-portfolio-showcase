import { requestIsSameOrigin } from "./request-security.ts";
import { SITES_APP_ORIGIN } from "./provider-proxy-contract.ts";

function requestOrigin(request: Request): string | null {
  const value = request.headers.get("origin");
  if (value === null) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function requestIsAllowedProviderClient(request: Request): boolean {
  return (
    requestIsSameOrigin(request) || requestOrigin(request) === SITES_APP_ORIGIN
  );
}

export function providerCorsHeaders(
  request: Request,
): Readonly<Record<string, string>> {
  return requestOrigin(request) === SITES_APP_ORIGIN
    ? {
        "Access-Control-Allow-Origin": SITES_APP_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Expose-Headers": "Retry-After",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : {};
}

export function providerCorsPreflight(
  request: Request,
  allowedMethod: "GET" | "POST",
): Response {
  const requestedMethod = request.headers.get(
    "access-control-request-method",
  );
  const requestedHeaders = (
    request.headers.get("access-control-request-headers") ?? ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    requestOrigin(request) !== SITES_APP_ORIGIN ||
    requestedMethod !== allowedMethod ||
    requestedHeaders.some((header) => header !== "content-type")
  ) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: providerCorsHeaders(request),
  });
}
