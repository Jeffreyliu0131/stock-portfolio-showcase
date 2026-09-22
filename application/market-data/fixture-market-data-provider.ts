import type {
  InstrumentKey,
  QuoteCandidate,
} from "../../domain/index.ts";
import type {
  MarketDataBatchResponse,
  MarketDataProvider,
  MarketDataProviderRequest,
  ProviderSnapshotResult,
} from "./types.ts";

function cloneInstrument(instrument: InstrumentKey): InstrumentKey {
  return { ...instrument };
}

function cloneCandidate(candidate: QuoteCandidate): QuoteCandidate {
  return {
    ...(candidate.instrument === undefined
      ? {}
      : { instrument: cloneInstrument(candidate.instrument) }),
    ...(candidate.provider === undefined
      ? {}
      : { provider: candidate.provider }),
    ...(candidate.feed === undefined ? {} : { feed: candidate.feed }),
    ...(candidate.price === undefined ? {} : { price: candidate.price }),
    ...(candidate.priceType === undefined
      ? {}
      : { priceType: candidate.priceType }),
    ...(candidate.sourceEventAt === undefined
      ? {}
      : { sourceEventAt: candidate.sourceEventAt }),
    ...(candidate.fetchedAt === undefined
      ? {}
      : { fetchedAt: candidate.fetchedAt }),
    ...(candidate.marketSession === undefined
      ? {}
      : { marketSession: candidate.marketSession }),
    ...(candidate.previousRegularClose === undefined
      ? {}
      : { previousRegularClose: candidate.previousRegularClose }),
  };
}

function cloneSnapshotResult(
  result: ProviderSnapshotResult,
): ProviderSnapshotResult {
  if (result.fetchStatus !== "FETCH_OK") {
    return {
      instrument: cloneInstrument(result.instrument),
      fetchStatus: result.fetchStatus,
    };
  }
  if (result.candidate !== undefined) {
    return {
      instrument: cloneInstrument(result.instrument),
      fetchStatus: "FETCH_OK",
      candidate: cloneCandidate(result.candidate),
    };
  }
  return {
    instrument: cloneInstrument(result.instrument),
    fetchStatus: "FETCH_OK",
    ...(result.noRecentTrade === undefined
      ? {}
      : { noRecentTrade: result.noRecentTrade }),
  };
}

function cloneResponse(
  response: MarketDataBatchResponse,
): MarketDataBatchResponse {
  if (response.kind === "BATCH_FAILURE") {
    return {
      kind: "BATCH_FAILURE",
      fetchStatus: response.fetchStatus,
    };
  }
  return {
    kind: "RESULTS",
    results: response.results.map(cloneSnapshotResult),
  };
}

export class FixtureMarketDataProvider implements MarketDataProvider {
  private readonly scriptedResponses: readonly MarketDataBatchResponse[];
  private readonly requestLog: MarketDataProviderRequest[] = [];
  private nextResponseIndex = 0;

  constructor(responses: readonly MarketDataBatchResponse[]) {
    this.scriptedResponses = responses.map(cloneResponse);
  }

  get requests(): readonly (readonly InstrumentKey[])[] {
    return this.requestLog.map((request) =>
      request.instruments.map(cloneInstrument),
    );
  }

  get marketSessions(): readonly MarketDataProviderRequest["marketSession"][] {
    return this.requestLog.map((request) => request.marketSession);
  }

  async getSnapshots(
    request: MarketDataProviderRequest,
  ): Promise<MarketDataBatchResponse> {
    this.requestLog.push({
      instruments: request.instruments.map(cloneInstrument),
      marketSession: request.marketSession,
    });
    const response = this.scriptedResponses[this.nextResponseIndex];
    this.nextResponseIndex += 1;
    if (response === undefined) {
      throw new Error("fixture provider has no scripted response");
    }
    return cloneResponse(response);
  }
}
