import type { ResolvedQuote } from "../../domain/quotes.ts";

export const MAX_QUOTE_REQUEST_INSTRUMENTS = 100;

export type QuoteApiErrorCode =
  | "INVALID_REQUEST"
  | "TOO_MANY_INSTRUMENTS"
  | "RATE_LIMITED"
  | "MARKET_DATA_NOT_CONFIGURED"
  | "MARKET_DATA_UNAVAILABLE";

export interface QuoteApiSuccess {
  readonly kind: "QUOTES";
  readonly generatedAt: string;
  readonly quotes: readonly ResolvedQuote[];
}

export interface QuoteApiError {
  readonly kind: "ERROR";
  readonly code: QuoteApiErrorCode;
  readonly message: string;
}

export type QuoteApiResponse = QuoteApiSuccess | QuoteApiError;
