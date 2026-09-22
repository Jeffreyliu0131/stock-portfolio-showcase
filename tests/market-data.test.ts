import { describe, expect, it } from "vitest";

import {
  FixtureMarketDataProvider,
  InMemoryLastValidQuoteStore,
  refreshMarketData,
  type MarketDataBatchResponse,
  type MarketDataFailureStatus,
} from "../application/market-data/index.ts";
import type {
  InstrumentKey,
  QuoteCandidate,
} from "../domain/index.ts";
import { AAPL, MSFT, validQuote } from "./helpers.ts";

const TSLA: InstrumentKey = {
  listingMarket: "NASDAQ",
  symbol: "TSLA",
  currency: "USD",
};

function candidate(
  instrument: InstrumentKey,
  overrides: Partial<QuoteCandidate> = {},
): QuoteCandidate {
  return {
    ...validQuote({ instrument }),
    ...overrides,
  };
}

function resultBySymbol(
  quotes: Awaited<ReturnType<typeof refreshMarketData>>["quotes"],
  symbol: string,
) {
  const result = quotes.find(
    (quote) => quote.instrument.symbol === symbol,
  );
  if (result === undefined) {
    throw new Error(`missing result for ${symbol}`);
  }
  return result;
}

describe("provider-neutral market-data refresh", () => {
  it("uses one aligned batch and isolates one failed instrument", async () => {
    const provider = new FixtureMarketDataProvider([
      {
        kind: "RESULTS",
        results: [
          {
            instrument: TSLA,
            fetchStatus: "FETCH_FAILED",
          },
          {
            instrument: MSFT,
            fetchStatus: "FETCH_OK",
            candidate: candidate(MSFT, { price: "420" }),
          },
          {
            instrument: AAPL,
            fetchStatus: "FETCH_OK",
            candidate: candidate(AAPL, { price: "210" }),
          },
        ],
      },
    ]);
    const store = new InMemoryLastValidQuoteStore();

    const refreshed = await refreshMarketData(
      {
        instruments: [AAPL, MSFT, TSLA],
        now: "2026-07-29T15:01:00Z",
        marketSession: "REGULAR",
      },
      provider,
      store,
    );

    expect(provider.requests).toHaveLength(1);
    expect(
      provider.requests[0]?.map((instrument) => instrument.symbol),
    ).toEqual(["AAPL", "MSFT", "TSLA"]);
    expect(provider.marketSessions).toEqual(["REGULAR"]);
    expect(refreshed.quotes.map((quote) => quote.instrument.symbol)).toEqual([
      "AAPL",
      "MSFT",
      "TSLA",
    ]);
    expect(resultBySymbol(refreshed.quotes, "AAPL").effectivePrice).toBe(
      "210",
    );
    expect(resultBySymbol(refreshed.quotes, "MSFT").effectivePrice).toBe(
      "420",
    );
    expect(resultBySymbol(refreshed.quotes, "TSLA")).toMatchObject({
      fetchStatus: "FETCH_FAILED",
      valuationStatus: "UNAVAILABLE",
      effectivePrice: null,
    });
  });

  it.each([
    "RATE_LIMITED",
    "UNAUTHORIZED",
  ] satisfies readonly MarketDataFailureStatus[])(
    "keeps a per-instrument %s failure distinct without affecting peers",
    async (failureStatus) => {
      const provider = new FixtureMarketDataProvider([
        {
          kind: "RESULTS",
          results: [
            {
              instrument: AAPL,
              fetchStatus: "FETCH_OK",
              candidate: candidate(AAPL, { price: "211" }),
            },
            {
              instrument: MSFT,
              fetchStatus: failureStatus,
            },
          ],
        },
      ]);

      const refreshed = await refreshMarketData(
        {
          instruments: [AAPL, MSFT],
          now: "2026-07-29T15:01:00Z",
          marketSession: "REGULAR",
        },
        provider,
        new InMemoryLastValidQuoteStore(),
      );

      expect(resultBySymbol(refreshed.quotes, "AAPL").effectivePrice).toBe(
        "211",
      );
      expect(resultBySymbol(refreshed.quotes, "MSFT").fetchStatus).toBe(
        failureStatus,
      );
    },
  );

  it("applies a batch-wide failure to every instrument while preserving cache", async () => {
    const store = new InMemoryLastValidQuoteStore();
    await store.putLastValidQuoteIfNewer(
      validQuote({ instrument: AAPL, price: "205" }),
    );
    const provider = new FixtureMarketDataProvider([
      {
        kind: "BATCH_FAILURE",
        fetchStatus: "RATE_LIMITED",
      },
    ]);

    const refreshed = await refreshMarketData(
      {
        instruments: [AAPL, MSFT],
        now: "2026-07-29T15:01:00Z",
        marketSession: "REGULAR",
      },
      provider,
      store,
    );

    expect(resultBySymbol(refreshed.quotes, "AAPL")).toMatchObject({
      fetchStatus: "RATE_LIMITED",
      effectivePrice: "205",
      effectivePriceType: "LAST_VALID_FALLBACK",
      usedLastValid: true,
    });
    expect(resultBySymbol(refreshed.quotes, "MSFT")).toMatchObject({
      fetchStatus: "RATE_LIMITED",
      effectivePrice: null,
      valuationStatus: "UNAVAILABLE",
    });
  });

  it("updates cache only for accepted candidates and falls back on failure or anomaly", async () => {
    const responses: readonly MarketDataBatchResponse[] = [
      {
        kind: "RESULTS",
        results: [
          {
            instrument: AAPL,
            fetchStatus: "FETCH_OK",
            candidate: candidate(AAPL, { price: "130" }),
          },
        ],
      },
      {
        kind: "RESULTS",
        results: [
          {
            instrument: AAPL,
            fetchStatus: "FETCH_FAILED",
          },
        ],
      },
      {
        kind: "RESULTS",
        results: [
          {
            instrument: AAPL,
            fetchStatus: "FETCH_OK",
            candidate: candidate(AAPL, {
              price: "300",
              sourceEventAt: "2026-07-29T14:47:00Z",
              fetchedAt: "2026-07-29T15:02:30Z",
            }),
          },
        ],
      },
    ];
    const provider = new FixtureMarketDataProvider(responses);
    const store = new InMemoryLastValidQuoteStore();

    const first = await refreshMarketData(
      {
        instruments: [AAPL],
        now: "2026-07-29T15:01:00Z",
        marketSession: "REGULAR",
      },
      provider,
      store,
    );
    const failed = await refreshMarketData(
      {
        instruments: [AAPL],
        now: "2026-07-29T15:02:00Z",
        marketSession: "REGULAR",
      },
      provider,
      store,
    );
    const anomalous = await refreshMarketData(
      {
        instruments: [AAPL],
        now: "2026-07-29T15:03:00Z",
        marketSession: "REGULAR",
      },
      provider,
      store,
    );

    expect(first.quotes[0]).toMatchObject({
      acceptedCandidate: true,
      effectivePrice: "130",
    });
    expect(failed.quotes[0]).toMatchObject({
      acceptedCandidate: false,
      effectivePrice: "130",
      usedLastValid: true,
    });
    expect(anomalous.quotes[0]).toMatchObject({
      acceptedCandidate: false,
      effectivePrice: "130",
      candidateRejection: "ANOMALOUS_CHANGE",
    });
    expect((await store.getLastValidQuote(AAPL))?.price).toBe("130");
  });

  it("ignores an out-of-order candidate and never overwrites the newer cached quote", async () => {
    const store = new InMemoryLastValidQuoteStore();
    await store.putLastValidQuoteIfNewer(
      validQuote({
        instrument: AAPL,
        price: "131",
        sourceEventAt: "2026-07-29T14:46:00Z",
        fetchedAt: "2026-07-29T15:00:30Z",
      }),
    );
    const provider = new FixtureMarketDataProvider([
      {
        kind: "RESULTS",
        results: [
          {
            instrument: AAPL,
            fetchStatus: "FETCH_OK",
            candidate: candidate(AAPL, {
              price: "130",
              sourceEventAt: "2026-07-29T14:45:00Z",
              fetchedAt: "2026-07-29T15:01:00Z",
            }),
          },
        ],
      },
    ]);

    const refreshed = await refreshMarketData(
      {
        instruments: [AAPL],
        now: "2026-07-29T15:02:00Z",
        marketSession: "REGULAR",
      },
      provider,
      store,
    );

    expect(refreshed.quotes[0]).toMatchObject({
      acceptedCandidate: false,
      effectivePrice: "131",
      effectivePriceType: "LAST_VALID_FALLBACK",
      usedLastValid: true,
      candidateRejection: "OLDER_THAN_LAST_VALID",
    });
    expect(await store.getLastValidQuote(AAPL)).toMatchObject({
      price: "131",
      sourceEventAt: "2026-07-29T14:46:00Z",
    });
  });

  it("deduplicates requests and refuses to align a mismatched candidate by array position", async () => {
    const provider = new FixtureMarketDataProvider([
      {
        kind: "RESULTS",
        results: [
          {
            instrument: AAPL,
            fetchStatus: "FETCH_OK",
            candidate: candidate(MSFT, { price: "420" }),
          },
          {
            instrument: MSFT,
            fetchStatus: "FETCH_OK",
            candidate: candidate(MSFT, { price: "421" }),
          },
        ],
      },
    ]);

    const refreshed = await refreshMarketData(
      {
        instruments: [AAPL, AAPL, MSFT],
        now: "2026-07-29T15:01:00Z",
        marketSession: "REGULAR",
      },
      provider,
      new InMemoryLastValidQuoteStore(),
    );

    expect(refreshed.requestedInstrumentCount).toBe(3);
    expect(refreshed.uniqueInstrumentCount).toBe(2);
    expect(provider.requests[0]?.map((item) => item.symbol)).toEqual([
      "AAPL",
      "MSFT",
    ]);
    expect(resultBySymbol(refreshed.quotes, "AAPL")).toMatchObject({
      acceptedCandidate: false,
      effectivePrice: null,
      candidateRejection: "INSTRUMENT_MISMATCH",
    });
    expect(resultBySymbol(refreshed.quotes, "MSFT")).toMatchObject({
      acceptedCandidate: true,
      effectivePrice: "421",
    });
  });
});
