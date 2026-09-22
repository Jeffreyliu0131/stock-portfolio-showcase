import { describe, expect, it, vi } from "vitest";

import {
  InMemoryLastValidQuoteStore,
  refreshMarketData,
} from "../application/market-data/index.ts";
import {
  ALPACA_DELAYED_SIP_FEED,
  ALPACA_MARKET_DATA_PROVIDER,
  ALPACA_OVERNIGHT_FEED,
  AlpacaMarketDataProvider,
  type AlpacaHttpFetch,
  type AlpacaHttpResponse,
} from "../application/market-data/server/index.ts";
import type {
  InstrumentKey,
  MarketSession,
} from "../domain/index.ts";
import { AAPL, MSFT, validQuote } from "./helpers.ts";

const FETCHED_AT = "2026-07-29T15:00:30Z";
const API_KEY_ID = "test-key-id";
const API_SECRET_KEY = "test-secret-key";

function response(
  status: number,
  body = "{}",
): AlpacaHttpResponse {
  return {
    status,
    async text() {
      return body;
    },
  };
}

function request(
  instruments: readonly InstrumentKey[],
  marketSession: MarketSession = "REGULAR",
) {
  return { instruments, marketSession } as const;
}

function providerWith(fetchImpl: AlpacaHttpFetch) {
  return new AlpacaMarketDataProvider({
    apiKeyId: API_KEY_ID,
    apiSecretKey: API_SECRET_KEY,
    fetchImpl,
    now: () => FETCHED_AT,
  });
}

describe("server-only Alpaca delayed SIP adapter", () => {
  it("rejects an oversized upstream snapshot response before JSON parsing", async () => {
    const result = await providerWith(async () =>
      response(200, "x".repeat(4 * 1024 * 1024 + 1)),
    ).getSnapshots(request([AAPL]));

    expect(result).toEqual({
      kind: "BATCH_FAILURE",
      fetchStatus: "FETCH_FAILED",
    });
  });

  it("sends one explicit delayed_sip batch and maps wire numbers without float coercion", async () => {
    const fetchImpl = vi.fn<AlpacaHttpFetch>(async () =>
      response(
        200,
        `{
          "AAPL": {
            "latestTrade": {
              "p": 130.12345678,
              "t": "2026-07-29T14:45:00.123456789Z"
            },
            "dailyBar": {
              "c": 130.9,
              "t": "2026-07-29T04:00:00Z"
            },
            "prevDailyBar": {
              "c": 125.00000001,
              "t": "2026-07-28T04:00:00Z"
            }
          },
          "MSFT": {
            "latestTrade": {
              "p": 99999999999999999999.12345678,
              "t": "2026-07-29T14:45:01Z"
            },
            "dailyBar": {
              "c": 420,
              "t": "2026-07-29T04:00:00Z"
            },
            "prevDailyBar": {
              "c": 419.5,
              "t": "2026-07-28T04:00:00Z"
            }
          }
        }`,
      ),
    );
    const provider = providerWith(fetchImpl);

    const result = await provider.getSnapshots(
      request([AAPL, MSFT]),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (call === undefined) {
      throw new Error("missing Alpaca HTTP request");
    }
    const [rawUrl, init] = call;
    const url = new URL(rawUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://data.alpaca.markets/v2/stocks/snapshots",
    );
    expect(url.searchParams.get("symbols")).toBe("AAPL,MSFT");
    expect(url.searchParams.get("feed")).toBe("delayed_sip");
    expect(url.searchParams.get("currency")).toBe("USD");
    expect(rawUrl).not.toContain(API_KEY_ID);
    expect(rawUrl).not.toContain(API_SECRET_KEY);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "APCA-API-KEY-ID": API_KEY_ID,
      "APCA-API-SECRET-KEY": API_SECRET_KEY,
    });

    expect(result).toEqual({
      kind: "RESULTS",
      results: [
        {
          instrument: AAPL,
          fetchStatus: "FETCH_OK",
          candidate: {
            instrument: AAPL,
            provider: ALPACA_MARKET_DATA_PROVIDER,
            feed: ALPACA_DELAYED_SIP_FEED,
            price: "130.12345678",
            priceType: "LATEST_TRADE",
            sourceEventAt: "2026-07-29T14:45:00.123456789Z",
            fetchedAt: FETCHED_AT,
            marketSession: "REGULAR",
            previousRegularClose: "125.00000001",
          },
        },
        {
          instrument: MSFT,
          fetchStatus: "FETCH_OK",
          candidate: {
            instrument: MSFT,
            provider: ALPACA_MARKET_DATA_PROVIDER,
            feed: ALPACA_DELAYED_SIP_FEED,
            price: "99999999999999999999.12345678",
            priceType: "LATEST_TRADE",
            sourceEventAt: "2026-07-29T14:45:01Z",
            fetchedAt: FETCHED_AT,
            marketSession: "REGULAR",
            previousRegularClose: "419.5",
          },
        },
      ],
    });
  });

  it("fills missing symbols and absent latest trades as explicit no-data results", async () => {
    const provider = providerWith(async () =>
      response(
        200,
        `{
          "AAPL": {
            "dailyBar": {"c": 130, "t": "2026-07-29T04:00:00Z"}
          }
        }`,
      ),
    );

    await expect(
      provider.getSnapshots(request([AAPL, MSFT])),
    ).resolves.toEqual({
      kind: "RESULTS",
      results: [
        {
          instrument: AAPL,
          fetchStatus: "FETCH_OK",
          noRecentTrade: true,
        },
        {
          instrument: MSFT,
          fetchStatus: "FETCH_OK",
          noRecentTrade: true,
        },
      ],
    });
  });

  it("uses the Basic-plan overnight feed and marks its derived trade honestly", async () => {
    const fetchImpl = vi.fn<AlpacaHttpFetch>(async () =>
      response(
        200,
        `{
          "AAPL": {
            "latestTrade": {
              "p": 130.25,
              "t": "2026-07-29T02:45:00Z"
            }
          }
        }`,
      ),
    );
    const provider = providerWith(fetchImpl);

    const result = await provider.getSnapshots(
      request([AAPL], "OVERNIGHT"),
    );

    const rawUrl = fetchImpl.mock.calls[0]?.[0];
    expect(rawUrl).toBeDefined();
    expect(new URL(rawUrl ?? "").searchParams.get("feed")).toBe(
      ALPACA_OVERNIGHT_FEED,
    );
    expect(result).toEqual({
      kind: "RESULTS",
      results: [
        {
          instrument: AAPL,
          fetchStatus: "FETCH_OK",
          candidate: {
            instrument: AAPL,
            provider: ALPACA_MARKET_DATA_PROVIDER,
            feed: ALPACA_OVERNIGHT_FEED,
            price: "130.25",
            priceType: "INDICATIVE_TRADE",
            sourceEventAt: "2026-07-29T02:45:00Z",
            fetchedAt: FETCHED_AT,
            marketSession: "OVERNIGHT",
          },
        },
      ],
    });
  });

  it("isolates a malformed symbol and ignores extra response symbols", async () => {
    const provider = providerWith(async () =>
      response(
        200,
        `{
          "AAPL": {
            "latestTrade": {"p": true, "t": "2026-07-29T14:45:00Z"}
          },
          "MSFT": {
            "latestTrade": {"p": 420.25, "t": "2026-07-29T14:45:01Z"},
            "dailyBar": {"c": 421, "t": "2026-07-29T04:00:00Z"},
            "prevDailyBar": {"c": 419, "t": "2026-07-28T04:00:00Z"}
          },
          "TSLA": {
            "latestTrade": {"p": 300, "t": "2026-07-29T14:45:02Z"}
          }
        }`,
      ),
    );

    const result = await provider.getSnapshots(
      request([AAPL, MSFT]),
    );

    expect(result).toMatchObject({
      kind: "RESULTS",
      results: [
        { instrument: AAPL, fetchStatus: "FETCH_FAILED" },
        {
          instrument: MSFT,
          fetchStatus: "FETCH_OK",
          candidate: {
            price: "420.25",
            sourceEventAt: "2026-07-29T14:45:01Z",
          },
        },
      ],
    });
    if (result.kind !== "RESULTS") {
      throw new Error("expected per-symbol results");
    }
    expect(result.results).toHaveLength(2);
  });

  it.each([
    [400, "FETCH_FAILED"],
    [401, "UNAUTHORIZED"],
    [403, "UNAUTHORIZED"],
    [404, "FETCH_FAILED"],
    [422, "FETCH_FAILED"],
    [429, "RATE_LIMITED"],
    [500, "FETCH_FAILED"],
    [503, "FETCH_FAILED"],
  ] as const)(
    "maps HTTP %i to a batch-wide %s without parsing an error body",
    async (status, expectedStatus) => {
      const text = vi.fn(async () => {
        throw new Error("error bodies must not be parsed");
      });
      const provider = providerWith(async () => ({ status, text }));

      const result = await provider.getSnapshots(request([AAPL]));

      expect(result).toEqual({
        kind: "BATCH_FAILURE",
        fetchStatus: expectedStatus,
      });
      expect(text).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(API_KEY_ID);
      expect(JSON.stringify(result)).not.toContain(API_SECRET_KEY);
    },
  );

  it.each([
    ["network failure", async () => Promise.reject(new Error("offline"))],
    ["malformed JSON", async () => response(200, '{"AAPL":')],
    ["non-object JSON", async () => response(200, "[]")],
  ] satisfies readonly [
    string,
    AlpacaHttpFetch,
  ][])("turns %s into a safe batch failure", async (_name, fetchImpl) => {
    const provider = providerWith(fetchImpl);

    await expect(
      provider.getSnapshots(request([AAPL])),
    ).resolves.toEqual({
      kind: "BATCH_FAILURE",
      fetchStatus: "FETCH_FAILED",
    });
  });

  it("aborts a request at the configured timeout", async () => {
    const fetchImpl: AlpacaHttpFetch = async (_url, init) =>
      new Promise<AlpacaHttpResponse>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    const provider = new AlpacaMarketDataProvider({
      apiKeyId: API_KEY_ID,
      apiSecretKey: API_SECRET_KEY,
      fetchImpl,
      now: () => FETCHED_AT,
      timeoutMs: 1,
    });

    await expect(
      provider.getSnapshots(request([AAPL])),
    ).resolves.toEqual({
      kind: "BATCH_FAILURE",
      fetchStatus: "FETCH_FAILED",
    });
  });

  it("does not send non-USD or symbol-ambiguous instruments to Alpaca", async () => {
    const nyseAapl = { ...AAPL, listingMarket: "NYSE" };
    const gbpVod: InstrumentKey = {
      listingMarket: "LSE",
      symbol: "VOD",
      currency: "GBP",
    };
    const fetchImpl = vi.fn<AlpacaHttpFetch>(async () =>
      response(
        200,
        `{
          "MSFT": {
            "latestTrade": {"p": 420, "t": "2026-07-29T14:45:00Z"},
            "dailyBar": {"c": 421, "t": "2026-07-29T04:00:00Z"},
            "prevDailyBar": {"c": 419, "t": "2026-07-28T04:00:00Z"}
          }
        }`,
      ),
    );
    const provider = providerWith(fetchImpl);

    const result = await provider.getSnapshots(
      request([AAPL, nyseAapl, gbpVod, MSFT]),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const rawUrl = fetchImpl.mock.calls[0]?.[0];
    expect(rawUrl).toBeDefined();
    expect(new URL(rawUrl ?? "").searchParams.get("symbols")).toBe(
      "MSFT",
    );
    expect(result).toMatchObject({
      kind: "RESULTS",
      results: [
        { fetchStatus: "FETCH_FAILED" },
        { fetchStatus: "FETCH_FAILED" },
        { fetchStatus: "FETCH_FAILED" },
        {
          fetchStatus: "FETCH_OK",
          candidate: { price: "420" },
        },
      ],
    });
  });

  it.each([
    ["PRE_MARKET", "130"],
    ["AFTER_HOURS", "130"],
    ["OVERNIGHT", undefined],
    ["CLOSED", undefined],
    ["HOLIDAY", undefined],
    ["UNKNOWN", undefined],
  ] as const)(
    "maps the conservative %s regular-close reference",
    async (marketSession, expectedClose) => {
      const provider = providerWith(async () =>
        response(
          200,
          `{
            "AAPL": {
              "latestTrade": {"p": 131, "t": "2026-07-29T14:45:00Z"},
              "dailyBar": {"c": 130, "t": "2026-07-28T04:00:00Z"},
              "prevDailyBar": {"c": 125, "t": "2026-07-25T04:00:00Z"}
            }
          }`,
        ),
      );

      const result = await provider.getSnapshots(
        request([AAPL], marketSession),
      );

      if (
        result.kind !== "RESULTS" ||
        result.results[0]?.fetchStatus !== "FETCH_OK" ||
        result.results[0].candidate === undefined
      ) {
        throw new Error("expected a quote candidate");
      }
      expect(
        result.results[0].candidate.previousRegularClose,
      ).toBe(expectedClose);
    },
  );

  it("uses the delayed SIP daily bar as the overnight regular-close reference", async () => {
    const fetchImpl = vi.fn<AlpacaHttpFetch>(async () =>
      response(
        200,
        `{
          "AAPL": {
            "latestTrade": {"p": 131, "t": "2026-07-29T14:45:00Z"},
            "dailyBar": {"c": 130, "t": "2026-07-28T04:00:00Z"},
            "prevDailyBar": {"c": 125, "t": "2026-07-25T04:00:00Z"}
          }
        }`,
      ),
    );
    const provider = new AlpacaMarketDataProvider({
      apiKeyId: API_KEY_ID,
      apiSecretKey: API_SECRET_KEY,
      feed: ALPACA_DELAYED_SIP_FEED,
      fetchImpl,
      now: () => FETCHED_AT,
    });

    const result = await provider.getSnapshots(
      request([AAPL], "OVERNIGHT"),
    );

    expect(result).toMatchObject({
      kind: "RESULTS",
      results: [
        {
          candidate: {
            feed: ALPACA_DELAYED_SIP_FEED,
            marketSession: "OVERNIGHT",
            previousRegularClose: "130",
          },
        },
      ],
    });
  });

  it("uses dailyBar as the regular-session reference until today's delayed bar exists", async () => {
    const provider = providerWith(async () =>
      response(
        200,
        `{
          "AAPL": {
            "latestTrade": {"p": 131, "t": "2026-07-28T23:59:00Z"},
            "dailyBar": {"c": 130, "t": "2026-07-28T04:00:00Z"},
            "prevDailyBar": {"c": 125, "t": "2026-07-25T04:00:00Z"}
          }
        }`,
      ),
    );

    const result = await provider.getSnapshots(request([AAPL]));

    expect(result).toMatchObject({
      kind: "RESULTS",
      results: [
        {
          candidate: {
            previousRegularClose: "130",
          },
        },
      ],
    });
  });

  it("preserves the last valid price when Alpaca returns zero", async () => {
    const provider = providerWith(async () =>
      response(
        200,
        `{
          "AAPL": {
            "latestTrade": {"p": 0, "t": "2026-07-29T14:45:00Z"},
            "dailyBar": {"c": 130, "t": "2026-07-29T04:00:00Z"},
            "prevDailyBar": {"c": 125, "t": "2026-07-28T04:00:00Z"}
          }
        }`,
      ),
    );
    const store = new InMemoryLastValidQuoteStore();
    await store.putLastValidQuoteIfNewer(
      validQuote({ instrument: AAPL, price: "130" }),
    );

    const result = await refreshMarketData(
      {
        instruments: [AAPL],
        now: "2026-07-29T15:01:00Z",
        marketSession: "REGULAR",
      },
      provider,
      store,
    );

    expect(result.quotes[0]).toMatchObject({
      effectivePrice: "130",
      effectivePriceType: "LAST_VALID_FALLBACK",
      acceptedCandidate: false,
      usedLastValid: true,
      candidateRejection: "NON_POSITIVE_PRICE",
    });
  });

  it("requires credentials without ever echoing their values", () => {
    expect(
      () =>
        new AlpacaMarketDataProvider({
          apiKeyId: "",
          apiSecretKey: API_SECRET_KEY,
        }),
    ).toThrow("Alpaca API key ID is required");
    expect(
      () =>
        new AlpacaMarketDataProvider({
          apiKeyId: API_KEY_ID,
          apiSecretKey: " ",
        }),
    ).toThrow("Alpaca API secret key is required");
  });

  it("refuses construction in a browser runtime", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    try {
      expect(
        () =>
          new AlpacaMarketDataProvider({
            apiKeyId: API_KEY_ID,
            apiSecretKey: API_SECRET_KEY,
          }),
      ).toThrow(
        "AlpacaMarketDataProvider can only run in a server runtime",
      );
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", previousWindow);
      }
    }
  });

  it("returns immediately for an empty batch without network access", async () => {
    const fetchImpl = vi.fn<AlpacaHttpFetch>();
    const provider = providerWith(fetchImpl);

    await expect(
      provider.getSnapshots(request([])),
    ).resolves.toEqual({
      kind: "RESULTS",
      results: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
