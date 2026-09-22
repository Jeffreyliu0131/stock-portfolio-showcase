import { describe, expect, it, vi } from "vitest";

import {
  requestUsdCnyRate,
  type FxRateFetch,
} from "../application/fx/browser/usd-cny-rate-client.ts";
import {
  readCachedUsdCnyRate,
  USD_CNY_RATE_CACHE_KEY,
  writeCachedUsdCnyRate,
} from "../application/fx/browser/usd-cny-rate-cache.ts";
import {
  isUsdCnyRateUsable,
  type UsdCnyRate,
} from "../application/fx/index.ts";

const RATE: UsdCnyRate = {
  baseCurrency: "USD",
  quoteCurrency: "CNY",
  rate: "7.2",
  provider: "alpaca",
  rateType: "MIDPOINT",
  sourceEventAt: "2026-08-02T08:00:00Z",
  fetchedAt: "2026-08-02T08:00:01Z",
};

const ECB_RATE: UsdCnyRate = {
  baseCurrency: "USD",
  quoteCurrency: "CNY",
  rate: "6.75132782",
  provider: "ecb",
  rateType: "REFERENCE",
  referenceDate: "2026-07-31",
  sourceEventAt: "2026-07-31T13:57:02Z",
  fetchedAt: "2026-08-02T08:00:01Z",
};

describe("browser USD/CNY client and last-valid cache", () => {
  it("requests the server boundary with no-store semantics", async () => {
    const fetchImpl = vi.fn<FxRateFetch>(async () =>
      new Response(
        JSON.stringify({ kind: "USD_CNY_RATE", rate: RATE }),
        { status: 200 },
      ),
    );

    await expect(requestUsdCnyRate(fetchImpl)).resolves.toEqual(RATE);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/fx/usd-cny",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
  });

  it("rejects malformed success data and preserves API error messages", async () => {
    const malformed: FxRateFetch = async () =>
      new Response(
        JSON.stringify({
          kind: "USD_CNY_RATE",
          rate: { ...RATE, rate: "0" },
        }),
        { status: 200 },
      );
    const unavailable: FxRateFetch = async () =>
      new Response(
        JSON.stringify({
          kind: "ERROR",
          code: "FX_RATE_UNAVAILABLE",
          message: "人民币估算汇率暂时不可用。",
        }),
        { status: 503 },
      );

    await expect(requestUsdCnyRate(malformed)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(requestUsdCnyRate(unavailable)).rejects.toMatchObject({
      code: "FX_RATE_UNAVAILABLE",
      message: "人民币估算汇率暂时不可用。",
    });
  });

  it("round-trips a valid cache and ignores corrupted data", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };

    expect(writeCachedUsdCnyRate(RATE, storage)).toBe(true);
    expect(values.has(USD_CNY_RATE_CACHE_KEY)).toBe(true);
    expect(readCachedUsdCnyRate(storage)).toEqual(RATE);

    values.set(USD_CNY_RATE_CACHE_KEY, "not-json");
    expect(readCachedUsdCnyRate(storage)).toBeNull();
    values.set(
      USD_CNY_RATE_CACHE_KEY,
      JSON.stringify({ ...RATE, quoteCurrency: "USD" }),
    );
    expect(readCachedUsdCnyRate(storage)).toBeNull();
  });

  it("accepts an ECB reference rate and rejects mismatched provider semantics", async () => {
    const fetchImpl: FxRateFetch = async () =>
      new Response(
        JSON.stringify({ kind: "USD_CNY_RATE", rate: ECB_RATE }),
        { status: 200 },
      );
    await expect(requestUsdCnyRate(fetchImpl)).resolves.toEqual(ECB_RATE);

    const mismatched: FxRateFetch = async () =>
      new Response(
        JSON.stringify({
          kind: "USD_CNY_RATE",
          rate: { ...ECB_RATE, rateType: "MIDPOINT" },
        }),
        { status: 200 },
      );
    await expect(requestUsdCnyRate(mismatched)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("uses a last-valid rate for at most seven days", () => {
    expect(
      isUsdCnyRateUsable(RATE, "2026-08-09T08:00:00Z"),
    ).toBe(true);
    expect(
      isUsdCnyRateUsable(RATE, "2026-08-09T08:00:00.000000001Z"),
    ).toBe(false);
    expect(
      isUsdCnyRateUsable(RATE, "2026-08-02T07:59:59Z"),
    ).toBe(false);
  });
});
