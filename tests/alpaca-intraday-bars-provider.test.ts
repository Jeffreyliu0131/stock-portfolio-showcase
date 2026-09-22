import { describe, expect, it, vi } from "vitest";

import {
  INTRADAY_BAR_ADJUSTMENT,
  INTRADAY_BAR_SOURCE_FEED,
  INTRADAY_BAR_TIMEFRAME,
} from "../application/market-data/intraday-bars-api.ts";
import {
  AlpacaIntradayBarsProvider,
  type AlpacaIntradayBarsFetch,
  type AlpacaIntradayBarsHttpResponse,
} from "../application/market-data/server/alpaca-intraday-bars-provider.ts";
import { AAPL, MSFT } from "./helpers.ts";

const NOW = "2026-08-07T15:30:00Z";
const API_KEY_ID = "test-key-id";
const API_SECRET_KEY = "test-secret-key";

function response(
  status: number,
  body = "{}",
): AlpacaIntradayBarsHttpResponse {
  return {
    status,
    async text() {
      return body;
    },
  };
}

function providerWith(
  fetchImpl: AlpacaIntradayBarsFetch,
  now = NOW,
): AlpacaIntradayBarsProvider {
  return new AlpacaIntradayBarsProvider({
    apiKeyId: API_KEY_ID,
    apiSecretKey: API_SECRET_KEY,
    fetchImpl,
    now: () => now,
  });
}

describe("Alpaca historical SIP intraday bars adapter", () => {
  it("uses a 15-minute capped split-adjusted SIP request and preserves decimals", async () => {
    const fetchImpl = vi.fn<AlpacaIntradayBarsFetch>(async () =>
      response(
        200,
        `{
          "bars": {
            "AAPL": [
              {"c": 130.12345678, "t": "2026-08-07T13:30:00Z"}
            ],
            "MSFT": [
              {"c": 99999999999999999999.12345678, "t": "2026-08-07T13:30:00Z"}
            ]
          },
          "next_page_token": null
        }`,
      ),
    );
    const provider = providerWith(fetchImpl);

    const result = await provider.getBars({
      instruments: [AAPL, MSFT],
      asOf: "2026-08-07T18:00:00Z",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (call === undefined) {
      throw new Error("missing historical bars request");
    }
    const [rawUrl, init] = call;
    const url = new URL(rawUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://data.alpaca.markets/v2/stocks/bars",
    );
    expect(url.searchParams.get("symbols")).toBe("AAPL,MSFT");
    expect(url.searchParams.get("timeframe")).toBe(
      INTRADAY_BAR_TIMEFRAME,
    );
    expect(url.searchParams.get("feed")).toBe(
      INTRADAY_BAR_SOURCE_FEED,
    );
    expect(url.searchParams.get("adjustment")).toBe(
      INTRADAY_BAR_ADJUSTMENT,
    );
    expect(url.searchParams.get("start")).toBe(
      "2026-08-07T08:00:00.000Z",
    );
    expect(url.searchParams.get("end")).toBe(
      "2026-08-07T15:15:00.000Z",
    );
    expect(url.searchParams.get("limit")).toBe("10000");
    expect(url.searchParams.get("sort")).toBe("asc");
    expect(rawUrl).not.toContain(API_KEY_ID);
    expect(rawUrl).not.toContain(API_SECRET_KEY);
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "APCA-API-KEY-ID": API_KEY_ID,
        "APCA-API-SECRET-KEY": API_SECRET_KEY,
      },
    });

    expect(result).toMatchObject({
      kind: "RESULTS",
      generatedAt: NOW,
      requestedAsOf: "2026-08-07T18:00:00.000Z",
      windowStartAt: "2026-08-07T08:00:00.000Z",
      availableThrough: "2026-08-07T15:15:00.000Z",
      sourceFeed: "sip",
      delayPolicy: "AT_LEAST_15_MINUTES",
      timeframe: "15Min",
      adjustment: "split",
      series: [
        {
          instrument: AAPL,
          status: "OK",
          bars: [
            {
              close: "130.12345678",
              sourceEventAt: "2026-08-07T13:30:00Z",
              priceType: "MINUTE_BAR_CLOSE",
            },
          ],
        },
        {
          instrument: MSFT,
          status: "OK",
          bars: [
            {
              close: "99999999999999999999.12345678",
              sourceEventAt: "2026-08-07T13:30:00Z",
              priceType: "MINUTE_BAR_CLOSE",
            },
          ],
        },
      ],
    });
  });

  it("follows pagination, sorts points, and ignores unrequested symbols", async () => {
    const fetchImpl = vi.fn<AlpacaIntradayBarsFetch>(
      async (rawUrl) => {
        const token = new URL(rawUrl).searchParams.get("page_token");
        return token === null
          ? response(
              200,
              JSON.stringify({
                bars: {
                  AAPL: [
                    { c: 131, t: "2026-08-07T14:00:00Z" },
                  ],
                  TSLA: [
                    { c: 300, t: "2026-08-07T14:00:00Z" },
                  ],
                },
                next_page_token: "page-2",
              }),
            )
          : response(
              200,
              JSON.stringify({
                bars: {
                  AAPL: [
                    { c: 130, t: "2026-08-07T13:45:00Z" },
                  ],
                  MSFT: [
                    { c: 420, t: "2026-08-07T14:00:00Z" },
                  ],
                },
                next_page_token: null,
              }),
            );
      },
    );

    const result = await providerWith(fetchImpl).getBars({
      instruments: [AAPL, MSFT],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      new URL(fetchImpl.mock.calls[1]?.[0] ?? "").searchParams.get(
        "page_token",
      ),
    ).toBe("page-2");
    expect(result).toMatchObject({
      kind: "RESULTS",
      series: [
        {
          instrument: AAPL,
          status: "OK",
          bars: [
            { close: "130", sourceEventAt: "2026-08-07T13:45:00Z" },
            { close: "131", sourceEventAt: "2026-08-07T14:00:00Z" },
          ],
        },
        {
          instrument: MSFT,
          status: "OK",
          bars: [
            { close: "420", sourceEventAt: "2026-08-07T14:00:00Z" },
          ],
        },
      ],
    });
  });

  it("does not request SIP bars before the delayed window reaches 04:00 ET", async () => {
    const fetchImpl = vi.fn<AlpacaIntradayBarsFetch>();
    const result = await providerWith(
      fetchImpl,
      "2026-08-07T07:10:00Z",
    ).getBars({ instruments: [AAPL] });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "RESULTS",
      series: [{ instrument: AAPL, status: "NO_DATA", bars: [] }],
    });
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "UNAUTHORIZED"],
    [429, "RATE_LIMITED"],
    [500, "FETCH_FAILED"],
  ] as const)("maps HTTP %i to %s", async (status, fetchStatus) => {
    const result = await providerWith(async () => response(status)).getBars({
      instruments: [AAPL],
    });
    expect(result).toEqual({ kind: "BATCH_FAILURE", fetchStatus });
  });

  it("fails a repeated pagination token without looping", async () => {
    const fetchImpl = vi.fn<AlpacaIntradayBarsFetch>(async () =>
      response(
        200,
        JSON.stringify({ bars: {}, next_page_token: "repeat" }),
      ),
    );
    const result = await providerWith(fetchImpl).getBars({
      instruments: [AAPL],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      kind: "BATCH_FAILURE",
      fetchStatus: "FETCH_FAILED",
    });
  });

  it("isolates malformed bars to their instrument", async () => {
    const result = await providerWith(async () =>
      response(
        200,
        JSON.stringify({
          bars: {
            AAPL: [{ c: 0, t: "2026-08-07T14:00:00Z" }],
            MSFT: [{ c: 420, t: "2026-08-07T14:00:00Z" }],
          },
          next_page_token: null,
        }),
      ),
    ).getBars({ instruments: [AAPL, MSFT] });

    expect(result).toMatchObject({
      kind: "RESULTS",
      series: [
        { instrument: AAPL, status: "FAILED", bars: [] },
        { instrument: MSFT, status: "OK" },
      ],
    });
  });
});
