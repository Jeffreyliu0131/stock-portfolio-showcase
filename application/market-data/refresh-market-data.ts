import {
  createInstrumentKey,
  instrumentKeyId,
  resolveQuote,
  type InstrumentKey,
  type ResolvedQuote,
  type ValidMarketQuote,
} from "../../domain/index.ts";
import type {
  LastValidQuoteStore,
  MarketDataBatchResponse,
  MarketDataFailureStatus,
  MarketDataProvider,
  MarketDataProviderRequest,
  ProviderSnapshotResult,
  RefreshMarketDataRequest,
  RefreshMarketDataResult,
} from "./types.ts";

interface IndexedProviderResults {
  readonly byInstrument: ReadonlyMap<string, ProviderSnapshotResult>;
  readonly duplicateInstrumentKeys: ReadonlySet<string>;
}

type ReviewedRefreshMarketDataRequest = Omit<
  RefreshMarketDataRequest,
  "now"
> & {
  readonly now: string;
};

function reviewTime(
  request: RefreshMarketDataRequest,
): ReviewedRefreshMarketDataRequest {
  return {
    ...request,
    now:
      typeof request.now === "function"
        ? request.now()
        : request.now,
  };
}

function uniqueInstruments(
  instruments: readonly InstrumentKey[],
): readonly InstrumentKey[] {
  const seen = new Set<string>();
  const result: InstrumentKey[] = [];
  for (const instrumentInput of instruments) {
    const instrument = createInstrumentKey(instrumentInput);
    const key = instrumentKeyId(instrument);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(instrument);
    }
  }
  return result;
}

function indexProviderResults(
  results: readonly ProviderSnapshotResult[],
  requestedKeys: ReadonlySet<string>,
): IndexedProviderResults {
  const byInstrument = new Map<string, ProviderSnapshotResult>();
  const duplicateInstrumentKeys = new Set<string>();

  for (const result of results) {
    let key: string;
    try {
      key = instrumentKeyId(result.instrument);
    } catch {
      continue;
    }
    if (!requestedKeys.has(key) || duplicateInstrumentKeys.has(key)) {
      continue;
    }
    if (byInstrument.has(key)) {
      byInstrument.delete(key);
      duplicateInstrumentKeys.add(key);
      continue;
    }
    byInstrument.set(key, result);
  }

  return { byInstrument, duplicateInstrumentKeys };
}

function acceptedQuoteFrom(
  resolved: ResolvedQuote,
): ValidMarketQuote {
  if (
    !resolved.acceptedCandidate ||
    resolved.provider === null ||
    resolved.feed === null ||
    resolved.effectivePrice === null ||
    resolved.sourcePriceType === null ||
    resolved.sourceEventAt === null ||
    resolved.fetchedAt === null
  ) {
    throw new Error("accepted quote is missing required cache fields");
  }

  return {
    instrument: resolved.instrument,
    provider: resolved.provider,
    feed: resolved.feed,
    price: resolved.effectivePrice,
    priceType: resolved.sourcePriceType,
    sourceEventAt: resolved.sourceEventAt,
    fetchedAt: resolved.fetchedAt,
    marketSession: resolved.marketSession,
    ...(resolved.previousRegularClose === null
      ? {}
      : { previousRegularClose: resolved.previousRegularClose }),
  };
}

function resolveFallback(
  request: ReviewedRefreshMarketDataRequest,
  instrument: InstrumentKey,
  fetchStatus: MarketDataFailureStatus | "FETCH_OK",
  lastValidQuote: ValidMarketQuote | null,
  noRecentTrade = false,
): ResolvedQuote {
  return resolveQuote({
    requestedInstrument: instrument,
    now: request.now,
    fetchStatus,
    marketSession: request.marketSession,
    ...(lastValidQuote === null ? {} : { lastValidQuote }),
    ...(fetchStatus === "FETCH_OK" && noRecentTrade
      ? { noRecentTrade: true }
      : {}),
    closedSessionDataFinal: request.closedSessionDataFinal ?? false,
  });
}

async function resolveProviderResult(
  request: ReviewedRefreshMarketDataRequest,
  instrument: InstrumentKey,
  providerResult: ProviderSnapshotResult,
  store: LastValidQuoteStore,
): Promise<ResolvedQuote> {
  const lastValidQuote = await store.getLastValidQuote(instrument);

  if (providerResult.fetchStatus !== "FETCH_OK") {
    return resolveFallback(
      request,
      instrument,
      providerResult.fetchStatus,
      lastValidQuote,
    );
  }

  if (providerResult.candidate === undefined) {
    return resolveFallback(
      request,
      instrument,
      "FETCH_OK",
      lastValidQuote,
      providerResult.noRecentTrade ?? false,
    );
  }

  const resolved = resolveQuote({
    requestedInstrument: instrument,
    now: request.now,
    fetchStatus: "FETCH_OK",
    marketSession: request.marketSession,
    candidate: providerResult.candidate,
    ...(lastValidQuote === null ? {} : { lastValidQuote }),
    closedSessionDataFinal: request.closedSessionDataFinal ?? false,
  });
  if (!resolved.acceptedCandidate) {
    return resolved;
  }

  const writeResult = await store.putLastValidQuoteIfNewer(
    acceptedQuoteFrom(resolved),
  );
  if (writeResult.stored) {
    return resolved;
  }

  return resolveFallback(
    request,
    instrument,
    "FETCH_OK",
    writeResult.current,
  );
}

async function batchResponse(
  provider: MarketDataProvider,
  request: MarketDataProviderRequest,
): Promise<MarketDataBatchResponse> {
  try {
    return await provider.getSnapshots(request);
  } catch {
    return {
      kind: "BATCH_FAILURE",
      fetchStatus: "FETCH_FAILED",
    };
  }
}

export async function refreshMarketData(
  request: RefreshMarketDataRequest,
  provider: MarketDataProvider,
  store: LastValidQuoteStore,
): Promise<RefreshMarketDataResult> {
  const instruments = uniqueInstruments(request.instruments);
  if (instruments.length === 0) {
    return {
      requestedInstrumentCount: 0,
      uniqueInstrumentCount: 0,
      quotes: [],
    };
  }

  const response = await batchResponse(provider, {
    instruments,
    marketSession: request.marketSession,
  });
  const reviewedRequest = reviewTime(request);
  if (response.kind === "BATCH_FAILURE") {
    const quotes: ResolvedQuote[] = [];
    for (const instrument of instruments) {
      const lastValidQuote =
        await store.getLastValidQuote(instrument);
      quotes.push(
        resolveFallback(
          reviewedRequest,
          instrument,
          response.fetchStatus,
          lastValidQuote,
        ),
      );
    }
    return {
      requestedInstrumentCount: request.instruments.length,
      uniqueInstrumentCount: instruments.length,
      quotes,
    };
  }

  const requestedKeys = new Set(instruments.map(instrumentKeyId));
  const indexed = indexProviderResults(
    response.results,
    requestedKeys,
  );
  const quotes: ResolvedQuote[] = [];

  for (const instrument of instruments) {
    const key = instrumentKeyId(instrument);
    const providerResult = indexed.duplicateInstrumentKeys.has(key)
      ? undefined
      : indexed.byInstrument.get(key);
    if (providerResult === undefined) {
      const lastValidQuote =
        await store.getLastValidQuote(instrument);
      quotes.push(
        resolveFallback(
          reviewedRequest,
          instrument,
          "FETCH_FAILED",
          lastValidQuote,
        ),
      );
      continue;
    }
    quotes.push(
      await resolveProviderResult(
        reviewedRequest,
        instrument,
        providerResult,
        store,
      ),
    );
  }

  return {
    requestedInstrumentCount: request.instruments.length,
    uniqueInstrumentCount: instruments.length,
    quotes,
  };
}
