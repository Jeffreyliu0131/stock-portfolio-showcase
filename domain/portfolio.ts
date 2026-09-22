import {
  Decimal,
  canonicalDecimal,
  parseDecimal,
  type DecimalString,
  type PreciseDecimal,
} from "./decimal.ts";
import { failDomain } from "./errors.ts";
import {
  instrumentKeyId,
  sameInstrument,
} from "./instrument.ts";
import type { UnifiedPosition } from "./positions.ts";
import type {
  FetchStatus,
  ResolvedQuote,
  ValuationStatus,
} from "./quotes.ts";
import { compareRfc3339 } from "./time.ts";
import { CALCULATION_VERSION } from "./version.ts";

export interface ValuedPosition extends UnifiedPosition {
  readonly valuationPrice: DecimalString | null;
  readonly marketValue: DecimalString | null;
  readonly unrealizedPnl: DecimalString | null;
  readonly unrealizedReturn: DecimalString | null;
  readonly costReviewRequired: boolean;
  readonly metricKind: "ESTIMATED_PRICE_EFFECT";
  readonly estimatedDailyPriceEffect: DecimalString | null;
  readonly estimatedDailyChangeRate: DecimalString | null;
  readonly previousRegularCloseValue: DecimalString | null;
  readonly quote: ResolvedQuote | null;
}

export type PortfolioStatus =
  | "COMPLETE_HEALTHY"
  | "COMPLETE_WITH_AGING"
  | "COMPLETE_WITH_STALE"
  | "PARTIAL"
  | "UNAVAILABLE";

export interface PortfolioSummary {
  readonly calculationVersion: string;
  readonly status: PortfolioStatus;
  readonly openPositionCount: number;
  readonly healthyPriceCount: number;
  readonly agingPriceCount: number;
  readonly stalePriceCount: number;
  readonly unpricedPositionCount: number;
  readonly portfolioOpenCost: DecimalString;
  readonly pricedOpenCost: DecimalString;
  readonly unpricedOpenCost: DecimalString;
  readonly pricedMarketValue: DecimalString;
  readonly pricedUnrealizedPnl: DecimalString;
  readonly pricingCoverageByCost: DecimalString | null;
  readonly metricKind: "ESTIMATED_PRICE_EFFECT";
  readonly estimatedDailyPriceEffect: DecimalString | null;
  readonly estimatedDailyChangeRate: DecimalString | null;
  readonly oldestSourceEventAt: string | null;
  readonly oldestFetchedAt: string | null;
}

function nonNegativeDerivedDecimal(
  value: DecimalString,
  field: string,
): PreciseDecimal {
  const parsed = parseDecimal(value, { field });
  if (parsed.lt(0)) {
    failDomain({
      code: "NEGATIVE_POSITION",
      field,
      message: `${field} must not be negative`,
    });
  }
  return parsed;
}

function requireCurrentCalculationVersion(
  version: string,
  field: string,
): void {
  if (version !== CALCULATION_VERSION) {
    failDomain({
      code: "CALCULATION_VERSION_MISMATCH",
      field,
      message: `${field} must be ${CALCULATION_VERSION}; received ${version}`,
    });
  }
}

export function valuePosition(
  position: UnifiedPosition,
  quote: ResolvedQuote | null,
): ValuedPosition {
  requireCurrentCalculationVersion(
    position.calculationVersion,
    "position.calculationVersion",
  );
  const quantity = nonNegativeDerivedDecimal(
    position.quantity,
    "position.quantity",
  );
  const openCost = nonNegativeDerivedDecimal(
    position.openCost,
    "position.openCost",
  );
  if (quantity.isZero()) {
    failDomain({
      code: "INVALID_QUANTITY",
      field: "position.quantity",
      message: "an open unified position must have quantity greater than zero",
    });
  }
  const averageCost = nonNegativeDerivedDecimal(
    position.averageCost,
    "position.averageCost",
  );
  if (!averageCost.eq(openCost.div(quantity))) {
    failDomain({
      code: "INVALID_COST",
      field: "position.averageCost",
      message: "unified average cost must equal open cost divided by quantity",
    });
  }

  if (quote === null || quote.effectivePrice === null) {
    return {
      ...position,
      valuationPrice: null,
      marketValue: null,
      unrealizedPnl: null,
      unrealizedReturn: null,
      costReviewRequired: openCost.isZero(),
      metricKind: "ESTIMATED_PRICE_EFFECT",
      estimatedDailyPriceEffect: null,
      estimatedDailyChangeRate: null,
      previousRegularCloseValue: null,
      quote,
    };
  }
  if (!sameInstrument(position.instrument, quote.instrument)) {
    failDomain({
      code: "INVALID_INSTRUMENT",
      message: "quote instrument does not match the position instrument",
    });
  }

  const valuationPrice = parseDecimal(quote.effectivePrice, {
    field: "quote.effectivePrice",
  });
  if (valuationPrice.lte(0)) {
    failDomain({
      code: "INVALID_PRICE",
      field: "quote.effectivePrice",
      message: "effective valuation price must be greater than zero",
    });
  }

  const marketValue = quantity.mul(valuationPrice);
  const unrealizedPnl = marketValue.sub(openCost);
  const previousRegularClose =
    quote.previousRegularClose === null
      ? null
      : parseDecimal(quote.previousRegularClose, {
          field: "quote.previousRegularClose",
        });
  if (
    previousRegularClose !== null &&
    previousRegularClose.lte(0)
  ) {
    failDomain({
      code: "INVALID_PRICE",
      field: "quote.previousRegularClose",
      message: "previous regular close must be greater than zero",
    });
  }
  const previousRegularCloseValue =
    previousRegularClose === null
      ? null
      : quantity.mul(previousRegularClose);

  return {
    ...position,
    valuationPrice: canonicalDecimal(valuationPrice),
    marketValue: canonicalDecimal(marketValue),
    unrealizedPnl: canonicalDecimal(unrealizedPnl),
    unrealizedReturn: openCost.isZero()
      ? null
      : canonicalDecimal(unrealizedPnl.div(openCost)),
    costReviewRequired: openCost.isZero(),
    metricKind: "ESTIMATED_PRICE_EFFECT",
    estimatedDailyPriceEffect:
      previousRegularClose === null
        ? null
        : canonicalDecimal(
            quantity.mul(valuationPrice.sub(previousRegularClose)),
          ),
    estimatedDailyChangeRate:
      previousRegularClose === null
        ? null
        : canonicalDecimal(
            valuationPrice
              .sub(previousRegularClose)
              .div(previousRegularClose),
          ),
    previousRegularCloseValue:
      previousRegularCloseValue === null
        ? null
        : canonicalDecimal(previousRegularCloseValue),
    quote,
  };
}

function isHealthyStatus(status: ValuationStatus): boolean {
  return status === "HEALTHY_DELAYED" || status === "CLOSED_FINAL";
}

function isStaleStatus(status: ValuationStatus): boolean {
  return (
    status === "STALE" ||
    status === "NO_RECENT_TRADE" ||
    status === "ANOMALOUS"
  );
}

function oldestTimestamp(
  current: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) {
    return current;
  }
  if (current === null) {
    return candidate;
  }
  return compareRfc3339(candidate, current) < 0 ? candidate : current;
}

function fetchFailed(fetchStatus: FetchStatus): boolean {
  return (
    fetchStatus === "FETCH_FAILED" ||
    fetchStatus === "RATE_LIMITED" ||
    fetchStatus === "UNAUTHORIZED"
  );
}

export function summarizePortfolio(
  positions: readonly ValuedPosition[],
): PortfolioSummary {
  for (const position of positions) {
    requireCurrentCalculationVersion(
      position.calculationVersion,
      "position.calculationVersion",
    );
  }
  const positionKeys = new Set<string>();
  for (const position of positions) {
    const key = instrumentKeyId(position.instrument);
    if (positionKeys.has(key)) {
      failDomain({
        code: "INVALID_ENTRY",
        message: "a portfolio summary contains a duplicate instrument",
      });
    }
    positionKeys.add(key);
  }

  let portfolioOpenCost = new Decimal("0");
  let pricedOpenCost = new Decimal("0");
  let pricedMarketValue = new Decimal("0");
  let dailyEffect = new Decimal("0");
  let dailyPreviousCloseValue = new Decimal("0");
  let healthyPriceCount = 0;
  let agingPriceCount = 0;
  let stalePriceCount = 0;
  let unpricedPositionCount = 0;
  let dailyMetricComplete = positions.length > 0;
  let oldestSourceEventAt: string | null = null;
  let oldestFetchedAt: string | null = null;

  for (const position of positions) {
    const openCost = nonNegativeDerivedDecimal(
      position.openCost,
      "position.openCost",
    );
    portfolioOpenCost = portfolioOpenCost.add(openCost);

    if (
      position.marketValue === null ||
      position.quote === null ||
      position.quote.effectivePrice === null
    ) {
      unpricedPositionCount += 1;
      dailyMetricComplete = false;
      continue;
    }

    pricedOpenCost = pricedOpenCost.add(openCost);
    pricedMarketValue = pricedMarketValue.add(
      parseDecimal(position.marketValue, { field: "position.marketValue" }),
    );
    oldestSourceEventAt = oldestTimestamp(
      oldestSourceEventAt,
      position.quote.sourceEventAt,
    );
    oldestFetchedAt = oldestTimestamp(
      oldestFetchedAt,
      position.quote.fetchedAt,
    );

    if (isStaleStatus(position.quote.valuationStatus)) {
      stalePriceCount += 1;
    } else if (
      isHealthyStatus(position.quote.valuationStatus) &&
      !fetchFailed(position.quote.fetchStatus)
    ) {
      healthyPriceCount += 1;
    } else if (
      position.quote.valuationStatus === "AGING" ||
      fetchFailed(position.quote.fetchStatus)
    ) {
      agingPriceCount += 1;
    } else {
      agingPriceCount += 1;
    }

    if (
      position.estimatedDailyPriceEffect === null ||
      position.previousRegularCloseValue === null
    ) {
      dailyMetricComplete = false;
    } else {
      dailyEffect = dailyEffect.add(
        parseDecimal(position.estimatedDailyPriceEffect, {
          field: "position.estimatedDailyPriceEffect",
        }),
      );
      dailyPreviousCloseValue = dailyPreviousCloseValue.add(
        parseDecimal(position.previousRegularCloseValue, {
          field: "position.previousRegularCloseValue",
        }),
      );
    }
  }

  const pricedPositionCount =
    positions.length - unpricedPositionCount;
  const status: PortfolioStatus =
    positions.length === 0 || pricedPositionCount === 0
      ? "UNAVAILABLE"
      : unpricedPositionCount > 0
        ? "PARTIAL"
        : stalePriceCount > 0
          ? "COMPLETE_WITH_STALE"
          : agingPriceCount > 0
            ? "COMPLETE_WITH_AGING"
            : "COMPLETE_HEALTHY";
  const unpricedOpenCost = portfolioOpenCost.sub(pricedOpenCost);
  const pricedUnrealizedPnl = pricedMarketValue.sub(pricedOpenCost);

  return {
    calculationVersion: CALCULATION_VERSION,
    status,
    openPositionCount: positions.length,
    healthyPriceCount,
    agingPriceCount,
    stalePriceCount,
    unpricedPositionCount,
    portfolioOpenCost: canonicalDecimal(portfolioOpenCost),
    pricedOpenCost: canonicalDecimal(pricedOpenCost),
    unpricedOpenCost: canonicalDecimal(unpricedOpenCost),
    pricedMarketValue: canonicalDecimal(pricedMarketValue),
    pricedUnrealizedPnl: canonicalDecimal(pricedUnrealizedPnl),
    pricingCoverageByCost: portfolioOpenCost.isZero()
      ? null
      : canonicalDecimal(pricedOpenCost.div(portfolioOpenCost)),
    metricKind: "ESTIMATED_PRICE_EFFECT",
    estimatedDailyPriceEffect: dailyMetricComplete
      ? canonicalDecimal(dailyEffect)
      : null,
    estimatedDailyChangeRate:
      dailyMetricComplete && !dailyPreviousCloseValue.isZero()
        ? canonicalDecimal(dailyEffect.div(dailyPreviousCloseValue))
        : null,
    oldestSourceEventAt,
    oldestFetchedAt,
  };
}
