import type {
  InstrumentApiErrorCode,
  InstrumentApiResponse,
  InstrumentApiSuccess,
} from "../instrument-api.ts";
import {
  isVercelProviderUrl,
  providerApiUrl,
} from "../../http/provider-proxy-contract.ts";

export class InstrumentClientError extends Error {
  readonly code: InstrumentApiErrorCode | "INVALID_RESPONSE";

  constructor(
    code: InstrumentApiErrorCode | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "InstrumentClientError";
    this.code = code;
  }
}

export async function requestInstrumentResolution(
  symbol: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<InstrumentApiSuccess> {
  let response: Response;
  try {
    const url = providerApiUrl("/api/instruments/resolve");
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbol }),
      cache: "no-store",
      ...(isVercelProviderUrl(url) ? { credentials: "omit" } : {}),
    });
  } catch {
    throw new InstrumentClientError(
      "INSTRUMENT_SERVICE_UNAVAILABLE",
      "无法连接标的验证服务。",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InstrumentClientError(
      "INVALID_RESPONSE",
      "标的验证服务返回了无效响应。",
    );
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw new InstrumentClientError(
      "INVALID_RESPONSE",
      "标的验证服务返回了无效响应。",
    );
  }
  const value = body as InstrumentApiResponse;
  if (
    response.ok &&
    value.kind === "INSTRUMENT" &&
    typeof value.displayName === "string"
  ) {
    return value;
  }
  if (value.kind === "ERROR") {
    throw new InstrumentClientError(value.code, value.message);
  }
  throw new InstrumentClientError(
    "INVALID_RESPONSE",
    "标的验证服务返回了无效响应。",
  );
}
