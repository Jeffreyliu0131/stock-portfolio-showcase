import type { InstrumentKey } from "../../../domain/instrument.ts";
import {
  normalizeSupportedSymbol,
  resolveSupportedInstrument,
} from "../supported-instruments.ts";
import { logSitesUpstreamFailure } from "../../runtime/sites-diagnostics.ts";

const DEFAULT_BASE_URL = "https://paper-api.alpaca.markets";
const ALLOWED_ORIGINS = new Set([
  "https://paper-api.alpaca.markets",
  "https://api.alpaca.markets",
]);
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 65_536;

export type InstrumentLookupFailure =
  | "NOT_FOUND"
  | "UNSUPPORTED"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

export type InstrumentLookupResult =
  | {
      readonly kind: "FOUND";
      readonly instrument: InstrumentKey;
      readonly displayName: string;
    }
  | {
      readonly kind: "FAILED";
      readonly reason: InstrumentLookupFailure;
    };

export interface AlpacaAssetHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type AlpacaAssetFetch = (
  input: string,
  init: RequestInit,
) => Promise<AlpacaAssetHttpResponse>;

export interface AlpacaInstrumentResolverOptions {
  readonly apiKeyId: string;
  readonly apiSecretKey: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: AlpacaAssetFetch;
  readonly timeoutMs?: number;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
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

function mapFailure(status: number): InstrumentLookupFailure | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  if (status === 401 || status === 403) {
    return "UNAUTHORIZED";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  return "UNAVAILABLE";
}

function parseAsset(
  source: string,
  requestedSymbol: string,
): InstrumentLookupResult {
  if (new TextEncoder().encode(source).byteLength > MAX_RESPONSE_BYTES) {
    return { kind: "FAILED", reason: "UNAVAILABLE" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return { kind: "FAILED", reason: "UNAVAILABLE" };
  }
  if (!isObject(parsed)) {
    return { kind: "FAILED", reason: "UNAVAILABLE" };
  }

  const symbol =
    typeof parsed.symbol === "string" ? parsed.symbol : "";
  const listingMarket =
    typeof parsed.exchange === "string" ? parsed.exchange : "";
  const displayName =
    typeof parsed.name === "string" ? parsed.name.trim() : "";
  const assetClass =
    typeof parsed.class === "string" ? parsed.class.toLowerCase() : "";
  const status =
    typeof parsed.status === "string"
      ? parsed.status.toLowerCase()
      : "";
  const resolved = resolveSupportedInstrument({
    symbol,
    listingMarket,
    currency: "USD",
  });
  if (
    !resolved.ok ||
    resolved.instrument.symbol !== requestedSymbol ||
    assetClass !== "us_equity" ||
    status !== "active" ||
    parsed.tradable !== true ||
    displayName.length === 0 ||
    displayName.length > 200
  ) {
    return { kind: "FAILED", reason: "UNSUPPORTED" };
  }

  return {
    kind: "FOUND",
    instrument: resolved.instrument,
    displayName,
  };
}

export class AlpacaInstrumentResolver {
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly apiBaseUrl: URL;
  private readonly fetchImpl: AlpacaAssetFetch;
  private readonly timeoutMs: number;

  constructor(options: AlpacaInstrumentResolverOptions) {
    if (typeof window !== "undefined") {
      throw new Error(
        "AlpacaInstrumentResolver can only run on the server",
      );
    }
    this.apiKeyId = credential(options.apiKeyId, "Alpaca API key ID");
    this.apiSecretKey = credential(
      options.apiSecretKey,
      "Alpaca API secret key",
    );
    this.apiBaseUrl = baseUrl(options.apiBaseUrl);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 60_000
    ) {
      throw new Error("timeoutMs must be from 1 to 60000");
    }
  }

  async resolve(
    symbolInput: string,
  ): Promise<InstrumentLookupResult> {
    const requestedSymbol = normalizeSupportedSymbol(symbolInput);
    if (requestedSymbol === null) {
      return { kind: "FAILED", reason: "UNSUPPORTED" };
    }

    const url = new URL(
      `/v2/assets/${encodeURIComponent(requestedSymbol)}`,
      this.apiBaseUrl,
    );
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
      const failure = mapFailure(response.status);
      if (failure !== null) {
        logSitesUpstreamFailure("alpaca_instruments", response.status);
        return { kind: "FAILED", reason: failure };
      }
      return parseAsset(
        await response.text(),
        requestedSymbol,
      );
    } catch (error) {
      logSitesUpstreamFailure("alpaca_instruments", error);
      return { kind: "FAILED", reason: "UNAVAILABLE" };
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}
