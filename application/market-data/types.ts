import type {
  InstrumentKey,
  MarketSession,
  QuoteCandidate,
  ResolvedQuote,
  ValidMarketQuote,
} from "../../domain/index.ts";

export type MarketDataFailureStatus =
  | "FETCH_FAILED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

export interface ProviderQuoteSnapshot {
  readonly instrument: InstrumentKey;
  readonly fetchStatus: "FETCH_OK";
  readonly candidate: QuoteCandidate;
  readonly noRecentTrade?: never;
}

export interface ProviderEmptySnapshot {
  readonly instrument: InstrumentKey;
  readonly fetchStatus: "FETCH_OK";
  readonly candidate?: never;
  readonly noRecentTrade?: boolean;
}

export interface ProviderFailedSnapshot {
  readonly instrument: InstrumentKey;
  readonly fetchStatus: MarketDataFailureStatus;
  readonly candidate?: never;
  readonly noRecentTrade?: never;
}

export type ProviderSnapshotResult =
  | ProviderQuoteSnapshot
  | ProviderEmptySnapshot
  | ProviderFailedSnapshot;

export type MarketDataBatchResponse =
  | {
      readonly kind: "RESULTS";
      readonly results: readonly ProviderSnapshotResult[];
    }
  | {
      readonly kind: "BATCH_FAILURE";
      readonly fetchStatus: MarketDataFailureStatus;
    };

export interface MarketDataProviderRequest {
  readonly instruments: readonly InstrumentKey[];
  readonly marketSession: MarketSession;
}

export interface MarketDataProvider {
  getSnapshots(
    request: MarketDataProviderRequest,
  ): Promise<MarketDataBatchResponse>;
}

export interface LastValidQuoteWriteResult {
  readonly stored: boolean;
  readonly current: ValidMarketQuote;
}

export interface LastValidQuoteStore {
  getLastValidQuote(
    instrument: InstrumentKey,
  ): Promise<ValidMarketQuote | null>;
  putLastValidQuoteIfNewer(
    quote: ValidMarketQuote,
  ): Promise<LastValidQuoteWriteResult>;
}

export interface RefreshMarketDataRequest {
  readonly instruments: readonly InstrumentKey[];
  readonly now: string | (() => string);
  readonly marketSession: MarketSession;
  readonly closedSessionDataFinal?: boolean;
}

export interface RefreshMarketDataResult {
  readonly requestedInstrumentCount: number;
  readonly uniqueInstrumentCount: number;
  readonly quotes: readonly ResolvedQuote[];
}
