import { afterEach, describe, expect, it, vi } from "vitest";

import { requestPortfolioConsultation } from "../application/ai/browser/portfolio-consultation-client.ts";
import { requestBuffettResearch } from "../application/ai/research/browser/buffett-research-client.ts";
import { requestUsdCnyRate } from "../application/fx/browser/usd-cny-rate-client.ts";
import {
  SITES_APP_ORIGIN,
  VERCEL_PROVIDER_ORIGIN,
} from "../application/http/provider-proxy-contract.ts";
import { requestInstrumentResolution } from "../application/instruments/browser/instrument-client.ts";
import { requestIntradayBars } from "../application/market-data/browser/intraday-bars-client.ts";
import { requestDelayedQuotes } from "../application/market-data/browser/quote-client.ts";
import { initialPortfolioConsultationRequest } from "./portfolio-consultation-fixtures.ts";
import { aaplResearchRequest } from "./buffett-research-fixtures.ts";

const AAPL = {
  listingMarket: "NASDAQ",
  symbol: "AAPL",
  currency: "USD",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider clients on Sites", () => {
  it("sends every provider capability to Vercel without credentials", async () => {
    vi.stubGlobal("location", { origin: SITES_APP_ORIGIN });
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      throw new Error("synthetic stop after request capture");
    });

    await expect(requestInstrumentResolution("AAPL", fetchMock)).rejects.toBeDefined();
    await expect(requestDelayedQuotes([AAPL], fetchMock)).rejects.toBeDefined();
    await expect(
      requestIntradayBars([AAPL], { fetchImpl: fetchMock }),
    ).rejects.toBeDefined();
    await expect(requestUsdCnyRate(fetchMock)).rejects.toBeDefined();
    await expect(
      requestPortfolioConsultation(
        initialPortfolioConsultationRequest(),
        fetchMock,
      ),
    ).rejects.toBeDefined();
    await expect(
      requestBuffettResearch(aaplResearchRequest(), fetchMock),
    ).rejects.toBeDefined();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${VERCEL_PROVIDER_ORIGIN}/api/instruments/resolve`,
      `${VERCEL_PROVIDER_ORIGIN}/api/quotes`,
      `${VERCEL_PROVIDER_ORIGIN}/api/intraday-bars`,
      `${VERCEL_PROVIDER_ORIGIN}/api/fx/usd-cny`,
      `${VERCEL_PROVIDER_ORIGIN}/api/ai/portfolio-analysis`,
      `${VERCEL_PROVIDER_ORIGIN}/api/ai/buffett-research`,
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe("omit");
    }
  });
});
