import { parseJsonPreservingNumbers } from "../../http/parse-json-preserving-numbers.ts";
import { logSitesUpstreamFailure } from "../../runtime/sites-diagnostics.ts";
import {
  ALPACA_USD_CNY_RATE_PROVIDER,
  ALPACA_USD_CNY_RATE_TYPE,
  normalizeUsdCnyRate,
  type UsdCnyRate,
} from "../types.ts";

const ALPACA_LATEST_FOREX_RATES_URL =
  "https://data.alpaca.markets/v1beta1/forex/latest/rates";
const ALPACA_USD_CNY_PAIR = "USDCNY";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 65_536;

export interface AlpacaFxHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type AlpacaFxHttpFetch = (
  input: string,
  init: RequestInit,
) => Promise<AlpacaFxHttpResponse>;

export type AlpacaFxRateErrorCode =
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

export class AlpacaFxRateError extends Error {
  readonly code: AlpacaFxRateErrorCode;

  constructor(code: AlpacaFxRateErrorCode, message: string) {
    super(message);
    this.name = "AlpacaFxRateError";
    this.code = code;
  }
}

export interface AlpacaUsdCnyRateProviderOptions {
  readonly apiKeyId: string;
  readonly apiSecretKey: string;
  readonly fetchImpl?: AlpacaFxHttpFetch;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requireCredential(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "AlpacaUsdCnyRateProvider can only run in a server runtime",
    );
  }
}

function validatedTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`,
    );
  }
  return value;
}

function errorForStatus(status: number): AlpacaFxRateError | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status === 401 || status === 403) {
    return new AlpacaFxRateError(
      "UNAUTHORIZED",
      "Alpaca forex credentials were rejected",
    );
  }
  if (status === 429) {
    return new AlpacaFxRateError(
      "RATE_LIMITED",
      "Alpaca forex rate limit was reached",
    );
  }
  return new AlpacaFxRateError(
    "UNAVAILABLE",
    "Alpaca forex service is unavailable",
  );
}

function defaultFetch(
  input: string,
  init: RequestInit,
): Promise<AlpacaFxHttpResponse> {
  return globalThis.fetch(input, init);
}

function mapRate(parsed: unknown, fetchedAt: string): UsdCnyRate {
  if (!isJsonObject(parsed) || !isJsonObject(parsed.rates)) {
    throw new AlpacaFxRateError(
      "INVALID_RESPONSE",
      "Alpaca forex response has no rates object",
    );
  }
  const rawRate = parsed.rates[ALPACA_USD_CNY_PAIR];
  if (
    !isJsonObject(rawRate) ||
    typeof rawRate.mp !== "string" ||
    typeof rawRate.t !== "string"
  ) {
    throw new AlpacaFxRateError(
      "INVALID_RESPONSE",
      "Alpaca forex response has no valid USDCNY midpoint",
    );
  }
  const normalized = normalizeUsdCnyRate({
    baseCurrency: "USD",
    quoteCurrency: "CNY",
    rate: rawRate.mp,
    provider: ALPACA_USD_CNY_RATE_PROVIDER,
    rateType: ALPACA_USD_CNY_RATE_TYPE,
    sourceEventAt: rawRate.t,
    fetchedAt,
  });
  if (normalized === null) {
    throw new AlpacaFxRateError(
      "INVALID_RESPONSE",
      "Alpaca forex response contains an invalid USDCNY rate",
    );
  }
  return normalized;
}

export class AlpacaUsdCnyRateProvider {
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly fetchImpl: AlpacaFxHttpFetch;
  private readonly now: () => string;
  private readonly timeoutMs: number;

  constructor(options: AlpacaUsdCnyRateProviderOptions) {
    assertServerRuntime();
    this.apiKeyId = requireCredential(
      options.apiKeyId,
      "Alpaca API key ID",
    );
    this.apiSecretKey = requireCredential(
      options.apiSecretKey,
      "Alpaca API secret key",
    );
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeoutMs = validatedTimeout(options.timeoutMs);
  }

  async getLatestRate(): Promise<UsdCnyRate> {
    const url = new URL(ALPACA_LATEST_FOREX_RATES_URL);
    url.searchParams.set("currency_pairs", ALPACA_USD_CNY_PAIR);
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "APCA-API-KEY-ID": this.apiKeyId,
          "APCA-API-SECRET-KEY": this.apiSecretKey,
        },
        signal: controller.signal,
      });
      const statusError = errorForStatus(response.status);
      if (statusError !== null) {
        logSitesUpstreamFailure("alpaca_fx", response.status);
        throw statusError;
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        throw new AlpacaFxRateError(
          "INVALID_RESPONSE",
          "Alpaca forex response is too large",
        );
      }
      const fetchedAt = this.now();
      return mapRate(parseJsonPreservingNumbers(body), fetchedAt);
    } catch (error) {
      if (error instanceof AlpacaFxRateError) {
        throw error;
      }
      logSitesUpstreamFailure("alpaca_fx", error);
      throw new AlpacaFxRateError(
        "UNAVAILABLE",
        "Alpaca forex request failed",
      );
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}
