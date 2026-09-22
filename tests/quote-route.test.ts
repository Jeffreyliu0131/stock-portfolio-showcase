import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/quotes/route.ts";
import { resetQuoteRateLimitForTests } from "../application/http/public-route-rate-limiters.ts";

function quoteRequest(body: unknown): Request {
  return new Request("http://localhost/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  resetQuoteRateLimitForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/quotes", () => {
  it("rejects cross-site, non-JSON, oversized, extra-field, and duplicate requests before Alpaca", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const instrument = {
      listingMarket: "NASDAQ",
      symbol: "AAPL",
      currency: "USD",
    };

    const crossSite = await POST(
      new Request("https://portfolio.example/api/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ instruments: [instrument] }),
      }),
    );
    expect(crossSite.status).toBe(403);

    const nonJson = await POST(
      new Request("https://portfolio.example/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ instruments: [instrument] }),
      }),
    );
    expect(nonJson.status).toBe(415);

    const oversized = await POST(
      new Request("https://portfolio.example/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruments: [instrument],
          padding: "x".repeat(33_000),
        }),
      }),
    );
    expect(oversized.status).toBe(413);

    const extraField = await POST(
      quoteRequest({ instruments: [instrument], accountNumber: "private" }),
    );
    expect(extraField.status).toBe(400);
    const duplicate = await POST(
      quoteRequest({ instruments: [instrument, instrument] }),
    );
    expect(duplicate.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a symbol without an explicit supported market", async () => {
    const response = await POST(
      quoteRequest({
        instruments: [{ symbol: "AAPL", currency: "USD" }],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "INVALID_REQUEST",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an empty result without requiring credentials", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");

    const response = await POST(quoteRequest({ instruments: [] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "QUOTES",
      quotes: [],
    });
  });

  it("fails safely when server-side credentials are absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T15:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "AAPL",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      kind: "ERROR",
      code: "MARKET_DATA_NOT_CONFIGURED",
      message: "延迟行情尚未配置；持仓真值仍保存在本机。",
    });
  });

  it("fetches the last delayed SIP price while the market is closed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T16:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response("[]", { status: 200 });
      }
      if (url.pathname === "/v2/stocks/snapshots") {
        expect(url.searchParams.get("feed")).toBe("delayed_sip");
        return new Response(
          JSON.stringify({
            AAPL: {
              latestTrade: {
                p: 130,
                t: "2026-07-31T23:45:00Z",
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("unexpected URL", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "AAPL",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "QUOTES",
      quotes: [
        {
          effectivePrice: "130",
          feed: "delayed_sip",
          fetchStatus: "FETCH_OK",
          marketSession: "CLOSED",
          valuationStatus: "CLOSED_FINAL",
          acceptedCandidate: true,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks a calendar holiday and still supplies a final valuation price", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response("[]", { status: 200 });
      }
      return new Response(
        JSON.stringify({
          MSFT: {
            latestTrade: {
              p: 129,
              t: "2026-07-02T23:45:00Z",
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "MSFT",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "QUOTES",
      quotes: [
        {
          effectivePrice: "129",
          fetchStatus: "FETCH_OK",
          marketSession: "HOLIDAY",
          valuationStatus: "CLOSED_FINAL",
        },
      ],
    });
  });

  it("keeps refreshing when the calendar is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T15:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response("upstream unavailable", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          GOOGL: {
            latestTrade: {
              p: 130,
              t: "2026-07-30T14:45:00Z",
            },
            dailyBar: {
              c: 131,
              t: "2026-07-30T04:00:00Z",
            },
            prevDailyBar: {
              c: 125,
              t: "2026-07-29T04:00:00Z",
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "GOOGL",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "QUOTES",
      quotes: [
        {
          effectivePrice: "130",
          fetchStatus: "FETCH_OK",
          marketSession: "REGULAR",
          valuationStatus: "HEALTHY_DELAYED",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reviews a quote after upstream latency instead of rejecting its fetch time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T15:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response(
          JSON.stringify([
            {
              date: "2026-07-30",
              open: "09:30",
              close: "16:00",
            },
          ]),
          { status: 200 },
        );
      }
      vi.setSystemTime(new Date("2026-07-30T15:00:05Z"));
      return new Response(
        JSON.stringify({
          META: {
            latestTrade: {
              p: 130,
              t: "2026-07-30T14:45:00Z",
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "META",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      generatedAt: "2026-07-30T15:00:05.000Z",
      quotes: [
        {
          effectivePrice: "130",
          fetchedAt: "2026-07-30T15:00:05.000Z",
          acceptedCandidate: true,
          candidateRejection: null,
        },
      ],
    });
  });

  it("uses Alpaca overnight for the 20:00–04:00 ET session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T01:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response(
          JSON.stringify([
            {
              date: "2026-07-30",
              open: "09:30",
              close: "16:00",
            },
            {
              date: "2026-07-31",
              open: "09:30",
              close: "16:00",
            },
          ]),
          { status: 200 },
        );
      }
      if (url.pathname === "/v2/stocks/snapshots") {
        if (url.searchParams.get("feed") === "overnight") {
          return new Response(
            JSON.stringify({
              NVDA: {
                latestTrade: {
                  p: 130,
                  t: "2026-07-31T00:45:00Z",
                },
              },
            }),
            { status: 200 },
          );
        }
        expect(url.searchParams.get("feed")).toBe("delayed_sip");
        return new Response(
          JSON.stringify({
            NVDA: {
              latestTrade: {
                p: 126,
                t: "2026-07-30T23:45:00Z",
              },
              dailyBar: {
                c: 125,
                t: "2026-07-30T04:00:00Z",
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("unexpected URL", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "NVDA",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "QUOTES",
      quotes: [
        {
          effectivePrice: "130",
          effectivePriceType: "INDICATIVE_TRADE",
          feed: "overnight",
          fetchStatus: "FETCH_OK",
          marketSession: "OVERNIGHT",
          valuationStatus: "HEALTHY_DELAYED",
          sourceEventAt: "2026-07-31T00:45:00Z",
          fetchedAt: "2026-07-31T01:00:00.000Z",
          previousRegularClose: "125",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the overnight valuation price but leaves daily PnL unavailable when the SIP close lookup fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T01:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response(
          JSON.stringify([
            {
              date: "2026-07-31",
              open: "09:30",
              close: "16:00",
            },
          ]),
          { status: 200 },
        );
      }
      if (url.searchParams.get("feed") === "overnight") {
        return new Response(
          JSON.stringify({
            ORCL: {
              latestTrade: {
                p: 142,
                t: "2026-07-31T00:45:00Z",
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("temporarily unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "ORCL",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      quotes: [
        {
          effectivePrice: "142",
          feed: "overnight",
          previousRegularClose: null,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to the last SIP trade when an overnight symbol has no trade yet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T01:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response(
          JSON.stringify([
            {
              date: "2026-07-31",
              open: "09:30",
              close: "16:00",
            },
          ]),
          { status: 200 },
        );
      }
      if (url.searchParams.get("feed") === "overnight") {
        return new Response("{}", { status: 200 });
      }
      return new Response(
        JSON.stringify({
          AMD: {
            latestTrade: {
              p: 100,
              t: "2026-07-30T23:45:00Z",
            },
            dailyBar: {
              c: 98,
              t: "2026-07-30T04:00:00Z",
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "NASDAQ",
            symbol: "AMD",
            currency: "USD",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      quotes: [
        {
          effectivePrice: "100",
          feed: "delayed_sip",
          marketSession: "OVERNIGHT",
          previousRegularClose: "98",
          valuationStatus: "STALE",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("replaces a cached regular quote with a newer SIP fallback and current close when overnight has no trade", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T15:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    let snapshotCall = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response(
          JSON.stringify([
            {
              date: "2026-07-30",
              open: "09:30",
              close: "16:00",
            },
            {
              date: "2026-07-31",
              open: "09:30",
              close: "16:00",
            },
          ]),
          { status: 200 },
        );
      }
      snapshotCall += 1;
      if (snapshotCall === 1) {
        return new Response(
          JSON.stringify({
            ADBE: {
              latestTrade: {
                p: 130,
                t: "2026-07-30T14:45:00Z",
              },
              dailyBar: {
                c: 129,
                t: "2026-07-30T14:45:00Z",
              },
              prevDailyBar: {
                c: 120,
                t: "2026-07-29T20:00:00Z",
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.searchParams.get("feed") === "overnight") {
        return new Response("{}", { status: 200 });
      }
      return new Response(
        JSON.stringify({
          ADBE: {
            latestTrade: {
              p: 131,
              t: "2026-07-30T23:45:00Z",
            },
            dailyBar: {
              c: 125,
              t: "2026-07-30T20:00:00Z",
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      instruments: [
        {
          listingMarket: "NASDAQ",
          symbol: "ADBE",
          currency: "USD",
        },
      ],
    };

    const regularResponse = await POST(quoteRequest(body));
    expect(regularResponse.status).toBe(200);
    await expect(regularResponse.json()).resolves.toMatchObject({
      quotes: [
        {
          effectivePrice: "130",
          previousRegularClose: "120",
        },
      ],
    });

    vi.setSystemTime(new Date("2026-07-31T01:00:00Z"));
    const overnightResponse = await POST(quoteRequest(body));

    expect(overnightResponse.status).toBe(200);
    await expect(overnightResponse.json()).resolves.toMatchObject({
      quotes: [
        {
          acceptedCandidate: true,
          effectivePrice: "131",
          feed: "delayed_sip",
          marketSession: "OVERNIGHT",
          previousRegularClose: "125",
          usedLastValid: false,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("preserves the original quote when a later refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T15:00:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    let snapshotAvailable = true;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/calendar") {
        return new Response(
          JSON.stringify([
            {
              date: "2026-07-30",
              open: "09:30",
              close: "16:00",
            },
          ]),
          { status: 200 },
        );
      }
      if (!snapshotAvailable) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          TSLA: {
            latestTrade: {
              p: 130,
              t: "2026-07-30T14:45:00Z",
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const requestBody = {
      instruments: [
        {
          listingMarket: "NASDAQ",
          symbol: "TSLA",
          currency: "USD",
        },
      ],
    };

    const firstResponse = await POST(quoteRequest(requestBody));
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      quotes: [
        {
          effectivePrice: "130",
          acceptedCandidate: true,
        },
      ],
    });

    snapshotAvailable = false;
    const failedResponse = await POST(quoteRequest(requestBody));
    expect(failedResponse.status).toBe(200);
    await expect(failedResponse.json()).resolves.toMatchObject({
      quotes: [
        {
          effectivePrice: "130",
          effectivePriceType: "LAST_VALID_FALLBACK",
          fetchStatus: "FETCH_FAILED",
          usedLastValid: true,
          sourceEventAt: "2026-07-30T14:45:00Z",
          fetchedAt: "2026-07-30T15:00:00.000Z",
        },
      ],
    });
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/v2/stocks/snapshots"),
      ),
    ).toHaveLength(2);
  });

  it("does not expose secret values in a validation response", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "private-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "private-secret");

    const response = await POST(
      quoteRequest({
        instruments: [
          {
            listingMarket: "OTC",
            symbol: "CGRNQ",
            currency: "USD",
          },
        ],
      }),
    );
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toContain("private-key-id");
    expect(serialized).not.toContain("private-secret");
  });
});
