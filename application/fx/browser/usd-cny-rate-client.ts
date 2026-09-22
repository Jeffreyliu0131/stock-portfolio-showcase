import type { FxRateApiErrorCode } from "../fx-api.ts";
import {
  normalizeUsdCnyRate,
  type UsdCnyRate,
} from "../types.ts";
import {
  isVercelProviderUrl,
  providerApiUrl,
} from "../../http/provider-proxy-contract.ts";

export class FxRateClientError extends Error {
  readonly code: FxRateApiErrorCode | "INVALID_RESPONSE";

  constructor(
    code: FxRateApiErrorCode | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "FxRateClientError";
    this.code = code;
  }
}

export type FxRateFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function requestUsdCnyRate(
  fetchImpl: FxRateFetch = globalThis.fetch,
): Promise<UsdCnyRate> {
  let response: Response;
  try {
    const url = providerApiUrl("/api/fx/usd-cny");
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      ...(isVercelProviderUrl(url) ? { credentials: "omit" } : {}),
    });
  } catch {
    throw new FxRateClientError(
      "FX_RATE_UNAVAILABLE",
      "无法连接人民币估算汇率服务。",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FxRateClientError(
      "INVALID_RESPONSE",
      "人民币估算汇率服务返回了无效响应。",
    );
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw new FxRateClientError(
      "INVALID_RESPONSE",
      "人民币估算汇率服务返回了无效响应。",
    );
  }
  const record = body as Readonly<Record<string, unknown>>;
  if (response.ok && record.kind === "USD_CNY_RATE") {
    const rate = normalizeUsdCnyRate(record.rate);
    if (rate !== null) {
      return rate;
    }
  }
  if (
    record.kind === "ERROR" &&
    typeof record.code === "string" &&
    typeof record.message === "string"
  ) {
    throw new FxRateClientError(
      record.code as FxRateApiErrorCode,
      record.message,
    );
  }
  throw new FxRateClientError(
    "INVALID_RESPONSE",
    "人民币估算汇率服务返回了无效响应。",
  );
}
