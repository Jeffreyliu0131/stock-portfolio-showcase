import { describe, expect, it, vi } from "vitest";

import {
  AlpacaMarketCalendar,
  type AlpacaMarketCalendarFetch,
  type AlpacaMarketCalendarHttpResponse,
} from "../application/market-data/server/index.ts";

const API_KEY_ID = "test-key-id";
const API_SECRET_KEY = "test-secret-key";

function response(
  status: number,
  body = "[]",
): AlpacaMarketCalendarHttpResponse {
  return {
    status,
    async text() {
      return body;
    },
  };
}

function calendarWith(fetchImpl: AlpacaMarketCalendarFetch) {
  return new AlpacaMarketCalendar({
    apiKeyId: API_KEY_ID,
    apiSecretKey: API_SECRET_KEY,
    fetchImpl,
  });
}

const STANDARD_DAYS = JSON.stringify([
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
]);

describe("Alpaca market calendar session resolver", () => {
  it.each([
    ["2026-07-30T09:10:00Z", "PRE_MARKET"],
    ["2026-07-30T15:00:00Z", "REGULAR"],
    ["2026-07-30T21:00:00Z", "AFTER_HOURS"],
    ["2026-07-31T01:00:00Z", "OVERNIGHT"],
    ["2026-07-31T07:00:00Z", "OVERNIGHT"],
  ] as const)(
    "uses the official trading dates to resolve %s as %s",
    async (instant, expected) => {
      const fetchImpl = vi.fn<AlpacaMarketCalendarFetch>(
        async () => response(200, STANDARD_DAYS),
      );

      await expect(
        calendarWith(fetchImpl).getSession(instant),
      ).resolves.toBe(expected);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const call = fetchImpl.mock.calls[0];
      if (call === undefined) {
        throw new Error("missing Alpaca calendar request");
      }
      const [rawUrl, init] = call;
      const url = new URL(rawUrl);
      expect(`${url.origin}${url.pathname}`).toBe(
        "https://paper-api.alpaca.markets/v2/calendar",
      );
      expect(url.searchParams.get("start")).toBe(
        instant === "2026-07-31T07:00:00Z"
          ? "2026-07-31"
          : "2026-07-30",
      );
      expect(url.searchParams.get("date_type")).toBe("TRADING");
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
    },
  );

  it("marks a weekday without a calendar entry as a holiday", async () => {
    await expect(
      calendarWith(async () => response(200)).getSession(
        "2026-07-03T10:00:00Z",
      ),
    ).resolves.toBe("HOLIDAY");
  });

  it("honors early closes instead of inventing an after-hours session", async () => {
    const earlyClose = JSON.stringify([
      {
        date: "2026-11-27",
        open: "09:30",
        close: "13:00",
      },
    ]);

    await expect(
      calendarWith(async () => response(200, earlyClose)).getSession(
        "2026-11-27T19:00:00Z",
      ),
    ).resolves.toBe("CLOSED");
  });

  it.each([
    ["HTTP failure", async () => response(503)],
    ["network failure", async () => Promise.reject(new Error("offline"))],
    ["malformed JSON", async () => response(200, "[")],
  ] satisfies readonly [
    string,
    AlpacaMarketCalendarFetch,
  ][])(
    "falls back to the standard 24/5 schedule after %s",
    async (_name, fetchImpl) => {
      await expect(
        calendarWith(fetchImpl).getSession(
          "2026-08-03T01:00:00Z",
        ),
      ).resolves.toBe("OVERNIGHT");
    },
  );

  it("validates credentials, base URLs, and timeouts", () => {
    expect(
      () =>
        new AlpacaMarketCalendar({
          apiKeyId: "",
          apiSecretKey: API_SECRET_KEY,
        }),
    ).toThrow("Alpaca API key ID is required");
    expect(
      () =>
        new AlpacaMarketCalendar({
          apiKeyId: API_KEY_ID,
          apiSecretKey: API_SECRET_KEY,
          apiBaseUrl: "https://example.com",
        }),
    ).toThrow("Alpaca trading API base URL is not allowed");
    expect(
      () =>
        new AlpacaMarketCalendar({
          apiKeyId: API_KEY_ID,
          apiSecretKey: API_SECRET_KEY,
          timeoutMs: 0,
        }),
    ).toThrow("timeoutMs must be from 1 to 60000");
  });
});
