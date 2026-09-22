import { describe, expect, it, vi } from "vitest";

import {
  AlpacaInstrumentResolver,
  type AlpacaAssetFetch,
} from "../application/instruments/server/alpaca-instrument-resolver.ts";
import { AAPL } from "./helpers.ts";

function response(status: number, body: unknown) {
  return {
    status,
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

describe("AlpacaInstrumentResolver", () => {
  it("resolves an active, tradable US equity on the requested market", async () => {
    const fetchImpl = vi.fn<AlpacaAssetFetch>(
      async () =>
        response(200, {
          id: "asset-aapl",
          class: "us_equity",
          exchange: "NASDAQ",
          symbol: "AAPL",
          name: "Apple Inc.",
          status: "active",
          tradable: true,
        }),
    );
    const resolver = new AlpacaInstrumentResolver({
      apiKeyId: "test-key",
      apiSecretKey: "test-secret",
      fetchImpl,
    });

    await expect(resolver.resolve("AAPL")).resolves.toEqual({
      kind: "FOUND",
      instrument: AAPL,
      displayName: "Apple Inc.",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://paper-api.alpaca.markets/v2/assets/AAPL",
    );
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      "APCA-API-KEY-ID": "test-key",
      "APCA-API-SECRET-KEY": "test-secret",
    });
  });

  it.each([
    {
      exchange: "OTC",
      assetClass: "us_equity",
      tradable: true,
    },
    {
      exchange: "NASDAQ",
      assetClass: "crypto",
      tradable: true,
    },
    {
      exchange: "NASDAQ",
      assetClass: "us_equity",
      tradable: false,
    },
  ])("rejects an out-of-scope Alpaca asset", async (asset) => {
    const resolver = new AlpacaInstrumentResolver({
      apiKeyId: "test-key",
      apiSecretKey: "test-secret",
      fetchImpl: async () =>
        response(200, {
          class: asset.assetClass,
          exchange: asset.exchange,
          symbol: "AAPL",
          name: "Apple Inc.",
          status: "active",
          tradable: asset.tradable,
        }),
    });

    await expect(resolver.resolve("AAPL")).resolves.toEqual({
      kind: "FAILED",
      reason: "UNSUPPORTED",
    });
  });

  it("uses the listing market returned by Alpaca", async () => {
    const resolver = new AlpacaInstrumentResolver({
      apiKeyId: "test-key",
      apiSecretKey: "test-secret",
      fetchImpl: async () =>
        response(200, {
          class: "us_equity",
          exchange: "NYSE",
          symbol: "AAPL",
          name: "Apple Inc.",
          status: "active",
          tradable: true,
        }),
    });

    await expect(resolver.resolve("AAPL")).resolves.toEqual({
      kind: "FOUND",
      instrument: {
        ...AAPL,
        listingMarket: "NYSE",
      },
      displayName: "Apple Inc.",
    });
  });

  it("allows only fixed Alpaca trading API origins", () => {
    expect(
      () =>
        new AlpacaInstrumentResolver({
          apiKeyId: "test-key",
          apiSecretKey: "test-secret",
          apiBaseUrl: "https://example.com",
        }),
    ).toThrow("base URL is not allowed");
  });
});
