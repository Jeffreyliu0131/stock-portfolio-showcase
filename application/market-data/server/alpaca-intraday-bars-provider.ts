import {
  DomainValidationError,
  canonicalDecimal,
  compareRfc3339,
  createInstrumentKey,
  instrumentKeyId,
  parsePositiveInput,
  rfc3339ToEpochNanoseconds,
  type InstrumentKey,
} from "../../../domain/index.ts";
import { parseJsonPreservingNumbers } from "../../http/parse-json-preserving-numbers.ts";
import { logSitesUpstreamFailure } from "../../runtime/sites-diagnostics.ts";
import {
  INTRADAY_BAR_ADJUSTMENT,
  INTRADAY_BAR_DELAY_MINUTES,
  INTRADAY_BAR_PROVIDER,
  INTRADAY_BAR_SOURCE_FEED,
  INTRADAY_BAR_TIMEFRAME,
  type IntradayBar,
  type IntradayBarSeries,
} from "../intraday-bars-api.ts";
import type { MarketDataFailureStatus } from "../types.ts";
import { newYorkMarketTime } from "./us-market-session.ts";

const ALPACA_HISTORICAL_STOCK_BARS_URL =
  "https://data.alpaca.markets/v2/stocks/bars";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 10;
const PAGE_LIMIT = 10_000;
const MINUTE_MS = 60_000;
const SESSION_START_MINUTE = 4 * 60;
const SESSION_END_MINUTE = 20 * 60;

const NEW_YORK_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  timeZoneName: "longOffset",
});

type JsonObject = Readonly<Record<string, unknown>>;

export interface AlpacaIntradayBarsHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type AlpacaIntradayBarsFetch = (
  input: string,
  init: RequestInit,
) => Promise<AlpacaIntradayBarsHttpResponse>;

export interface AlpacaIntradayBarsProviderOptions {
  readonly apiKeyId: string;
  readonly apiSecretKey: string;
  readonly fetchImpl?: AlpacaIntradayBarsFetch;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

export interface AlpacaIntradayBarsRequest {
  readonly instruments: readonly InstrumentKey[];
  readonly asOf?: string;
}

export type AlpacaIntradayBarsResult =
  | {
      readonly kind: "RESULTS";
      readonly generatedAt: string;
      readonly requestedAsOf: string;
      readonly windowStartAt: string;
      readonly availableThrough: string;
      readonly provider: typeof INTRADAY_BAR_PROVIDER;
      readonly sourceFeed: typeof INTRADAY_BAR_SOURCE_FEED;
      readonly delayPolicy: "AT_LEAST_15_MINUTES";
      readonly delayMinutes: typeof INTRADAY_BAR_DELAY_MINUTES;
      readonly timeframe: typeof INTRADAY_BAR_TIMEFRAME;
      readonly adjustment: typeof INTRADAY_BAR_ADJUSTMENT;
      readonly series: readonly IntradayBarSeries[];
    }
  | {
      readonly kind: "BATCH_FAILURE";
      readonly fetchStatus: MarketDataFailureStatus;
    };

interface QueryWindow {
  readonly requestedAsOf: string;
  readonly windowStartAt: string;
  readonly availableThrough: string;
  readonly hasQueryableWindow: boolean;
}

function isJsonObject(value: unknown): value is JsonObject {
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

function validatedTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`,
    );
  }
  return timeout;
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "AlpacaIntradayBarsProvider can only run in a server runtime",
    );
  }
}

function normalizeInstruments(
  values: readonly InstrumentKey[],
): readonly InstrumentKey[] | null {
  const instruments: InstrumentKey[] = [];
  const seenKeys = new Set<string>();
  const keyBySymbol = new Map<string, string>();
  try {
    for (const value of values) {
      const instrument = createInstrumentKey(value);
      const key = instrumentKeyId(instrument);
      if (
        instrument.currency !== "USD" ||
        instrument.symbol.includes(",") ||
        /\s/.test(instrument.symbol)
      ) {
        return null;
      }
      const existingKey = keyBySymbol.get(instrument.symbol);
      if (existingKey !== undefined && existingKey !== key) {
        return null;
      }
      keyBySymbol.set(instrument.symbol, key);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        instruments.push(instrument);
      }
    }
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }
  return instruments;
}

function validInstant(value: string): Date | null {
  try {
    rfc3339ToEpochNanoseconds(value, "intradayBars.instant");
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function newYorkOffset(instant: Date): string | null {
  const value = NEW_YORK_OFFSET_FORMATTER.formatToParts(instant).find(
    (part) => part.type === "timeZoneName",
  )?.value;
  const match = /^GMT([+-]\d{2}:\d{2})$/.exec(value ?? "");
  return match?.[1] ?? null;
}

function localInstant(
  date: string,
  minuteOfDay: number,
  offset: string,
): Date | null {
  const hour = Math.floor(minuteOfDay / 60)
    .toString()
    .padStart(2, "0");
  const minute = (minuteOfDay % 60).toString().padStart(2, "0");
  const instant = new Date(`${date}T${hour}:${minute}:00${offset}`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function queryWindow(nowValue: string, asOfValue?: string): QueryWindow | null {
  const now = validInstant(nowValue);
  const requested = validInstant(asOfValue ?? nowValue);
  if (now === null || requested === null) {
    return null;
  }

  const requestedAsOf = requested.toISOString();
  const delayedCutoff = new Date(
    now.getTime() - INTRADAY_BAR_DELAY_MINUTES * MINUTE_MS,
  );
  const effective = new Date(
    Math.min(requested.getTime(), delayedCutoff.getTime()),
  );
  const marketTime = newYorkMarketTime(effective.toISOString());
  const offset = newYorkOffset(effective);
  if (marketTime === null || offset === null) {
    return null;
  }
  const start = localInstant(
    marketTime.date,
    SESSION_START_MINUTE,
    offset,
  );
  const sessionEnd = localInstant(
    marketTime.date,
    SESSION_END_MINUTE,
    offset,
  );
  if (start === null || sessionEnd === null) {
    return null;
  }
  const end = new Date(Math.min(effective.getTime(), sessionEnd.getTime()));
  return {
    requestedAsOf,
    windowStartAt: start.toISOString(),
    availableThrough: end.toISOString(),
    hasQueryableWindow: end.getTime() >= start.getTime(),
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

function responseTooLarge(source: string): boolean {
  return new TextEncoder().encode(source).byteLength > MAX_RESPONSE_BYTES;
}

function page(
  parsed: unknown,
):
  | {
      readonly bars: JsonObject;
      readonly nextPageToken: string | null;
    }
  | null {
  if (!isJsonObject(parsed) || !isJsonObject(parsed.bars)) {
    return null;
  }
  const token = parsed.next_page_token;
  if (!(token === undefined || token === null || typeof token === "string")) {
    return null;
  }
  return {
    bars: parsed.bars,
    nextPageToken: typeof token === "string" && token.length > 0
      ? token
      : null,
  };
}

function mappedBar(value: unknown): IntradayBar | null {
  if (!isJsonObject(value) || typeof value.c !== "string" || typeof value.t !== "string") {
    return null;
  }
  try {
    const close = parsePositiveInput(value.c, "alpaca.intradayBar.close");
    rfc3339ToEpochNanoseconds(
      value.t,
      "alpaca.intradayBar.sourceEventAt",
    );
    return {
      close: canonicalDecimal(close),
      sourceEventAt: value.t,
      priceType: "MINUTE_BAR_CLOSE",
    };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }
}

function finalizedSeries(
  instruments: readonly InstrumentKey[],
  collected: ReadonlyMap<string, readonly unknown[]>,
  windowStartAt: string,
  availableThrough: string,
): readonly IntradayBarSeries[] {
  return instruments.map((instrument) => {
    const values = collected.get(instrument.symbol) ?? [];
    const byTimestamp = new Map<string, IntradayBar>();
    let failed = false;
    for (const value of values) {
      const bar = mappedBar(value);
      if (
        bar === null ||
        compareRfc3339(bar.sourceEventAt, windowStartAt) < 0 ||
        compareRfc3339(bar.sourceEventAt, availableThrough) > 0
      ) {
        failed = true;
        break;
      }
      const current = byTimestamp.get(bar.sourceEventAt);
      if (current !== undefined && current.close !== bar.close) {
        failed = true;
        break;
      }
      byTimestamp.set(bar.sourceEventAt, bar);
    }
    if (failed) {
      return { instrument, status: "FAILED", bars: [] };
    }
    const bars = [...byTimestamp.values()].sort((left, right) =>
      compareRfc3339(left.sourceEventAt, right.sourceEventAt),
    );
    return {
      instrument,
      status: bars.length === 0 ? "NO_DATA" : "OK",
      bars,
    };
  });
}

function defaultFetch(
  input: string,
  init: RequestInit,
): Promise<AlpacaIntradayBarsHttpResponse> {
  return globalThis.fetch(input, init);
}

export class AlpacaIntradayBarsProvider {
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly fetchImpl: AlpacaIntradayBarsFetch;
  private readonly now: () => string;
  private readonly timeoutMs: number;

  constructor(options: AlpacaIntradayBarsProviderOptions) {
    assertServerRuntime();
    this.apiKeyId = credential(options.apiKeyId, "Alpaca API key ID");
    this.apiSecretKey = credential(
      options.apiSecretKey,
      "Alpaca API secret key",
    );
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeoutMs = validatedTimeout(options.timeoutMs);
  }

  async getBars(
    request: AlpacaIntradayBarsRequest,
  ): Promise<AlpacaIntradayBarsResult> {
    const instruments = normalizeInstruments(request.instruments);
    const window = queryWindow(this.now(), request.asOf);
    if (instruments === null || window === null) {
      return { kind: "BATCH_FAILURE", fetchStatus: "FETCH_FAILED" };
    }

    if (instruments.length === 0 || !window.hasQueryableWindow) {
      return {
        kind: "RESULTS",
        generatedAt: this.now(),
        requestedAsOf: window.requestedAsOf,
        windowStartAt: window.windowStartAt,
        availableThrough: window.availableThrough,
        provider: INTRADAY_BAR_PROVIDER,
        sourceFeed: INTRADAY_BAR_SOURCE_FEED,
        delayPolicy: "AT_LEAST_15_MINUTES",
        delayMinutes: INTRADAY_BAR_DELAY_MINUTES,
        timeframe: INTRADAY_BAR_TIMEFRAME,
        adjustment: INTRADAY_BAR_ADJUSTMENT,
        series: instruments.map((instrument) => ({
          instrument,
          status: "NO_DATA",
          bars: [],
        })),
      };
    }

    const collected = new Map<string, unknown[]>();
    for (const instrument of instruments) {
      collected.set(instrument.symbol, []);
    }
    const seenTokens = new Set<string>();
    let pageToken: string | null = null;

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      const url = new URL(ALPACA_HISTORICAL_STOCK_BARS_URL);
      url.searchParams.set(
        "symbols",
        instruments.map((instrument) => instrument.symbol).join(","),
      );
      url.searchParams.set("timeframe", INTRADAY_BAR_TIMEFRAME);
      url.searchParams.set("feed", INTRADAY_BAR_SOURCE_FEED);
      url.searchParams.set("adjustment", INTRADAY_BAR_ADJUSTMENT);
      url.searchParams.set("currency", "USD");
      url.searchParams.set("start", window.windowStartAt);
      url.searchParams.set("end", window.availableThrough);
      url.searchParams.set("limit", PAGE_LIMIT.toString());
      url.searchParams.set("sort", "asc");
      if (pageToken !== null) {
        url.searchParams.set("page_token", pageToken);
      }

      const controller = new AbortController();
      const timeout = globalThis.setTimeout(
        () => controller.abort(),
        this.timeoutMs,
      );
      let parsedPage:
        | { readonly bars: JsonObject; readonly nextPageToken: string | null }
        | null = null;
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
          logSitesUpstreamFailure("alpaca_intraday_bars", response.status);
          return { kind: "BATCH_FAILURE", fetchStatus: failureStatus };
        }
        const source = await response.text();
        if (responseTooLarge(source)) {
          return { kind: "BATCH_FAILURE", fetchStatus: "FETCH_FAILED" };
        }
        try {
          parsedPage = page(parseJsonPreservingNumbers(source));
        } catch {
          parsedPage = null;
        }
      } catch (error) {
        logSitesUpstreamFailure("alpaca_intraday_bars", error);
        return { kind: "BATCH_FAILURE", fetchStatus: "FETCH_FAILED" };
      } finally {
        globalThis.clearTimeout(timeout);
      }
      if (parsedPage === null) {
        return { kind: "BATCH_FAILURE", fetchStatus: "FETCH_FAILED" };
      }

      for (const [rawSymbol, values] of Object.entries(parsedPage.bars)) {
        const symbol = rawSymbol.toUpperCase();
        const target = collected.get(symbol);
        if (target === undefined) {
          continue;
        }
        if (!Array.isArray(values)) {
          target.push(null);
          continue;
        }
        target.push(...values);
      }

      const nextToken = parsedPage.nextPageToken;
      if (nextToken === null) {
        return {
          kind: "RESULTS",
          generatedAt: this.now(),
          requestedAsOf: window.requestedAsOf,
          windowStartAt: window.windowStartAt,
          availableThrough: window.availableThrough,
          provider: INTRADAY_BAR_PROVIDER,
          sourceFeed: INTRADAY_BAR_SOURCE_FEED,
          delayPolicy: "AT_LEAST_15_MINUTES",
          delayMinutes: INTRADAY_BAR_DELAY_MINUTES,
          timeframe: INTRADAY_BAR_TIMEFRAME,
          adjustment: INTRADAY_BAR_ADJUSTMENT,
          series: finalizedSeries(
            instruments,
            collected,
            window.windowStartAt,
            window.availableThrough,
          ),
        };
      }
      if (seenTokens.has(nextToken)) {
        return { kind: "BATCH_FAILURE", fetchStatus: "FETCH_FAILED" };
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }

    return { kind: "BATCH_FAILURE", fetchStatus: "FETCH_FAILED" };
  }
}
