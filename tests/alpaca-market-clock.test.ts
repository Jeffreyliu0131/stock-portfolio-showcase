import { describe, expect, it, vi } from "vitest";

import {
  AlpacaMarketClock,
  type AlpacaMarketClockFetch,
  type AlpacaMarketClockHttpResponse,
} from "../application/market-data/server/index.ts";

const API_KEY_ID = "test-key-id";
const API_SECRET_KEY = "test-secret-key";
const NOW = "2026-07-30T15:00:00Z";

function response(
  status: number,
  body = "{}",
): AlpacaMarketClockHttpResponse {
  return {
    status,
    async text() {
      return body;
    },
  };
}

function clockWith(fetchImpl: AlpacaMarketClockFetch) {
  return new AlpacaMarketClock({
    apiKeyId: API_KEY_ID,
    apiSecretKey: API_SECRET_KEY,
    fetchImpl,
    now: () => NOW,
  });
}

describe("Alpaca official market clock", () => {
  it.each([
    [true, "OPEN"],
    [false, "CLOSED"],
  ] as const)("maps is_open=%s to %s", async (isOpen, expected) => {
    const fetchImpl = vi.fn<AlpacaMarketClockFetch>(async () =>
      response(
        200,
        JSON.stringify({
          timestamp: "2026-07-30T11:00:00-04:00",
          is_open: isOpen,
          next_open: "2026-07-31T09:30:00-04:00",
          next_close: "2026-07-30T16:00:00-04:00",
        }),
      ),
    );

    await expect(clockWith(fetchImpl).getState()).resolves.toBe(
      expected,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (call === undefined) {
      throw new Error("missing Alpaca clock request");
    }
    const [url, init] = call;
    expect(url).toBe("https://paper-api.alpaca.markets/v2/clock");
    expect(url).not.toContain(API_KEY_ID);
    expect(url).not.toContain(API_SECRET_KEY);
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "APCA-API-KEY-ID": API_KEY_ID,
        "APCA-API-SECRET-KEY": API_SECRET_KEY,
      },
    });
  });

  it.each([
    ["non-success status", async () => response(503)],
    ["malformed JSON", async () => response(200, '{"is_open":')],
    ["missing is_open", async () => response(200, "{}")],
    [
      "stale timestamp",
      async () =>
        response(
          200,
          JSON.stringify({
            timestamp: "2026-07-30T14:55:00Z",
            is_open: true,
          }),
        ),
    ],
    [
      "oversized response",
      async () => response(200, `{"is_open":true,"padding":"${"x".repeat(17_000)}"}`),
    ],
    [
      "network failure",
      async () => Promise.reject(new Error("offline")),
    ],
  ] satisfies readonly [
    string,
    AlpacaMarketClockFetch,
  ][])("treats %s as unavailable", async (_name, fetchImpl) => {
    await expect(clockWith(fetchImpl).getState()).resolves.toBe(
      "UNAVAILABLE",
    );
  });

  it("aborts a request at the configured timeout", async () => {
    const fetchImpl: AlpacaMarketClockFetch = async (_url, init) =>
      new Promise<AlpacaMarketClockHttpResponse>(
        (_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        },
      );
    const clock = new AlpacaMarketClock({
      apiKeyId: API_KEY_ID,
      apiSecretKey: API_SECRET_KEY,
      fetchImpl,
      now: () => NOW,
      timeoutMs: 1,
    });

    await expect(clock.getState()).resolves.toBe("UNAVAILABLE");
  });

  it("rejects credentials, unsafe base URLs, and invalid timeouts", () => {
    expect(
      () =>
        new AlpacaMarketClock({
          apiKeyId: "",
          apiSecretKey: API_SECRET_KEY,
        }),
    ).toThrow("Alpaca API key ID is required");
    expect(
      () =>
        new AlpacaMarketClock({
          apiKeyId: API_KEY_ID,
          apiSecretKey: API_SECRET_KEY,
          apiBaseUrl: "https://example.com",
        }),
    ).toThrow("Alpaca trading API base URL is not allowed");
    expect(
      () =>
        new AlpacaMarketClock({
          apiKeyId: API_KEY_ID,
          apiSecretKey: API_SECRET_KEY,
          timeoutMs: 0,
        }),
    ).toThrow("timeoutMs must be from 1 to 60000");
  });
});
