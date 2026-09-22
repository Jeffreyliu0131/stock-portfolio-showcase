import { describe, expect, it } from "vitest";

import type { CashSnapshot } from "../application/cash/types.ts";
import type { PositionSnapshot } from "../application/positions/types.ts";
import {
  resolveQuote,
  type InstrumentKey,
  type ResolvedQuote,
  type ValidMarketQuote,
} from "../domain/index.ts";
import { portfolioConsultationClassifications } from "../tests/portfolio-consultation-fixtures.ts";
import {
  createPortfolioConsultationChatTurnRequest,
  createPortfolioConsultationFollowUpRequest,
  createPortfolioConsultationRequest,
  summarizePortfolioConsultationExposures,
} from "./portfolio-consultation-context.ts";
import { createPortfolioCopySource } from "./portfolio-copy-text.ts";
import { createPortfolioInsights } from "./portfolio-insights.ts";

const NOW = "2026-08-15T07:00:00.000Z";

function instrument(symbol: string): InstrumentKey {
  return { listingMarket: "NASDAQ", symbol, currency: "USD" };
}

function snapshot(
  symbol: string,
  name: string,
  quantity: string,
  openCost: string,
): PositionSnapshot {
  const key = instrument(symbol);
  return {
    revision: 9,
    savedAt: "2026-08-15T06:00:00.000Z",
    batch: {
      instrument: key,
      displayName: name,
      inputs: [
        {
          id: `private-${symbol}-input`,
          instrument: key,
          quantity,
          costInput: { mode: "TOTAL_OPEN_COST", value: openCost },
        },
      ],
    },
  };
}

function quote(
  symbol: string,
  price: string,
  previousRegularClose: string,
): ResolvedQuote {
  const key = instrument(symbol);
  const candidate: ValidMarketQuote = {
    instrument: key,
    provider: "Alpaca",
    feed: "delayed_sip",
    price,
    priceType: "LATEST_TRADE",
    sourceEventAt: "2026-08-15T06:45:00.000Z",
    fetchedAt: NOW,
    marketSession: "REGULAR",
    previousRegularClose,
  };
  return resolveQuote({
    requestedInstrument: key,
    now: NOW,
    fetchStatus: "FETCH_OK",
    marketSession: "REGULAR",
    candidate,
  });
}

function cash(balance = "1000"): CashSnapshot {
  return {
    revision: 4,
    savedAt: "2026-08-15T06:00:00.000Z",
    account: {
      provider: "IBKR",
      currency: "USD",
      balance,
      netAssetValue: balance === "1000" ? "50000" : balance,
      navSource: balance === "1000" ? "USER_ENTERED" : "CASH_BALANCE_FALLBACK",
      pricingPlan: "IBKR_PRO",
    },
  };
}

function completeSource() {
  return createPortfolioCopySource(
    [
      snapshot("AAPL", "Apple Inc.", "10", "1000"),
      snapshot("MSFT", "Microsoft Corporation", "5", "1000"),
    ],
    [quote("AAPL", "200", "190"), quote("MSFT", "200", "205")],
    cash(),
  );
}

describe("portfolio consultation context", () => {
  it("builds a full context while excluding local repository metadata", () => {
    const source = completeSource();
    const request = createPortfolioConsultationRequest(
      source,
      createPortfolioInsights(source),
      {
        mode: "INITIAL_ANALYSIS",
        generatedAt: NOW,
      },
    );
    const serialized = JSON.stringify(request);

    expect(request.portfolio.summary).toMatchObject({
      totalAssetsUsd: "4000",
      stockMarketValueUsd: "3000",
      portfolioOpenCostUsd: "2000",
      pricedUnrealizedPnlUsd: "1000",
      cashBalanceUsd: "1000",
      dailyNetEffectUsd: "75",
    });
    expect(request.portfolio.positions[0]).toMatchObject({
      positionId: "p0",
      symbol: "AAPL",
      name: "Apple Inc.",
      quantity: "10",
      averageCostUsd: "100",
      valuationPriceUsd: "200",
      marketValueUsd: "2000",
      unrealizedPnlUsd: "1000",
      assetWeight: "0.5",
    });
    expect(serialized).toContain('"netAssetValueUsd":"50000"');
    expect(serialized).not.toContain("revision");
    expect(serialized).not.toContain("savedAt");
    expect(serialized).not.toContain("private-AAPL-input");
  });

  it("accepts a real high-precision small weight produced by Decimal division", () => {
    const source = createPortfolioCopySource(
      [snapshot("TINY", "Tiny Holdings", "1", "1")],
      [quote("TINY", "0.00000001", "0.00000001")],
      cash("99999999"),
    );
    const request = createPortfolioConsultationRequest(
      source,
      createPortfolioInsights(source),
      { mode: "INITIAL_ANALYSIS", generatedAt: NOW },
    );
    const weight = request.portfolio.positions[0]?.assetWeight ?? "";

    expect(weight.split(".")[1]?.length).toBeGreaterThan(80);
    expect(weight).not.toBe("0");
  });

  it("aggregates AI sectors and instrument roles with local unrounded weights", () => {
    const source = completeSource();
    const request = createPortfolioConsultationRequest(
      source,
      createPortfolioInsights(source),
      { mode: "INITIAL_ANALYSIS", generatedAt: NOW },
    );
    const exposures = summarizePortfolioConsultationExposures(
      request.portfolio,
      portfolioConsultationClassifications(),
    );

    expect(exposures.status).toBe("COMPLETE");
    expect(exposures.sectors).toEqual([
      {
        key: "INFORMATION_TECHNOLOGY",
        label: "信息技术",
        assetWeight: "0.75",
        pricedPositionCount: 2,
        unpricedPositionCount: 0,
        symbols: ["AAPL", "MSFT"],
      },
    ]);
    expect(exposures.instrumentTypes[0]).toMatchObject({
      key: "SINGLE_STOCK",
      assetWeight: "0.75",
    });
  });

  it("keeps unpriced classifications visible and marks exposure as partial", () => {
    const source = createPortfolioCopySource(
      [
        snapshot("AAPL", "Apple Inc.", "10", "1000"),
        snapshot("MSFT", "Microsoft Corporation", "5", "1000"),
      ],
      [quote("AAPL", "200", "190")],
      cash(),
    );
    const request = createPortfolioConsultationRequest(
      source,
      createPortfolioInsights(source),
      { mode: "INITIAL_ANALYSIS", generatedAt: NOW },
    );
    const exposures = summarizePortfolioConsultationExposures(
      request.portfolio,
      portfolioConsultationClassifications(),
    );

    expect(exposures.status).toBe("PARTIAL");
    expect(exposures.sectors[0]).toMatchObject({
      assetWeight: "0.66666666666666666666666666666666666666666666666666666666666666666666666666666667",
      pricedPositionCount: 1,
      unpricedPositionCount: 1,
      symbols: ["AAPL", "MSFT"],
    });
  });

  it("creates a validated follow-up from the locked initial snapshot", () => {
    const source = completeSource();
    const initial = createPortfolioConsultationRequest(
      source,
      createPortfolioInsights(source),
      { mode: "INITIAL_ANALYSIS", generatedAt: NOW },
    );
    const followUp = createPortfolioConsultationFollowUpRequest(
      initial,
      portfolioConsultationClassifications(),
      [],
      "科技相关暴露主要来自哪里？",
      "2026-08-15T07:05:00.000Z",
    );

    expect(followUp.mode).toBe("FOLLOW_UP");
    expect(followUp.portfolio).toEqual(initial.portfolio);
    expect(followUp.priorClassifications).toEqual(
      portfolioConsultationClassifications(),
    );
  });

  it("creates direct chat turns from one locked portfolio snapshot", () => {
    const source = completeSource();
    const first = createPortfolioConsultationRequest(
      source,
      createPortfolioInsights(source),
      {
        mode: "CHAT",
        question: "当前组合最需要关注什么？",
        generatedAt: NOW,
      },
    );
    const next = createPortfolioConsultationChatTurnRequest(
      first,
      [
        { role: "user", content: "当前组合最需要关注什么？" },
        { role: "assistant", content: "头部持仓对当前结构影响较明显。" },
      ],
      "现金在这个组合里起到什么作用？",
      "2026-08-15T07:05:00.000Z",
    );

    expect(first.mode).toBe("CHAT");
    expect(next.mode).toBe("CHAT");
    expect(next.portfolio).toEqual(first.portfolio);
    expect(next.priorClassifications).toBeNull();
    expect(next.history).toHaveLength(2);
  });
});
