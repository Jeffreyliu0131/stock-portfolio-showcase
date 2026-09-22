import { describe, expect, it } from "vitest";

import {
  SUPPORTED_LISTING_MARKETS,
  resolveSupportedInstrument,
} from "../application/instruments/index.ts";

describe("supported P0 instruments", () => {
  it("normalizes an explicit US listing into a complete key", () => {
    expect(
      resolveSupportedInstrument({
        listingMarket: "nasdaq",
        symbol: " aapl ",
      }),
    ).toEqual({
      ok: true,
      instrument: {
        listingMarket: "NASDAQ",
        symbol: "AAPL",
        currency: "USD",
      },
    });
  });

  it.each(SUPPORTED_LISTING_MARKETS)(
    "accepts the supported %s exchange",
    (listingMarket) => {
      expect(
        resolveSupportedInstrument({
          listingMarket,
          symbol: "BRK.B",
          currency: "USD",
        }).ok,
      ).toBe(true);
    },
  );

  it("does not guess a listing market from a symbol", () => {
    expect(resolveSupportedInstrument({ symbol: "AAPL" })).toEqual({
      ok: false,
      issue: "UNSUPPORTED_MARKET",
    });
  });

  it.each([
    {
      value: {
        listingMarket: "OTC",
        symbol: "CGRNQ",
        currency: "USD",
      },
      issue: "UNSUPPORTED_MARKET",
    },
    {
      value: {
        listingMarket: "NASDAQ",
        symbol: "BTC/USD",
        currency: "USD",
      },
      issue: "INVALID_SYMBOL",
    },
    {
      value: {
        listingMarket: "NASDAQ",
        symbol: "AAPL",
        currency: "CNY",
      },
      issue: "UNSUPPORTED_CURRENCY",
    },
  ] as const)("rejects an out-of-scope instrument", ({ value, issue }) => {
    expect(resolveSupportedInstrument(value)).toEqual({
      ok: false,
      issue,
    });
  });
});
