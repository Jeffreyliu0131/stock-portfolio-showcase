import {
  DomainValidationError,
  createInstrumentKey,
  instrumentKeyId,
  parsePositiveInput,
  type InstrumentKey,
  type MarketSession,
} from "../../../domain/index.ts";
import { parseJsonPreservingNumbers } from "../../http/parse-json-preserving-numbers.ts";
import { logSitesUpstreamFailure } from "../../runtime/sites-diagnostics.ts";
import type {
  MarketDataBatchResponse,
  MarketDataFailureStatus,
  MarketDataProvider,
  MarketDataProviderRequest,
  ProviderSnapshotResult,
} from "../types.ts";

export const ALPACA_MARKET_DATA_PROVIDER = "alpaca";
export const ALPACA_DELAYED_SIP_FEED = "delayed_sip";
export const ALPACA_OVERNIGHT_FEED = "overnight";

const ALPACA_STOCK_SNAPSHOTS_URL =
  "https://data.alpaca.markets/v2/stocks/snapshots";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const NEW_YORK_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface AlpacaHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type AlpacaHttpFetch = (
  input: string,
  init: RequestInit,
) => Promise<AlpacaHttpResponse>;

export interface AlpacaMarketDataProviderOptions {
  readonly apiKeyId: string;
  readonly apiSecretKey: string;
  readonly feed?: AlpacaStockFeed;
  readonly fetchImpl?: AlpacaHttpFetch;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

interface NormalizedRequest {
  readonly instruments: readonly InstrumentKey[];
  readonly fetchableSymbols: readonly string[];
  readonly rejectedInstrumentKeys: ReadonlySet<string>;
}

type JsonObject = Readonly<Record<string, unknown>>;
export type AlpacaStockFeed =
  | typeof ALPACA_DELAYED_SIP_FEED
  | typeof ALPACA_OVERNIGHT_FEED;

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
      "AlpacaMarketDataProvider can only run in a server runtime",
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

function failedResult(instrument: InstrumentKey): ProviderSnapshotResult {
  return {
    instrument,
    fetchStatus: "FETCH_FAILED",
  };
}

function normalizeRequest(
  instruments: readonly InstrumentKey[],
): NormalizedRequest | null {
  const normalized: InstrumentKey[] = [];
  try {
    for (const instrument of instruments) {
      normalized.push(createInstrumentKey(instrument));
    }
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }

  const instrumentIdsBySymbol = new Map<string, Set<string>>();
  for (const instrument of normalized) {
    const ids = instrumentIdsBySymbol.get(instrument.symbol) ?? new Set();
    ids.add(instrumentKeyId(instrument));
    instrumentIdsBySymbol.set(instrument.symbol, ids);
  }

  const rejectedInstrumentKeys = new Set<string>();
  const fetchableSymbols: string[] = [];
  const seenFetchableSymbols = new Set<string>();
  for (const instrument of normalized) {
    const ambiguous =
      (instrumentIdsBySymbol.get(instrument.symbol)?.size ?? 0) > 1;
    const unsafeSymbol =
      instrument.symbol.includes(",") || /\s/.test(instrument.symbol);
    if (
      instrument.currency !== "USD" ||
      ambiguous ||
      unsafeSymbol
    ) {
      rejectedInstrumentKeys.add(instrumentKeyId(instrument));
      continue;
    }
    if (!seenFetchableSymbols.has(instrument.symbol)) {
      seenFetchableSymbols.add(instrument.symbol);
      fetchableSymbols.push(instrument.symbol);
    }
  }

  return {
    instruments: normalized,
    fetchableSymbols,
    rejectedInstrumentKeys,
  };
}

function responseStatus(
  status: number,
): MarketDataFailureStatus | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status === 401 || status === 403) {
    return "UNAUTHORIZED";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  return "FETCH_FAILED";
}

function snapshotMap(
  parsed: unknown,
): ReadonlyMap<string, unknown> | null {
  if (!isJsonObject(parsed)) {
    return null;
  }

  const snapshots = new Map<string, unknown>();
  const duplicateSymbols = new Set<string>();
  for (const [rawSymbol, snapshot] of Object.entries(parsed)) {
    const symbol = rawSymbol.toUpperCase();
    if (duplicateSymbols.has(symbol)) {
      continue;
    }
    if (snapshots.has(symbol)) {
      snapshots.delete(symbol);
      duplicateSymbols.add(symbol);
      continue;
    }
    snapshots.set(symbol, snapshot);
  }
  for (const symbol of duplicateSymbols) {
    snapshots.set(symbol, null);
  }
  return snapshots;
}

function positiveClose(bar: unknown): string | undefined {
  if (!isJsonObject(bar) || typeof bar.c !== "string") {
    return undefined;
  }
  try {
    parsePositiveInput(bar.c, "alpaca.bar.close");
    return bar.c;
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return undefined;
    }
    throw error;
  }
}

function newYorkDate(timestamp: unknown): string | undefined {
  if (typeof timestamp !== "string") {
    return undefined;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const dateParts = new Map(
    NEW_YORK_DATE_FORMATTER.formatToParts(date).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const year = dateParts.get("year");
  const month = dateParts.get("month");
  const day = dateParts.get("day");
  return year === undefined || month === undefined || day === undefined
    ? undefined
    : `${year}-${month}-${day}`;
}

/*
 * Alpaca's dailyBar changes meaning around the market day boundary. During
 * regular trading, prevDailyBar is the reference only after dailyBar belongs
 * to the current New York date. In pre-market or after-hours, dailyBar is the
 * latest completed regular close. During the overnight session, only a
 * delayed_sip snapshot may supply that regular-session reference; an
 * overnight-feed daily bar must never be treated as a regular close.
 * Closed/holiday/unknown sessions stay unset because the correct comparison
 * day needs the market calendar.
 */
function previousRegularClose(
  snapshot: JsonObject,
  marketSession: MarketSession,
  feed: AlpacaStockFeed,
  fetchedAt: string,
): string | undefined {
  const dailyClose = positiveClose(snapshot.dailyBar);
  if (
    marketSession === "PRE_MARKET" ||
    marketSession === "AFTER_HOURS" ||
    (marketSession === "OVERNIGHT" &&
      feed === ALPACA_DELAYED_SIP_FEED)
  ) {
    return dailyClose;
  }
  if (marketSession !== "REGULAR" || dailyClose === undefined) {
    return undefined;
  }

  const dailyBar = snapshot.dailyBar;
  if (!isJsonObject(dailyBar)) {
    return undefined;
  }
  const dailyBarDate = newYorkDate(dailyBar.t);
  const fetchedDate = newYorkDate(fetchedAt);
  if (
    dailyBarDate !== undefined &&
    fetchedDate !== undefined &&
    dailyBarDate === fetchedDate
  ) {
    return positiveClose(snapshot.prevDailyBar);
  }
  return dailyClose;
}

function mapSnapshot(
  instrument: InstrumentKey,
  snapshot: unknown,
  marketSession: MarketSession,
  feed: AlpacaStockFeed,
  fetchedAt: string,
): ProviderSnapshotResult {
  if (snapshot === undefined) {
    return {
      instrument,
      fetchStatus: "FETCH_OK",
      noRecentTrade: true,
    };
  }
  if (!isJsonObject(snapshot)) {
    return failedResult(instrument);
  }

  const latestTrade = snapshot.latestTrade;
  if (latestTrade === undefined || latestTrade === null) {
    return {
      instrument,
      fetchStatus: "FETCH_OK",
      noRecentTrade: true,
    };
  }
  if (
    !isJsonObject(latestTrade) ||
    typeof latestTrade.p !== "string" ||
    typeof latestTrade.t !== "string"
  ) {
    return failedResult(instrument);
  }

  const referenceClose = previousRegularClose(
    snapshot,
    marketSession,
    feed,
    fetchedAt,
  );
  return {
    instrument,
    fetchStatus: "FETCH_OK",
    candidate: {
      instrument,
      provider: ALPACA_MARKET_DATA_PROVIDER,
      feed,
      price: latestTrade.p,
      priceType:
        feed === ALPACA_OVERNIGHT_FEED
          ? "INDICATIVE_TRADE"
          : "LATEST_TRADE",
      sourceEventAt: latestTrade.t,
      fetchedAt,
      marketSession,
      ...(referenceClose === undefined
        ? {}
        : { previousRegularClose: referenceClose }),
    },
  };
}

function defaultFetch(
  input: string,
  init: RequestInit,
): Promise<AlpacaHttpResponse> {
  return globalThis.fetch(input, init);
}

export class AlpacaMarketDataProvider implements MarketDataProvider {
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly feed: AlpacaStockFeed | undefined;
  private readonly fetchImpl: AlpacaHttpFetch;
  private readonly now: () => string;
  private readonly timeoutMs: number;

  constructor(options: AlpacaMarketDataProviderOptions) {
    assertServerRuntime();
    this.apiKeyId = requireCredential(
      options.apiKeyId,
      "Alpaca API key ID",
    );
    this.apiSecretKey = requireCredential(
      options.apiSecretKey,
      "Alpaca API secret key",
    );
    this.feed = options.feed;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeoutMs = validatedTimeout(options.timeoutMs);
  }

  async getSnapshots(
    request: MarketDataProviderRequest,
  ): Promise<MarketDataBatchResponse> {
    if (request.instruments.length === 0) {
      return { kind: "RESULTS", results: [] };
    }

    const normalized = normalizeRequest(request.instruments);
    if (normalized === null) {
      return {
        kind: "BATCH_FAILURE",
        fetchStatus: "FETCH_FAILED",
      };
    }

    if (normalized.fetchableSymbols.length === 0) {
      return {
        kind: "RESULTS",
        results: normalized.instruments.map(failedResult),
      };
    }

    const url = new URL(ALPACA_STOCK_SNAPSHOTS_URL);
    const feed =
      this.feed ??
      (request.marketSession === "OVERNIGHT"
        ? ALPACA_OVERNIGHT_FEED
        : ALPACA_DELAYED_SIP_FEED);
    url.searchParams.set(
      "symbols",
      normalized.fetchableSymbols.join(","),
    );
    url.searchParams.set("feed", feed);
    url.searchParams.set("currency", "USD");

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );

    let parsed: unknown;
    let fetchedAt: string;
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
      const failureStatus = responseStatus(response.status);
      if (failureStatus !== null) {
        logSitesUpstreamFailure("alpaca_snapshots", response.status);
        return {
          kind: "BATCH_FAILURE",
          fetchStatus: failureStatus,
        };
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        return {
          kind: "BATCH_FAILURE",
          fetchStatus: "FETCH_FAILED",
        };
      }
      fetchedAt = this.now();
      parsed = parseJsonPreservingNumbers(body);
    } catch (error) {
      logSitesUpstreamFailure("alpaca_snapshots", error);
      return {
        kind: "BATCH_FAILURE",
        fetchStatus: "FETCH_FAILED",
      };
    } finally {
      globalThis.clearTimeout(timeout);
    }

    const snapshots = snapshotMap(parsed);
    if (snapshots === null) {
      return {
        kind: "BATCH_FAILURE",
        fetchStatus: "FETCH_FAILED",
      };
    }

    const results = normalized.instruments.map((instrument) => {
      if (
        normalized.rejectedInstrumentKeys.has(
          instrumentKeyId(instrument),
        )
      ) {
        return failedResult(instrument);
      }
      return mapSnapshot(
        instrument,
        snapshots.get(instrument.symbol),
        request.marketSession,
        feed,
        fetchedAt,
      );
    });

    return { kind: "RESULTS", results };
  }
}
