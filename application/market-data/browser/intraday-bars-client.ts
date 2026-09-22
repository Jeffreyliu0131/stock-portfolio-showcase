import {
  DomainValidationError,
  compareRfc3339,
  createInstrumentKey,
  instrumentKeyId,
  parsePositiveInput,
  rfc3339ToEpochNanoseconds,
  type InstrumentKey,
} from "../../../domain/index.ts";
import {
  INTRADAY_BAR_ADJUSTMENT,
  INTRADAY_BAR_DELAY_MINUTES,
  INTRADAY_BAR_PROVIDER,
  INTRADAY_BAR_SOURCE_FEED,
  INTRADAY_BAR_TIMEFRAME,
  MAX_INTRADAY_BAR_REQUEST_INSTRUMENTS,
  type IntradayBar,
  type IntradayBarsApiErrorCode,
  type IntradayBarsApiSuccess,
  type IntradayBarSeries,
} from "../intraday-bars-api.ts";
import {
  isVercelProviderUrl,
  providerApiUrl,
} from "../../http/provider-proxy-contract.ts";

export type IntradayBarsFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface RequestIntradayBarsOptions {
  readonly asOf?: string;
  readonly fetchImpl?: IntradayBarsFetch;
}

export class IntradayBarsClientError extends Error {
  readonly code: IntradayBarsApiErrorCode | "INVALID_RESPONSE";

  constructor(
    code: IntradayBarsApiErrorCode | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "IntradayBarsClientError";
    this.code = code;
  }
}

const ERROR_CODES = new Set<IntradayBarsApiErrorCode>([
  "INVALID_REQUEST",
  "TOO_MANY_INSTRUMENTS",
  "MARKET_DATA_NOT_CONFIGURED",
  "MARKET_DATA_UNAVAILABLE",
  "RATE_LIMITED",
  "UNAUTHORIZED",
]);

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function validTimestamp(value: unknown, field: string): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    rfc3339ToEpochNanoseconds(value, field);
    return true;
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return false;
    }
    throw error;
  }
}

function parseBar(value: unknown): IntradayBar | null {
  const record = object(value);
  if (
    record === null ||
    record.priceType !== "MINUTE_BAR_CLOSE" ||
    typeof record.close !== "string" ||
    !validTimestamp(record.sourceEventAt, "intradayBar.sourceEventAt")
  ) {
    return null;
  }
  try {
    parsePositiveInput(record.close, "intradayBar.close");
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }
  return {
    close: record.close,
    sourceEventAt: record.sourceEventAt,
    priceType: "MINUTE_BAR_CLOSE",
  };
}

function parseSeries(value: unknown): IntradayBarSeries | null {
  const record = object(value);
  if (
    record === null ||
    !Array.isArray(record.bars) ||
    !(
      record.status === "OK" ||
      record.status === "NO_DATA" ||
      record.status === "FAILED"
    )
  ) {
    return null;
  }
  let instrument: InstrumentKey;
  const instrumentRecord = object(record.instrument);
  if (
    instrumentRecord === null ||
    typeof instrumentRecord.listingMarket !== "string" ||
    typeof instrumentRecord.symbol !== "string" ||
    typeof instrumentRecord.currency !== "string"
  ) {
    return null;
  }
  try {
    instrument = createInstrumentKey({
      listingMarket: instrumentRecord.listingMarket,
      symbol: instrumentRecord.symbol,
      currency: instrumentRecord.currency,
    });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }
  const bars: IntradayBar[] = [];
  let previousTimestamp: string | null = null;
  for (const valueBar of record.bars) {
    const bar = parseBar(valueBar);
    if (
      bar === null ||
      (previousTimestamp !== null &&
        compareRfc3339(previousTimestamp, bar.sourceEventAt) >= 0)
    ) {
      return null;
    }
    bars.push(bar);
    previousTimestamp = bar.sourceEventAt;
  }
  if (
    (record.status === "OK" && bars.length === 0) ||
    (record.status !== "OK" && bars.length > 0)
  ) {
    return null;
  }
  return { instrument, status: record.status, bars };
}

function parseSuccess(value: unknown): IntradayBarsApiSuccess | null {
  const record = object(value);
  if (
    record === null ||
    record.kind !== "INTRADAY_BARS" ||
    record.provider !== INTRADAY_BAR_PROVIDER ||
    record.sourceFeed !== INTRADAY_BAR_SOURCE_FEED ||
    record.delayPolicy !== "AT_LEAST_15_MINUTES" ||
    record.delayMinutes !== INTRADAY_BAR_DELAY_MINUTES ||
    record.timeframe !== INTRADAY_BAR_TIMEFRAME ||
    record.adjustment !== INTRADAY_BAR_ADJUSTMENT ||
    !validTimestamp(record.generatedAt, "intradayBars.generatedAt") ||
    !validTimestamp(record.requestedAsOf, "intradayBars.requestedAsOf") ||
    !validTimestamp(record.windowStartAt, "intradayBars.windowStartAt") ||
    !validTimestamp(
      record.availableThrough,
      "intradayBars.availableThrough",
    ) ||
    !Array.isArray(record.series)
  ) {
    return null;
  }
  const generatedAtMs = new Date(record.generatedAt).getTime();
  const availableThroughMs = new Date(record.availableThrough).getTime();
  if (
    availableThroughMs >
    generatedAtMs - INTRADAY_BAR_DELAY_MINUTES * 60_000
  ) {
    return null;
  }
  const series: IntradayBarSeries[] = [];
  const keys = new Set<string>();
  for (const valueSeries of record.series) {
    const parsed = parseSeries(valueSeries);
    if (parsed === null) {
      return null;
    }
    const key = instrumentKeyId(parsed.instrument);
    if (keys.has(key)) {
      return null;
    }
    keys.add(key);
    series.push(parsed);
  }
  return {
    kind: "INTRADAY_BARS",
    generatedAt: record.generatedAt,
    requestedAsOf: record.requestedAsOf,
    windowStartAt: record.windowStartAt,
    availableThrough: record.availableThrough,
    provider: INTRADAY_BAR_PROVIDER,
    sourceFeed: INTRADAY_BAR_SOURCE_FEED,
    delayPolicy: "AT_LEAST_15_MINUTES",
    delayMinutes: INTRADAY_BAR_DELAY_MINUTES,
    timeframe: INTRADAY_BAR_TIMEFRAME,
    adjustment: INTRADAY_BAR_ADJUSTMENT,
    series,
  };
}

export async function requestIntradayBars(
  instruments: readonly InstrumentKey[],
  options: RequestIntradayBarsOptions = {},
): Promise<IntradayBarsApiSuccess> {
  if (instruments.length > MAX_INTRADAY_BAR_REQUEST_INSTRUMENTS) {
    throw new IntradayBarsClientError(
      "TOO_MANY_INSTRUMENTS",
      `一次最多查询 ${MAX_INTRADAY_BAR_REQUEST_INSTRUMENTS} 个标的。`,
    );
  }
  if (
    options.asOf !== undefined &&
    !validTimestamp(options.asOf, "intradayBars.asOf")
  ) {
    throw new IntradayBarsClientError(
      "INVALID_REQUEST",
      "日内走势 asOf 必须是有效时间。",
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    const url = providerApiUrl("/api/intraday-bars");
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instruments,
        ...(options.asOf === undefined ? {} : { asOf: options.asOf }),
      }),
      cache: "no-store",
      ...(isVercelProviderUrl(url) ? { credentials: "omit" } : {}),
    });
  } catch {
    throw new IntradayBarsClientError(
      "MARKET_DATA_UNAVAILABLE",
      "无法连接日内走势行情服务。",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new IntradayBarsClientError(
      "INVALID_RESPONSE",
      "日内走势行情服务返回了无效响应。",
    );
  }
  if (response.ok) {
    const success = parseSuccess(body);
    if (success !== null) {
      return success;
    }
  }
  const error = object(body);
  if (
    error?.kind === "ERROR" &&
    typeof error.code === "string" &&
    ERROR_CODES.has(error.code as IntradayBarsApiErrorCode) &&
    typeof error.message === "string"
  ) {
    throw new IntradayBarsClientError(
      error.code as IntradayBarsApiErrorCode,
      error.message,
    );
  }
  throw new IntradayBarsClientError(
    "INVALID_RESPONSE",
    "日内走势行情服务返回了无效响应。",
  );
}
