import { describe, expect, it } from "vitest";

import type { PortfolioInsights } from "./portfolio-insights.ts";
import { createPortfolioAiFactBundle } from "./portfolio-ai-facts.ts";

function completeInsights(): PortfolioInsights {
  return {
    currency: "USD",
    structure: {
      pricingComplete: true,
      pricedPositionCount: 2,
      unpricedPositionCount: 0,
      totalPricedAssetsUsd: "100000",
      weightBasis: "TOTAL_ASSETS",
      positions: [
        {
          instrumentKey: "NASDAQ:AAPL:USD",
          symbol: "AAPL",
          name: "Apple Inc.",
          marketRank: 1,
          marketValueUsd: "60000",
          assetWeight: "0.6",
        },
        {
          instrumentKey: "NASDAQ:MSFT:USD",
          symbol: "MSFT",
          name: "Microsoft Corp.",
          marketRank: 2,
          marketValueUsd: "30000",
          assetWeight: "0.3",
        },
      ],
      cash: { balanceUsd: "10000", assetWeight: "0.1" },
      concentration: {
        status: "COMPLETE",
        top1: {
          includedPositionCount: 1,
          marketValueUsd: "60000",
          assetWeight: "0.6",
        },
        top3: {
          includedPositionCount: 2,
          marketValueUsd: "90000",
          assetWeight: "0.9",
        },
        top5: {
          includedPositionCount: 2,
          marketValueUsd: "90000",
          assetWeight: "0.9",
        },
      },
    },
    daily: {
      status: "COMPLETE",
      totalPositionCount: 2,
      calculablePositionCount: 2,
      netEffectUsd: "2750.25",
      calculableAbsoluteEffectUsd: "3250.25",
      shareBasis: "COMPLETE_PORTFOLIO",
      contributions: [
        {
          instrumentKey: "NASDAQ:AAPL:USD",
          symbol: "AAPL",
          name: "Apple Inc.",
          status: "AVAILABLE",
          amountUsd: "3000.25",
          direction: "POSITIVE",
          absoluteContributionShare: "0.923083",
        },
        {
          instrumentKey: "NASDAQ:MSFT:USD",
          symbol: "MSFT",
          name: "Microsoft Corp.",
          status: "AVAILABLE",
          amountUsd: "-250",
          direction: "NEGATIVE",
          absoluteContributionShare: "0.076917",
        },
      ],
      largestPositiveContributor: {
        instrumentKey: "NASDAQ:AAPL:USD",
        symbol: "AAPL",
        name: "Apple Inc.",
        amountUsd: "3000.25",
        absoluteContributionShare: "0.923083",
      },
      largestNegativeContributor: {
        instrumentKey: "NASDAQ:MSFT:USD",
        symbol: "MSFT",
        name: "Microsoft Corp.",
        amountUsd: "-250",
        absoluteContributionShare: "0.076917",
      },
    },
  };
}

describe("createPortfolioAiFactBundle", () => {
  it("keeps exact asset amounts local and sends only derived evidence", () => {
    const bundle = createPortfolioAiFactBundle(
      completeInsights(),
      "2026-08-13T08:00:00.000Z",
    );
    const serialized = JSON.stringify(bundle.request);

    expect(serialized).not.toContain("marketValueUsd");
    expect(serialized).not.toContain("balanceUsd");
    expect(serialized).not.toContain("amountUsd");
    expect(serialized).not.toContain("Apple Inc.");
    expect(serialized).not.toContain("3000.25");
    expect(serialized).toContain("AAPL");
    expect(serialized).toContain("0.923083");
    expect(bundle.localEvidence.get("daily.position.0.contribution")).toMatchObject({
      amountUsd: "3000.25",
    });
  });

  it("preserves complete concentration, cash, driver, and coverage evidence", () => {
    const bundle = createPortfolioAiFactBundle(completeInsights());
    expect(bundle.request.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "structure.top1",
          metric: "TOP_CONCENTRATION",
          fraction: "0.6",
        }),
        expect.objectContaining({
          id: "structure.cash.weight",
          metric: "CASH_WEIGHT",
          fraction: "0.1",
        }),
        expect.objectContaining({
          id: "daily.position.0.contribution",
          subject: "AAPL",
          direction: "POSITIVE",
        }),
        expect.objectContaining({
          id: "quality.daily",
          availableCount: 2,
          totalCount: 2,
          status: "COMPLETE",
        }),
      ]),
    );
  });

  it("reports partial coverage without inventing missing daily contributions", () => {
    const complete = completeInsights();
    const partial: PortfolioInsights = {
      ...complete,
      structure: {
        ...complete.structure,
        pricingComplete: false,
        pricedPositionCount: 1,
        unpricedPositionCount: 1,
        weightBasis: "PRICED_ASSETS",
        positions: complete.structure.positions.map((position, index) =>
          index === 0
            ? position
            : { ...position, marketValueUsd: null, assetWeight: null },
        ),
        concentration: {
          ...complete.structure.concentration,
          status: "PARTIAL",
        },
      },
      daily: {
        ...complete.daily,
        status: "PARTIAL",
        calculablePositionCount: 1,
        netEffectUsd: null,
        contributions: complete.daily.contributions.map((entry, index) =>
          index === 0
            ? entry
            : {
                ...entry,
                status: "MISSING_PREVIOUS_CLOSE",
                amountUsd: null,
                direction: "UNAVAILABLE",
                absoluteContributionShare: null,
              },
        ),
      },
    };

    const bundle = createPortfolioAiFactBundle(partial);
    expect(bundle.request.evidence).toContainEqual(
      expect.objectContaining({
        id: "quality.pricing",
        status: "PARTIAL",
        availableCount: 1,
        totalCount: 2,
      }),
    );
    expect(bundle.request.evidence).toContainEqual(
      expect.objectContaining({
        id: "quality.daily",
        status: "PARTIAL",
        availableCount: 1,
        totalCount: 2,
      }),
    );
    expect(
      bundle.request.evidence.some(
        (entry) => entry.id === "daily.position.1.contribution",
      ),
    ).toBe(false);
  });
});
