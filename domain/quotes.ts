import {
  Decimal,
  canonicalDecimal,
  parsePositiveInput,
  type DecimalString,
  type PreciseDecimal,
} from "./decimal.ts";
import { DomainValidationError, failDomain } from "./errors.ts";
import {
  createInstrumentKey,
  sameInstrument,
  type InstrumentKey,
} from "./instrument.ts";
import {
  ageInNanoseconds,
  compareRfc3339,
  minutesToNanoseconds,
  rfc3339ToEpochNanoseconds,
} from "./time.ts";

export type FetchStatus =
  | "FETCH_OK"
  | "NOT_REQUESTED"
  | "FETCH_FAILED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

export type MarketSession =
  | "PRE_MARKET"
  | "REGULAR"
  | "AFTER_HOURS"
  | "OVERNIGHT"
  | "CLOSED"
  | "HOLIDAY"
  | "UNKNOWN";

export type SourcePriceType =
  | "LATEST_TRADE"
  | "INDICATIVE_TRADE"
  | "LATEST_ELIGIBLE_TRADE"
  | "MINUTE_BAR_CLOSE"
  | "PREVIOUS_REGULAR_CLOSE";

export type EffectivePriceType =
  | SourcePriceType
  | "LAST_VALID_FALLBACK";

export type ValuationStatus =
  | "HEALTHY_DELAYED"
  | "AGING"
  | "STALE"
  | "NO_RECENT_TRADE"
  | "ANOMALOUS"
  | "UNAVAILABLE"
  | "CLOSED_FINAL";

export type QuoteCandidateRejection =
  | "MALFORMED"
  | "INSTRUMENT_MISMATCH"
  | "NON_POSITIVE_PRICE"
  | "SOURCE_EVENT_IN_FUTURE"
  | "SOURCE_EVENT_AFTER_FETCH"
  | "FETCH_TIME_IN_FUTURE"
  | "MARKET_SESSION_MISMATCH"
  | "OLDER_THAN_LAST_VALID"
  | "ANOMALOUS_CHANGE";

export interface QuoteCandidate {
  readonly instrument?: InstrumentKey;
  readonly provider?: string;
  readonly feed?: string;
  readonly price?: DecimalString;
  readonly priceType?: SourcePriceType;
  readonly sourceEventAt?: string;
  readonly fetchedAt?: string;
  readonly marketSession?: MarketSession;
  readonly previousRegularClose?: DecimalString;
}

export interface ValidMarketQuote {
  readonly instrument: InstrumentKey;
  readonly provider: string;
  readonly feed: string;
  readonly price: DecimalString;
  readonly priceType: SourcePriceType;
  readonly sourceEventAt: string;
  readonly fetchedAt: string;
  readonly marketSession: MarketSession;
  readonly previousRegularClose?: DecimalString;
}

export interface ResolveQuoteInput {
  readonly requestedInstrument: InstrumentKey;
  readonly now: string;
  readonly fetchStatus: FetchStatus;
  readonly marketSession: MarketSession;
  readonly candidate?: QuoteCandidate;
  readonly lastValidQuote?: ValidMarketQuote;
  readonly noRecentTrade?: boolean;
  readonly closedSessionDataFinal?: boolean;
}

export interface ResolvedQuote {
  readonly instrument: InstrumentKey;
  readonly provider: string | null;
  readonly feed: string | null;
  readonly effectivePrice: DecimalString | null;
  readonly effectivePriceType: EffectivePriceType | null;
  readonly sourcePriceType: SourcePriceType | null;
  readonly sourceEventAt: string | null;
  readonly fetchedAt: string | null;
  readonly previousRegularClose: DecimalString | null;
  readonly fetchStatus: FetchStatus;
  readonly marketSession: MarketSession;
  readonly valuationStatus: ValuationStatus;
  readonly usedLastValid: boolean;
  readonly acceptedCandidate: boolean;
  readonly candidateRejection: QuoteCandidateRejection | null;
}

interface InspectedCandidate {
  readonly quote?: ValidMarketQuote;
  readonly rejection?: QuoteCandidateRejection;
}

const VALID_SOURCE_PRICE_TYPES = new Set<SourcePriceType>([
  "LATEST_TRADE",
  "INDICATIVE_TRADE",
  "LATEST_ELIGIBLE_TRADE",
  "MINUTE_BAR_CLOSE",
  "PREVIOUS_REGULAR_CLOSE",
]);

const VALID_MARKET_SESSIONS = new Set<MarketSession>([
  "PRE_MARKET",
  "REGULAR",
  "AFTER_HOURS",
  "OVERNIGHT",
  "CLOSED",
  "HOLIDAY",
  "UNKNOWN",
]);

const VALID_FETCH_STATUSES = new Set<FetchStatus>([
  "FETCH_OK",
  "NOT_REQUESTED",
  "FETCH_FAILED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
]);

const ANOMALY_THRESHOLD = new Decimal("0.5");
const HEALTHY_EVENT_AGE = minutesToNanoseconds(17);
const STALE_EVENT_AGE = minutesToNanoseconds(20);
const HEALTHY_FETCH_AGE = minutesToNanoseconds(2);

function positiveQuoteDecimal(
  value: string,
  field: string,
): PreciseDecimal {
  return parsePositiveInput(value, field);
}

function inspectCandidate(
  candidate: QuoteCandidate,
  requestedInstrument: InstrumentKey,
  now: string,
  expectedMarketSession: MarketSession,
  lastValidQuote?: ValidMarketQuote,
): InspectedCandidate {
  if (
    candidate.instrument === undefined ||
    candidate.provider === undefined ||
    candidate.provider.trim().length === 0 ||
    candidate.feed === undefined ||
    candidate.feed.trim().length === 0 ||
    candidate.price === undefined ||
    candidate.priceType === undefined ||
    !VALID_SOURCE_PRICE_TYPES.has(candidate.priceType) ||
    candidate.sourceEventAt === undefined ||
    candidate.fetchedAt === undefined ||
    candidate.marketSession === undefined ||
    !VALID_MARKET_SESSIONS.has(candidate.marketSession)
  ) {
    return { rejection: "MALFORMED" };
  }

  let normalizedInstrument: InstrumentKey;
  let price: PreciseDecimal;
  try {
    normalizedInstrument = createInstrumentKey(candidate.instrument);
    price = positiveQuoteDecimal(candidate.price, "quote.price");
    rfc3339ToEpochNanoseconds(candidate.sourceEventAt, "quote.sourceEventAt");
    rfc3339ToEpochNanoseconds(candidate.fetchedAt, "quote.fetchedAt");
    if (candidate.previousRegularClose !== undefined) {
      positiveQuoteDecimal(
        candidate.previousRegularClose,
        "quote.previousRegularClose",
      );
    }
  } catch (error) {
    if (error instanceof DomainValidationError) {
      const invalidPrice = error.issues.some(
        (issue) =>
          issue.field === "quote.price" &&
          (issue.code === "INVALID_PRICE" ||
            issue.code === "INVALID_DECIMAL" ||
            issue.code === "DECIMAL_SCALE_EXCEEDED"),
      );
      return {
        rejection: invalidPrice ? "NON_POSITIVE_PRICE" : "MALFORMED",
      };
    }
    throw error;
  }

  if (!sameInstrument(normalizedInstrument, requestedInstrument)) {
    return { rejection: "INSTRUMENT_MISMATCH" };
  }
  if (candidate.marketSession !== expectedMarketSession) {
    return { rejection: "MARKET_SESSION_MISMATCH" };
  }
  if (ageInNanoseconds(now, candidate.sourceEventAt) < 0n) {
    return { rejection: "SOURCE_EVENT_IN_FUTURE" };
  }
  if (ageInNanoseconds(now, candidate.fetchedAt) < 0n) {
    return { rejection: "FETCH_TIME_IN_FUTURE" };
  }
  if (compareRfc3339(candidate.sourceEventAt, candidate.fetchedAt) > 0) {
    return { rejection: "SOURCE_EVENT_AFTER_FETCH" };
  }

  if (lastValidQuote !== undefined) {
    const sourceEventOrder = compareRfc3339(
      candidate.sourceEventAt,
      lastValidQuote.sourceEventAt,
    );
    if (
      sourceEventOrder < 0 ||
      (sourceEventOrder === 0 &&
        compareRfc3339(candidate.fetchedAt, lastValidQuote.fetchedAt) < 0)
    ) {
      return { rejection: "OLDER_THAN_LAST_VALID" };
    }

    const lastPrice = positiveQuoteDecimal(
      lastValidQuote.price,
      "lastValidQuote.price",
    );
    const absoluteChangeRate = price.sub(lastPrice).abs().div(lastPrice);
    if (absoluteChangeRate.gt(ANOMALY_THRESHOLD)) {
      return { rejection: "ANOMALOUS_CHANGE" };
    }
  }

  const previousRegularClose =
    candidate.previousRegularClose === undefined
      ? {}
      : { previousRegularClose: candidate.previousRegularClose };
  return {
    quote: {
      instrument: normalizedInstrument,
      provider: candidate.provider.trim(),
      feed: candidate.feed.trim(),
      price: canonicalDecimal(price),
      priceType: candidate.priceType,
      sourceEventAt: candidate.sourceEventAt,
      fetchedAt: candidate.fetchedAt,
      marketSession: candidate.marketSession,
      ...previousRegularClose,
    },
  };
}

function validateLastValidQuote(
  quote: ValidMarketQuote,
  requestedInstrument: InstrumentKey,
  now: string,
): ValidMarketQuote {
  const inspected = inspectCandidate(
    quote,
    requestedInstrument,
    now,
    quote.marketSession,
  );
  if (inspected.quote === undefined) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "lastValidQuote",
      message: `last valid quote violates cache invariants: ${String(inspected.rejection)}`,
    });
  }
  return inspected.quote;
}

function freshnessStatus(
  quote: ValidMarketQuote,
  now: string,
  marketSession: MarketSession,
  noRecentTrade: boolean,
  closedSessionDataFinal: boolean,
): ValuationStatus {
  if (marketSession === "CLOSED" || marketSession === "HOLIDAY") {
    return closedSessionDataFinal ? "CLOSED_FINAL" : "AGING";
  }

  const eventAge = ageInNanoseconds(now, quote.sourceEventAt);
  const fetchAge = ageInNanoseconds(now, quote.fetchedAt);

  if (marketSession === "UNKNOWN") {
    return eventAge > STALE_EVENT_AGE ? "STALE" : "AGING";
  }
  if (eventAge <= HEALTHY_EVENT_AGE && fetchAge <= HEALTHY_FETCH_AGE) {
    return "HEALTHY_DELAYED";
  }
  if (eventAge <= STALE_EVENT_AGE) {
    return "AGING";
  }
  return noRecentTrade ? "NO_RECENT_TRADE" : "STALE";
}

function unavailableResolution(
  input: ResolveQuoteInput,
  instrument: InstrumentKey,
  rejection: QuoteCandidateRejection | null,
): ResolvedQuote {
  return {
    instrument,
    provider: null,
    feed: null,
    effectivePrice: null,
    effectivePriceType: null,
    sourcePriceType: null,
    sourceEventAt: null,
    fetchedAt: null,
    previousRegularClose: null,
    fetchStatus: input.fetchStatus,
    marketSession: input.marketSession,
    valuationStatus: rejection === null ? "UNAVAILABLE" : "ANOMALOUS",
    usedLastValid: false,
    acceptedCandidate: false,
    candidateRejection: rejection,
  };
}

function fallbackResolution(
  input: ResolveQuoteInput,
  quote: ValidMarketQuote,
  status: ValuationStatus,
  rejection: QuoteCandidateRejection | null,
): ResolvedQuote {
  return {
    instrument: quote.instrument,
    provider: quote.provider,
    feed: quote.feed,
    effectivePrice: quote.price,
    effectivePriceType: "LAST_VALID_FALLBACK",
    sourcePriceType: quote.priceType,
    sourceEventAt: quote.sourceEventAt,
    fetchedAt: quote.fetchedAt,
    previousRegularClose: quote.previousRegularClose ?? null,
    fetchStatus: input.fetchStatus,
    marketSession: input.marketSession,
    valuationStatus: status,
    usedLastValid: true,
    acceptedCandidate: false,
    candidateRejection: rejection,
  };
}

export function resolveQuote(input: ResolveQuoteInput): ResolvedQuote {
  const requestedInstrument = createInstrumentKey(input.requestedInstrument);
  rfc3339ToEpochNanoseconds(input.now, "now");

  if (!VALID_MARKET_SESSIONS.has(input.marketSession)) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "marketSession",
      message: "marketSession is not supported",
    });
  }
  if (!VALID_FETCH_STATUSES.has(input.fetchStatus)) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "fetchStatus",
      message: "fetchStatus is not supported",
    });
  }
  if (
    input.fetchStatus !== "FETCH_OK" &&
    input.candidate !== undefined
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "candidate",
      message: "a failed fetch cannot supply an accepted quote candidate",
    });
  }
  if (
    input.fetchStatus !== "FETCH_OK" &&
    input.noRecentTrade === true
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "noRecentTrade",
      message: "noRecentTrade requires a successful provider fetch",
    });
  }
  if (input.candidate !== undefined && input.noRecentTrade === true) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "noRecentTrade",
      message: "a quote candidate and noRecentTrade cannot both be present",
    });
  }

  const lastValidQuote =
    input.lastValidQuote === undefined
      ? undefined
      : validateLastValidQuote(
          input.lastValidQuote,
          requestedInstrument,
          input.now,
        );

  if (input.fetchStatus === "FETCH_OK" && input.candidate !== undefined) {
    const inspected = inspectCandidate(
      input.candidate,
      requestedInstrument,
      input.now,
      input.marketSession,
      lastValidQuote,
    );
    if (inspected.quote !== undefined) {
      const status = freshnessStatus(
        inspected.quote,
        input.now,
        input.marketSession,
        input.noRecentTrade ?? false,
        input.closedSessionDataFinal ?? false,
      );
      return {
        instrument: inspected.quote.instrument,
        provider: inspected.quote.provider,
        feed: inspected.quote.feed,
        effectivePrice: inspected.quote.price,
        effectivePriceType: inspected.quote.priceType,
        sourcePriceType: inspected.quote.priceType,
        sourceEventAt: inspected.quote.sourceEventAt,
        fetchedAt: inspected.quote.fetchedAt,
        previousRegularClose:
          inspected.quote.previousRegularClose ?? null,
        fetchStatus: input.fetchStatus,
        marketSession: input.marketSession,
        valuationStatus: status,
        usedLastValid: false,
        acceptedCandidate: true,
        candidateRejection: null,
      };
    }

    if (lastValidQuote === undefined) {
      return unavailableResolution(
        input,
        requestedInstrument,
        inspected.rejection ?? "MALFORMED",
      );
    }
    return fallbackResolution(
      input,
      lastValidQuote,
      "ANOMALOUS",
      inspected.rejection ?? "MALFORMED",
    );
  }

  if (lastValidQuote === undefined) {
    return unavailableResolution(input, requestedInstrument, null);
  }

  let status = freshnessStatus(
    lastValidQuote,
    input.now,
    input.marketSession,
    input.noRecentTrade ?? false,
    input.closedSessionDataFinal ?? false,
  );
  if (input.noRecentTrade === true && status !== "CLOSED_FINAL") {
    status = "NO_RECENT_TRADE";
  } else if (
    input.fetchStatus !== "FETCH_OK" &&
    status === "HEALTHY_DELAYED"
  ) {
    status = "AGING";
  }

  return fallbackResolution(input, lastValidQuote, status, null);
}
