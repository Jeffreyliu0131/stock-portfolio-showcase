import { describe, expect, it, vi } from "vitest";

import {
  AlpacaFxRateError,
  AlpacaUsdCnyRateProvider,
  type AlpacaFxHttpFetch,
  type AlpacaFxHttpResponse,
} from "../application/fx/server/index.ts";

const API_KEY_ID = "test-key-id";
const API_SECRET_KEY = "test-secret-key";
const FETCHED_AT = "2026-08-02T08:00:01Z";

function response(
  status: number,
  body = "{}",
): AlpacaFxHttpResponse {
  return {
    status,
    async text() {
      return body;
    },
  };
}

function providerWith(fetchImpl: AlpacaFxHttpFetch) {
  return new AlpacaUsdCnyRateProvider({
    apiKeyId: API_KEY_ID,
    apiSecretKey: API_SECRET_KEY,
    fetchImpl,
    now: () => FETCHED_AT,
  });
}

describe("server-only Alpaca USD/CNY rate adapter", () => {
  it("requests USDCNY and preserves the exact midpoint from the wire", async () => {
    const fetchImpl = vi.fn<AlpacaFxHttpFetch>(async () =>
      response(
        200,
        `{
          "rates": {
            "USDCNY": {
              "bp": 7.12340001,
              "mp": 7.12345678,
              "ap": 7.12349999,
              "t": "2026-08-02T08:00:00.123456789Z"
            }
          }
        }`,
      ),
    );

    await expect(
      providerWith(fetchImpl).getLatestRate(),
    ).resolves.toEqual({
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.12345678",
      provider: "alpaca",
      rateType: "MIDPOINT",
      sourceEventAt: "2026-08-02T08:00:00.123456789Z",
      fetchedAt: FETCHED_AT,
    });

    const call = fetchImpl.mock.calls[0];
    if (call === undefined) {
      throw new Error("missing Alpaca forex request");
    }
    const [rawUrl, init] = call;
    const url = new URL(rawUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://data.alpaca.markets/v1beta1/forex/latest/rates",
    );
    expect(url.searchParams.get("currency_pairs")).toBe("USDCNY");
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
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "UNAUTHORIZED"],
    [429, "RATE_LIMITED"],
    [500, "UNAVAILABLE"],
  ] as const)(
    "maps HTTP %i to %s without exposing credentials",
    async (status, code) => {
      const text = vi.fn(async () => {
        throw new Error("error body must not be parsed");
      });
      const provider = providerWith(async () => ({ status, text }));

      await expect(provider.getLatestRate()).rejects.toMatchObject({
        name: "AlpacaFxRateError",
        code,
      });
      expect(text).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["malformed JSON", '{"rates":'],
    ["missing pair", '{"rates": {}}'],
    [
      "non-positive midpoint",
      '{"rates":{"USDCNY":{"mp":0,"t":"2026-08-02T08:00:00Z"}}}',
    ],
    [
      "future source time",
      '{"rates":{"USDCNY":{"mp":7.2,"t":"2026-08-02T08:00:02Z"}}}',
    ],
  ])("rejects a %s response", async (_name, body) => {
    await expect(
      providerWith(async () => response(200, body)).getLatestRate(),
    ).rejects.toMatchObject({
      name: "AlpacaFxRateError",
    });
  });

  it("rejects an oversized upstream response before JSON parsing", async () => {
    await expect(
      providerWith(async () => response(200, "x".repeat(65_537))).getLatestRate(),
    ).rejects.toMatchObject({
      name: "AlpacaFxRateError",
      code: "INVALID_RESPONSE",
    });
  });

  it("aborts at the configured timeout", async () => {
    const fetchImpl: AlpacaFxHttpFetch = async (_url, init) =>
      new Promise<AlpacaFxHttpResponse>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    const provider = new AlpacaUsdCnyRateProvider({
      apiKeyId: API_KEY_ID,
      apiSecretKey: API_SECRET_KEY,
      fetchImpl,
      now: () => FETCHED_AT,
      timeoutMs: 1,
    });

    await expect(provider.getLatestRate()).rejects.toBeInstanceOf(
      AlpacaFxRateError,
    );
  });

  it("requires both credentials without echoing their values", () => {
    expect(
      () =>
        new AlpacaUsdCnyRateProvider({
          apiKeyId: "",
          apiSecretKey: API_SECRET_KEY,
        }),
    ).toThrow("Alpaca API key ID is required");
    expect(
      () =>
        new AlpacaUsdCnyRateProvider({
          apiKeyId: API_KEY_ID,
          apiSecretKey: " ",
        }),
    ).toThrow("Alpaca API secret key is required");
  });
});
