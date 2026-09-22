import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/intraday-bars/route.ts";
import { resetIntradayBarsRateLimitForTests } from "../application/http/public-route-rate-limiters.ts";
import { AAPL } from "./helpers.ts";

function intradayRequest(body: unknown): Request {
  return new Request("http://localhost/api/intraday-bars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  resetIntradayBarsRateLimitForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/intraday-bars", () => {
  it("rejects cross-site, non-JSON, oversized, and nested extra-field requests before Alpaca", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const crossSite = await POST(
      new Request("https://portfolio.example/api/intraday-bars", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ instruments: [AAPL] }),
      }),
    );
    expect(crossSite.status).toBe(403);

    const nonJson = await POST(
      new Request("https://portfolio.example/api/intraday-bars", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ instruments: [AAPL] }),
      }),
    );
    expect(nonJson.status).toBe(415);

    const oversized = await POST(
      new Request("https://portfolio.example/api/intraday-bars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruments: [AAPL],
          padding: "x".repeat(33_000),
        }),
      }),
    );
    expect(oversized.status).toBe(413);

    const nestedExtraField = await POST(
      intradayRequest({
        instruments: [{ ...AAPL, accountNumber: "private" }],
      }),
    );
    expect(nestedExtraField.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects quantities, costs, cash, and any other extra field", async () => {
    const response = await POST(
      intradayRequest({
        instruments: [AAPL],
        quantity: "10",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "INVALID_REQUEST",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an empty delayed result without requiring credentials", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T15:30:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");

    const response = await POST(intradayRequest({ instruments: [] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "INTRADAY_BARS",
      generatedAt: "2026-08-07T15:30:00.000Z",
      availableThrough: "2026-08-07T15:15:00.000Z",
      delayMinutes: 15,
      series: [],
    });
  });

  it("fails safely when server credentials are absent", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");

    const response = await POST(
      intradayRequest({ instruments: [AAPL] }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "MARKET_DATA_NOT_CONFIGURED",
    });
  });

  it("fetches only delayed historical SIP bars with optional asOf", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T15:30:00Z"));
    vi.stubEnv("ALPACA_API_KEY_ID", "test-key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v2/stocks/bars");
      expect(url.searchParams.get("feed")).toBe("sip");
      expect(url.searchParams.get("timeframe")).toBe("15Min");
      expect(url.searchParams.get("adjustment")).toBe("split");
      expect(url.searchParams.get("end")).toBe(
        "2026-08-07T15:15:00.000Z",
      );
      return new Response(
        JSON.stringify({
          bars: {
            AAPL: [
              { c: 130.25, t: "2026-08-07T15:00:00Z" },
            ],
          },
          next_page_token: null,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      intradayRequest({
        instruments: [AAPL],
        asOf: "2026-08-07T18:00:00Z",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "INTRADAY_BARS",
      requestedAsOf: "2026-08-07T18:00:00.000Z",
      availableThrough: "2026-08-07T15:15:00.000Z",
      sourceFeed: "sip",
      series: [
        {
          instrument: AAPL,
          status: "OK",
          bars: [
            {
              close: "130.25",
              sourceEventAt: "2026-08-07T15:00:00Z",
            },
          ],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
