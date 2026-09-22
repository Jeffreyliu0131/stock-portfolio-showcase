import type { DecimalString } from "../../domain/decimal.ts";
import type { InstrumentKey } from "../../domain/instrument.ts";

export const MAX_INTRADAY_BAR_REQUEST_INSTRUMENTS = 100;
export const INTRADAY_BAR_TIMEFRAME = "15Min" as const;
export const INTRADAY_BAR_PROVIDER = "alpaca" as const;
export const INTRADAY_BAR_SOURCE_FEED = "sip" as const;
export const INTRADAY_BAR_ADJUSTMENT = "split" as const;
export const INTRADAY_BAR_DELAY_MINUTES = 15;

export type IntradayBarSeriesStatus = "OK" | "NO_DATA" | "FAILED";

export interface IntradayBar {
  readonly close: DecimalString;
  readonly sourceEventAt: string;
  readonly priceType: "MINUTE_BAR_CLOSE";
}

export interface IntradayBarSeries {
  readonly instrument: InstrumentKey;
  readonly status: IntradayBarSeriesStatus;
  readonly bars: readonly IntradayBar[];
}

export interface IntradayBarsApiSuccess {
  readonly kind: "INTRADAY_BARS";
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

export type IntradayBarsApiErrorCode =
  | "INVALID_REQUEST"
  | "TOO_MANY_INSTRUMENTS"
  | "MARKET_DATA_NOT_CONFIGURED"
  | "MARKET_DATA_UNAVAILABLE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

export interface IntradayBarsApiError {
  readonly kind: "ERROR";
  readonly code: IntradayBarsApiErrorCode;
  readonly message: string;
}

export type IntradayBarsApiResponse =
  | IntradayBarsApiSuccess
  | IntradayBarsApiError;
