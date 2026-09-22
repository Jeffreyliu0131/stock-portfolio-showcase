import { describe, expect, it } from "vitest";

import type { CashSnapshot } from "../application/cash/types.ts";
import type { PositionSnapshot } from "../application/positions/types.ts";
import {
  resolveQuote,
  type InstrumentKey,
  type ResolvedQuote,
  type ValidMarketQuote,
} from "../domain/index.ts";
import { createPortfolioCopySource } from "./portfolio-copy-text.ts";
import { createPortfolioInsights } from "./portfolio-insights.ts";

const NOW = "2026-08-09T14:01:00Z";

function instrument(symbol: string): InstrumentKey {
  return {
    listingMarket: "NASDAQ",
    symbol,
    currency: "USD",
  };
}

function snapshot(
  symbol: string,
  quantity = "1",
  openCost = "1",
): PositionSnapshot {
  const key = instrument(symbol);
  return {
    revision: 1,
    savedAt: "2026-08-09T13:00:00Z",
    batch: {
      instrument: key,
      displayName: `${symbol} Holdings`,
      inputs: [
        {
          id: `${symbol}-input`,
          instrument: key,
          quantity,
          costInput: {
            mode: "TOTAL_OPEN_COST",
            value: openCost,
          },
        },
      ],
    },
  };
}

function quote(
  symbol: string,
  price: string,
  previousRegularClose: string | null,
): ResolvedQuote {
  const key = instrument(symbol);
  const base: Omit<ValidMarketQuote, "previousRegularClose"> = {
    instrument: key,
    provider: "fixture-provider",
    feed: "delayed_sip",
    price,
    priceType: "LATEST_TRADE",
    sourceEventAt: "2026-08-09T13:45:00Z",
    fetchedAt: "2026-08-09T14:00:00Z",
    marketSession: "REGULAR",
  };
  const candidate: ValidMarketQuote =
    previousRegularClose === null
      ? base
      : { ...base, previousRegularClose };
  return resolveQuote({
    requestedInstrument: key,
    now: NOW,
    fetchStatus: "FETCH_OK",
    marketSession: "REGULAR",
    candidate,
  });
}

function cash(balance: string): CashSnapshot {
  return {
    revision: 1,
    savedAt: "2026-08-09T13:00:00Z",
    account: {
      provider: "IBKR",
      currency: "USD",
      balance,
      netAssetValue: balance,
      navSource: "USER_ENTERED",
      pricingPlan: "IBKR_PRO",
    },
  };
}

function source(
  rows: readonly {
    readonly symbol: string;
    readonly price: string | null;
    readonly previousRegularClose?: string | null;
    readonly quantity?: string;
  }[],
  cashBalance: string | null = null,
) {
  return createPortfolioCopySource(
    rows.map((row) => snapshot(row.symbol, row.quantity)),
    rows.flatMap((row) =>
      row.price === null
        ? []
        : [
            quote(
              row.symbol,
              row.price,
              row.previousRegularClose === undefined
                ? row.price
                : row.previousRegularClose,
            ),
          ],
    ),
    cashBalance === null ? null : cash(cashBalance),
  );
}

describe("createPortfolioInsights", () => {
  it("calculates unrounded stock weights, cash weight, and Top 1/3/5 concentration", () => {
    const insights = createPortfolioInsights(
      source(
        [
          { symbol: "A", price: "50" },
          { symbol: "B", price: "40" },
          { symbol: "C", price: "30" },
          { symbol: "D", price: "20" },
          { symbol: "E", price: "10" },
          { symbol: "F", price: "10" },
        ],
        "40",
      ),
    );

    expect(insights).toMatchObject({
      currency: "USD",
      structure: {
        pricingComplete: true,
        pricedPositionCount: 6,
        unpricedPositionCount: 0,
        totalPricedAssetsUsd: "200",
        weightBasis: "TOTAL_ASSETS",
        cash: {
          balanceUsd: "40",
          assetWeight: "0.2",
        },
        concentration: {
          status: "COMPLETE",
          top1: {
            includedPositionCount: 1,
            marketValueUsd: "50",
            assetWeight: "0.25",
          },
          top3: {
            includedPositionCount: 3,
            marketValueUsd: "120",
            assetWeight: "0.6",
          },
          top5: {
            includedPositionCount: 5,
            marketValueUsd: "150",
            assetWeight: "0.75",
          },
        },
      },
    });
    expect(
      insights.structure.positions.map(
        ({ symbol, marketValueUsd, assetWeight }) => ({
          symbol,
          marketValueUsd,
          assetWeight,
        }),
      ),
    ).toEqual([
      { symbol: "A", marketValueUsd: "50", assetWeight: "0.25" },
      { symbol: "B", marketValueUsd: "40", assetWeight: "0.2" },
      { symbol: "C", marketValueUsd: "30", assetWeight: "0.15" },
      { symbol: "D", marketValueUsd: "20", assetWeight: "0.1" },
      { symbol: "E", marketValueUsd: "10", assetWeight: "0.05" },
      { symbol: "F", marketValueUsd: "10", assetWeight: "0.05" },
    ]);
  });

  it("uses signed amounts and an absolute denominator for daily contributions", () => {
    const insights = createPortfolioInsights(
      source(
        [
          { symbol: "GAIN", price: "60", previousRegularClose: "51" },
          { symbol: "LOSS", price: "30", previousRegularClose: "33" },
          { symbol: "FLAT", price: "10", previousRegularClose: "10" },
        ],
        "100",
      ),
    );

    expect(insights.daily).toMatchObject({
      status: "COMPLETE",
      totalPositionCount: 3,
      calculablePositionCount: 3,
      netEffectUsd: "6",
      calculableAbsoluteEffectUsd: "12",
      shareBasis: "COMPLETE_PORTFOLIO",
      largestPositiveContributor: {
        symbol: "GAIN",
        amountUsd: "9",
        absoluteContributionShare: "0.75",
      },
      largestNegativeContributor: {
        symbol: "LOSS",
        amountUsd: "-3",
        absoluteContributionShare: "0.25",
      },
    });
    expect(
      insights.daily.contributions.map(
        ({ symbol, amountUsd, direction, absoluteContributionShare }) => ({
          symbol,
          amountUsd,
          direction,
          absoluteContributionShare,
        }),
      ),
    ).toEqual([
      {
        symbol: "GAIN",
        amountUsd: "9",
        direction: "POSITIVE",
        absoluteContributionShare: "0.75",
      },
      {
        symbol: "LOSS",
        amountUsd: "-3",
        direction: "NEGATIVE",
        absoluteContributionShare: "0.25",
      },
      {
        symbol: "FLAT",
        amountUsd: "0",
        direction: "NEUTRAL",
        absoluteContributionShare: "0",
      },
    ]);
  });

  it("keeps gross contribution shares meaningful when positive and negative moves net to zero", () => {
    const insights = createPortfolioInsights(
      source([
        { symbol: "UP", price: "20", previousRegularClose: "10" },
        { symbol: "DOWN", price: "10", previousRegularClose: "20" },
      ]),
    );

    expect(insights.daily).toMatchObject({
      status: "COMPLETE",
      netEffectUsd: "0",
      calculableAbsoluteEffectUsd: "20",
      shareBasis: "COMPLETE_PORTFOLIO",
    });
    expect(
      insights.daily.contributions.map(
        ({ symbol, amountUsd, absoluteContributionShare }) => ({
          symbol,
          amountUsd,
          absoluteContributionShare,
        }),
      ),
    ).toEqual([
      { symbol: "UP", amountUsd: "10", absoluteContributionShare: "0.5" },
      { symbol: "DOWN", amountUsd: "-10", absoluteContributionShare: "0.5" },
    ]);
  });

  it("does not invent a contribution share when every daily effect is zero", () => {
    const insights = createPortfolioInsights(
      source([
        { symbol: "A", price: "10", previousRegularClose: "10" },
        { symbol: "B", price: "20", previousRegularClose: "20" },
      ]),
    );

    expect(insights.daily).toMatchObject({
      status: "COMPLETE",
      netEffectUsd: "0",
      calculableAbsoluteEffectUsd: "0",
      shareBasis: "ZERO_ABSOLUTE_EFFECT",
      largestPositiveContributor: null,
      largestNegativeContributor: null,
    });
    expect(
      insights.daily.contributions.map(
        ({ direction, absoluteContributionShare }) => ({
          direction,
          absoluteContributionShare,
        }),
      ),
    ).toEqual([
      { direction: "NEUTRAL", absoluteContributionShare: null },
      { direction: "NEUTRAL", absoluteContributionShare: null },
    ]);
  });

  it("distinguishes a missing price from a missing previous close without filling either with zero", () => {
    const insights = createPortfolioInsights(
      source([
        { symbol: "KNOWN", price: "20", previousRegularClose: "15" },
        { symbol: "NO_PRICE", price: null },
        { symbol: "NO_CLOSE", price: "10", previousRegularClose: null },
      ]),
    );

    expect(insights.structure).toMatchObject({
      pricingComplete: false,
      pricedPositionCount: 2,
      unpricedPositionCount: 1,
      totalPricedAssetsUsd: "30",
      weightBasis: "PRICED_ASSETS",
      concentration: { status: "PARTIAL" },
    });
    expect(
      insights.structure.positions.find(({ symbol }) => symbol === "NO_PRICE"),
    ).toMatchObject({
      marketValueUsd: null,
      assetWeight: null,
      marketRank: null,
    });
    expect(insights.daily).toMatchObject({
      status: "PARTIAL",
      totalPositionCount: 3,
      calculablePositionCount: 1,
      netEffectUsd: null,
      calculableAbsoluteEffectUsd: "5",
      shareBasis: "CALCULABLE_POSITIONS",
      largestPositiveContributor: {
        symbol: "KNOWN",
        amountUsd: "5",
        absoluteContributionShare: "1",
      },
      largestNegativeContributor: null,
    });
    expect(
      insights.daily.contributions.map(
        ({ symbol, status, amountUsd, absoluteContributionShare }) => ({
          symbol,
          status,
          amountUsd,
          absoluteContributionShare,
        }),
      ),
    ).toEqual([
      {
        symbol: "KNOWN",
        status: "AVAILABLE",
        amountUsd: "5",
        absoluteContributionShare: "1",
      },
      {
        symbol: "NO_CLOSE",
        status: "MISSING_PREVIOUS_CLOSE",
        amountUsd: null,
        absoluteContributionShare: null,
      },
      {
        symbol: "NO_PRICE",
        status: "MISSING_PRICE",
        amountUsd: null,
        absoluteContributionShare: null,
      },
    ]);
  });

  it("keeps the result unavailable when no stock has a calculable value", () => {
    const insights = createPortfolioInsights(
      source([
        { symbol: "NO_PRICE", price: null },
        { symbol: "NO_CLOSE", price: "10", previousRegularClose: null },
      ]),
    );

    expect(insights.daily).toMatchObject({
      status: "UNAVAILABLE",
      totalPositionCount: 2,
      calculablePositionCount: 0,
      netEffectUsd: null,
      calculableAbsoluteEffectUsd: null,
      shareBasis: "UNAVAILABLE",
      largestPositiveContributor: null,
      largestNegativeContributor: null,
    });
    expect(insights.daily.contributions).toEqual([
      expect.objectContaining({
        symbol: "NO_CLOSE",
        amountUsd: null,
        direction: "UNAVAILABLE",
      }),
      expect.objectContaining({
        symbol: "NO_PRICE",
        amountUsd: null,
        direction: "UNAVAILABLE",
      }),
    ]);
  });

  it("represents a cash-only portfolio and an empty portfolio without synthetic stock values", () => {
    const cashOnly = createPortfolioInsights(source([], "12.50000000"));

    expect(cashOnly.structure).toMatchObject({
      pricingComplete: true,
      pricedPositionCount: 0,
      unpricedPositionCount: 0,
      totalPricedAssetsUsd: "12.5",
      weightBasis: "TOTAL_ASSETS",
      positions: [],
      cash: {
        balanceUsd: "12.5",
        assetWeight: "1",
      },
      concentration: {
        status: "UNAVAILABLE",
        top1: null,
        top3: null,
        top5: null,
      },
    });
    expect(cashOnly.daily).toMatchObject({
      status: "UNAVAILABLE",
      totalPositionCount: 0,
      calculablePositionCount: 0,
      netEffectUsd: null,
      contributions: [],
    });

    const empty = createPortfolioInsights(source([]));
    expect(empty.structure).toMatchObject({
      pricingComplete: true,
      totalPricedAssetsUsd: null,
      weightBasis: "UNAVAILABLE",
      positions: [],
      cash: null,
      concentration: { status: "UNAVAILABLE" },
    });
  });

  it("keeps fractional USD truth unformatted for later USD or CNY presentation", () => {
    const insights = createPortfolioInsights(
      source([
        {
          symbol: "FRAC",
          quantity: "0.3",
          price: "0.2",
          previousRegularClose: "0.1",
        },
      ]),
    );

    expect(insights).toMatchObject({
      currency: "USD",
      structure: {
        totalPricedAssetsUsd: "0.06",
        positions: [
          {
            marketValueUsd: "0.06",
            assetWeight: "1",
          },
        ],
      },
      daily: {
        netEffectUsd: "0.03",
        calculableAbsoluteEffectUsd: "0.03",
      },
    });
  });
});
