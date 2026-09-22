import {
  ageInNanoseconds,
  minutesToNanoseconds,
} from "../../../domain/time.ts";

const DEFAULT_BASE_URL = "https://paper-api.alpaca.markets";
const ALLOWED_ORIGINS = new Set([
  "https://paper-api.alpaca.markets",
  "https://api.alpaca.markets",
]);
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_CLOCK_SKEW = minutesToNanoseconds(2);

export type AlpacaMarketClockState =
  | "OPEN"
  | "CLOSED"
  | "UNAVAILABLE";

export interface AlpacaMarketClockHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type AlpacaMarketClockFetch = (
  input: string,
  init: RequestInit,
) => Promise<AlpacaMarketClockHttpResponse>;

export interface AlpacaMarketClockOptions {
  readonly apiKeyId: string;
  readonly apiSecretKey: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: AlpacaMarketClockFetch;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

function credential(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function baseUrl(value: string | undefined): URL {
  const url = new URL(value ?? DEFAULT_BASE_URL);
  if (
    !ALLOWED_ORIGINS.has(url.origin) ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("Alpaca trading API base URL is not allowed");
  }
  return url;
}

function parseClock(
  source: string,
  now: string,
): AlpacaMarketClockState {
  if (new TextEncoder().encode(source).byteLength > MAX_RESPONSE_BYTES) {
    return "UNAVAILABLE";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return "UNAVAILABLE";
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as Readonly<Record<string, unknown>>)
      .timestamp !== "string" ||
    typeof (parsed as Readonly<Record<string, unknown>>)
      .is_open !== "boolean"
  ) {
    return "UNAVAILABLE";
  }
  try {
    const skew = ageInNanoseconds(
      now,
      (parsed as { readonly timestamp: string }).timestamp,
    );
    const absoluteSkew = skew < 0n ? -skew : skew;
    if (absoluteSkew > MAX_CLOCK_SKEW) {
      return "UNAVAILABLE";
    }
  } catch {
    return "UNAVAILABLE";
  }
  return (parsed as { readonly is_open: boolean }).is_open
    ? "OPEN"
    : "CLOSED";
}

export class AlpacaMarketClock {
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly apiBaseUrl: URL;
  private readonly fetchImpl: AlpacaMarketClockFetch;
  private readonly now: () => string;
  private readonly timeoutMs: number;

  constructor(options: AlpacaMarketClockOptions) {
    if (typeof window !== "undefined") {
      throw new Error("AlpacaMarketClock can only run on the server");
    }
    this.apiKeyId = credential(
      options.apiKeyId,
      "Alpaca API key ID",
    );
    this.apiSecretKey = credential(
      options.apiSecretKey,
      "Alpaca API secret key",
    );
    this.apiBaseUrl = baseUrl(options.apiBaseUrl);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 60_000
    ) {
      throw new Error("timeoutMs must be from 1 to 60000");
    }
  }

  async getState(): Promise<AlpacaMarketClockState> {
    const url = new URL("/v2/clock", this.apiBaseUrl);
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
      if (response.status < 200 || response.status >= 300) {
        return "UNAVAILABLE";
      }
      return parseClock(await response.text(), this.now());
    } catch {
      return "UNAVAILABLE";
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}
