import { describe, expect, it } from "vitest";

import {
  Decimal,
  DomainValidationError,
  aggregatePositionInputs,
  resolveQuote,
  summarizePortfolio,
  valuePosition,
  type UnifiedPosition,
} from "../domain/index.ts";
import { goldenFixture } from "./fixtures/golden.ts";
import { AAPL, MSFT, validQuote } from "./helpers.ts";

const golden = goldenFixture.cases;

function unifiedPosition(
  overrides: Partial<UnifiedPosition> = {},
): UnifiedPosition {
  return {
    instrument: AAPL,
    quantity: "10",
    openCost: "1000",
    averageCost: "100",
    calculationVersion: goldenFixture.calculationVersion,
    ...overrides,
  };
}

function healthyQuote(
  overrides: Parameters<typeof validQuote>[0] = {},
) {
  const quote = validQuote(overrides);
  return resolveQuote({
    requestedInstrument: quote.instrument,
    now: "2026-07-29T15:01:00Z",
    fetchStatus: "FETCH_OK",
    marketSession: quote.marketSession,
    candidate: quote,
  });
}

describe("unified position aggregation and valuation", () => {
  it("passes G-001 valuation and unrealized return", () => {
    const input = golden.G001;
    const [combined] = aggregatePositionInputs([
      {
        id: "g001-input",
        instrument: AAPL,
        quantity: input.quantity,
        costInput: {
          mode: "TOTAL_OPEN_COST",
          value: input.expectedOpenCost,
        },
      },
    ]);
    const valued = valuePosition(
      combined!,
      healthyQuote({ price: input.valuationPrice }),
    );

    expect(valued.marketValue).toBe(input.expectedMarketValue);
    expect(valued.unrealizedPnl).toBe(input.expectedUnrealizedPnl);
    expect(
      new Decimal(valued.unrealizedReturn!).eq(
        new Decimal(input.expectedUnrealizedPnl).div(
          input.expectedOpenCost,
        ),
      ),
    ).toBe(true);
  });

  it("passes G-002 using weighted open cost, not average-of-averages", () => {
    const input = golden.G002;
    const [combined] = aggregatePositionInputs([
      {
        id: "input-a",
        instrument: AAPL,
        quantity: input.brokerA.quantity,
        costInput: {
          mode: "TOTAL_OPEN_COST",
          value: new Decimal(input.brokerA.quantity)
            .mul(input.brokerA.unitPrice)
            .add(input.brokerA.fee)
            .toFixed(),
        },
      },
      {
        id: "input-b",
        instrument: AAPL,
        quantity: input.brokerB.quantity,
        costInput: {
          mode: "TOTAL_OPEN_COST",
          value: new Decimal(input.brokerB.quantity)
            .mul(input.brokerB.unitPrice)
            .add(input.brokerB.fee)
            .toFixed(),
        },
      },
    ]);
    expect(combined).toBeDefined();
    expect(combined!.quantity).toBe(input.expectedQuantity);
    expect(combined!.openCost).toBe(input.expectedOpenCost);
    expect(
      new Decimal(combined!.averageCost).eq(
        new Decimal(input.expectedOpenCost).div(input.expectedQuantity),
      ),
    ).toBe(true);
    expect(combined!.averageCost).not.toBe(
      new Decimal("100.1").add("120.4").div(2).toFixed(),
    );

    const resolved = healthyQuote({
      price: input.valuationPrice,
      previousRegularClose: "125",
    });
    const valued = valuePosition(combined!, resolved);
    expect(valued.marketValue).toBe(input.expectedMarketValue);
    expect(valued.unrealizedPnl).toBe(input.expectedUnrealizedPnl);
    expect(
      new Decimal(valued.unrealizedReturn!).eq(
        new Decimal(input.expectedUnrealizedPnl).div(
          input.expectedOpenCost,
        ),
      ),
    ).toBe(true);
  });

  it("keeps different listing markets separate even with the same symbol", () => {
    const positions = aggregatePositionInputs([
      {
        id: "nasdaq-aapl",
        instrument: AAPL,
        quantity: "1",
        costInput: { mode: "AVERAGE_COST", value: "100" },
      },
      {
        id: "other-market-aapl",
        instrument: { ...AAPL, listingMarket: "SYNTHETIC-OTHER" },
        quantity: "1",
        costInput: { mode: "AVERAGE_COST", value: "100" },
      },
    ]);

    expect(positions).toHaveLength(2);
  });

  it("passes G-003 fractional-share valuation", () => {
    const input = golden.G003;
    const [combined] = aggregatePositionInputs([
      {
        id: "g003-input",
        instrument: AAPL,
        quantity: input.quantity,
        costInput: {
          mode: "AVERAGE_COST",
          value: input.expectedAverageCost,
        },
      },
    ]);
    const valued = valuePosition(
      combined!,
      healthyQuote({ price: input.valuationPrice }),
    );

    expect(valued.marketValue).toBe(input.expectedMarketValue);
    expect(valued.unrealizedPnl).toBe(input.expectedUnrealizedPnl);
    expect(
      new Decimal(valued.unrealizedReturn!).eq(
        new Decimal(input.expectedUnrealizedPnl).div(
          input.expectedOpenCost,
        ),
      ),
    ).toBe(true);
  });

  it("passes G-004 with the fixed estimated-price-effect metric", () => {
    const input = golden.G004;
    const position = unifiedPosition({
      quantity: input.quantity,
      openCost: "1100",
      averageCost: "100",
    });
    const quote = healthyQuote({
      price: input.valuationPrice,
      previousRegularClose: input.previousRegularClose,
    });
    const valued = valuePosition(position, quote);

    expect(valued.metricKind).toBe("ESTIMATED_PRICE_EFFECT");
    expect(valued.estimatedDailyPriceEffect).toBe(
      input.expectedEstimatedDailyPriceEffect,
    );
    expect(
      new Decimal(valued.estimatedDailyChangeRate!).eq(
        new Decimal(input.valuationPrice)
          .sub(input.previousRegularClose)
          .div(input.previousRegularClose),
      ),
    ).toBe(true);
    expect(valued).not.toHaveProperty("exactDailyPnl");
  });

  it("changes valuation without mutating quantity or open cost", () => {
    const position = unifiedPosition();
    const at120 = valuePosition(
      position,
      healthyQuote({ price: "120" }),
    );
    const at130 = valuePosition(
      position,
      healthyQuote({ price: "130" }),
    );

    expect(at120.quantity).toBe(at130.quantity);
    expect(at120.openCost).toBe(at130.openCost);
    expect(at120.marketValue).not.toBe(at130.marketValue);
  });

  it("marks G-006 partial pricing and separates unpriced cost", () => {
    const aapl = unifiedPosition({
      openCost: "1000",
      quantity: "10",
      averageCost: "100",
    });
    const msft = unifiedPosition({
      instrument: MSFT,
      openCost: "600",
      quantity: "2",
      averageCost: "300",
    });
    const summary = summarizePortfolio([
      valuePosition(aapl, healthyQuote()),
      valuePosition(msft, null),
    ]);

    expect(summary.status).toBe("PARTIAL");
    expect(summary.openPositionCount).toBe(2);
    expect(summary.unpricedPositionCount).toBe(1);
    expect(summary.pricedOpenCost).toBe("1000");
    expect(summary.unpricedOpenCost).toBe("600");
    expect(summary.pricingCoverageByCost).toBe("0.625");
    expect(summary.estimatedDailyPriceEffect).toBeNull();
  });

  it("reports complete healthy pricing counts and oldest quote times", () => {
    const aapl = valuePosition(
      unifiedPosition(),
      healthyQuote({
        sourceEventAt: "2026-07-29T14:44:00Z",
        fetchedAt: "2026-07-29T15:00:30Z",
      }),
    );
    const msft = valuePosition(
      unifiedPosition({
        instrument: MSFT,
        quantity: "2",
        openCost: "600",
        averageCost: "300",
      }),
      healthyQuote({
        instrument: MSFT,
        sourceEventAt: "2026-07-29T14:45:00Z",
        fetchedAt: "2026-07-29T15:00:45Z",
      }),
    );
    const summary = summarizePortfolio([aapl, msft]);

    expect(summary.status).toBe("COMPLETE_HEALTHY");
    expect(summary.openPositionCount).toBe(2);
    expect(summary.healthyPriceCount).toBe(2);
    expect(summary.agingPriceCount).toBe(0);
    expect(summary.stalePriceCount).toBe(0);
    expect(summary.unpricedPositionCount).toBe(0);
    expect(summary.oldestSourceEventAt).toBe("2026-07-29T14:44:00Z");
    expect(summary.oldestFetchedAt).toBe("2026-07-29T15:00:30Z");
  });

  it("reports complete pricing with aging when any quote is aging", () => {
    const aapl = valuePosition(unifiedPosition(), healthyQuote());
    const msft = valuePosition(
      unifiedPosition({
        instrument: MSFT,
        quantity: "2",
        openCost: "600",
        averageCost: "300",
      }),
      healthyQuote({
        instrument: MSFT,
        sourceEventAt: "2026-07-29T14:43:59.999999999Z",
        fetchedAt: "2026-07-29T15:00:45Z",
      }),
    );
    const summary = summarizePortfolio([aapl, msft]);

    expect(summary.status).toBe("COMPLETE_WITH_AGING");
    expect(summary.healthyPriceCount).toBe(1);
    expect(summary.agingPriceCount).toBe(1);
    expect(summary.stalePriceCount).toBe(0);
    expect(summary.unpricedPositionCount).toBe(0);
    expect(summary.oldestSourceEventAt).toBe(
      "2026-07-29T14:43:59.999999999Z",
    );
    expect(summary.oldestFetchedAt).toBe("2026-07-29T15:00:30Z");
  });

  it("includes a stale fallback in estimated value and exposes stale completeness", () => {
    const fallback = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:10:00Z",
      fetchStatus: "FETCH_FAILED",
      marketSession: "REGULAR",
      lastValidQuote: validQuote({
        price: "130",
        sourceEventAt: "2026-07-29T14:45:00Z",
        fetchedAt: "2026-07-29T14:46:00Z",
      }),
    });
    const summary = summarizePortfolio([
      valuePosition(unifiedPosition(), fallback),
    ]);

    expect(fallback.usedLastValid).toBe(true);
    expect(summary.status).toBe("COMPLETE_WITH_STALE");
    expect(summary.pricedMarketValue).toBe("1300");
    expect(summary.stalePriceCount).toBe(1);
  });

  it("keeps valuation available but daily metrics unknown without a previous close", () => {
    const {
      previousRegularClose: omittedPreviousClose,
      ...quoteWithoutPreviousClose
    } = validQuote();
    void omittedPreviousClose;
    const valued = valuePosition(
      unifiedPosition(),
      resolveQuote({
        requestedInstrument: AAPL,
        now: "2026-07-29T15:01:00Z",
        fetchStatus: "FETCH_OK",
        marketSession: "REGULAR",
        candidate: quoteWithoutPreviousClose,
      }),
    );
    const summary = summarizePortfolio([valued]);

    expect(valued.marketValue).toBe("1300");
    expect(valued.estimatedDailyPriceEffect).toBeNull();
    expect(valued.estimatedDailyChangeRate).toBeNull();
    expect(valued.previousRegularCloseValue).toBeNull();
    expect(summary.status).toBe("COMPLETE_HEALTHY");
    expect(summary.estimatedDailyPriceEffect).toBeNull();
    expect(summary.estimatedDailyChangeRate).toBeNull();
  });

  it("calculates the portfolio daily change rate from summed unrounded values", () => {
    const aapl = valuePosition(
      unifiedPosition({
        quantity: "10",
        openCost: "1000",
        averageCost: "100",
      }),
      healthyQuote({
        price: "110",
        previousRegularClose: "100",
      }),
    );
    const msft = valuePosition(
      unifiedPosition({
        instrument: MSFT,
        quantity: "2",
        openCost: "600",
        averageCost: "300",
      }),
      healthyQuote({
        instrument: MSFT,
        price: "180",
        previousRegularClose: "200",
      }),
    );
    const summary = summarizePortfolio([aapl, msft]);

    expect(summary.estimatedDailyPriceEffect).toBe("60");
    expect(
      new Decimal(summary.estimatedDailyChangeRate!).eq(
        new Decimal("60").div("1400"),
      ),
    ).toBe(true);
  });

  it("returns unknown percentage and a review flag for a zero-cost holding", () => {
    const valued = valuePosition(
      unifiedPosition({
        quantity: "1",
        openCost: "0",
        averageCost: "0",
      }),
      healthyQuote({ price: "100" }),
    );

    expect(valued.unrealizedReturn).toBeNull();
    expect(valued.costReviewRequired).toBe(true);
  });

  it("does not manufacture a zero daily metric for an empty portfolio", () => {
    const summary = summarizePortfolio([]);
    expect(summary.status).toBe("UNAVAILABLE");
    expect(summary.estimatedDailyPriceEffect).toBeNull();
    expect(summary.estimatedDailyChangeRate).toBeNull();
  });

  it("rejects duplicate input ids within one instrument", () => {
    const input = {
      id: "duplicate",
      instrument: AAPL,
      quantity: "1",
      costInput: {
        mode: "AVERAGE_COST" as const,
        value: "100",
      },
    };
    expect(() =>
      aggregatePositionInputs([input, input]),
    ).toThrow(DomainValidationError);
  });

  it("does not relabel cached values from another calculation version", () => {
    const staleUnified = {
      ...unifiedPosition(),
      calculationVersion: "legacy-calculation-v0",
    } as unknown as UnifiedPosition;
    expect(() => valuePosition(staleUnified, healthyQuote())).toThrow(
      DomainValidationError,
    );

    const valued = valuePosition(unifiedPosition(), healthyQuote());
    expect(() =>
      summarizePortfolio([
        {
          ...valued,
          calculationVersion: "legacy-calculation-v0",
        } as unknown as typeof valued,
      ]),
    ).toThrow(DomainValidationError);
  });
});
