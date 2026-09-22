import {
  Decimal,
  canonicalDecimal,
  type DecimalString,
  type PreciseDecimal,
} from "../domain/index.ts";
import type {
  PortfolioCopyPosition,
  PortfolioCopySource,
} from "./portfolio-copy-text.ts";

export type PortfolioInsightCompleteness =
  | "COMPLETE"
  | "PARTIAL"
  | "UNAVAILABLE";

export type PortfolioWeightBasis =
  | "TOTAL_ASSETS"
  | "PRICED_ASSETS"
  | "UNAVAILABLE";

export interface PortfolioStructurePosition {
  readonly instrumentKey: string;
  readonly symbol: string;
  readonly name: string;
  readonly marketRank: number | null;
  readonly marketValueUsd: DecimalString | null;
  /** Fraction of total or priced assets, never a formatted percentage. */
  readonly assetWeight: DecimalString | null;
}

export interface PortfolioCashStructure {
  readonly balanceUsd: DecimalString;
  /** Fraction of total or priced assets, never a formatted percentage. */
  readonly assetWeight: DecimalString | null;
}

export interface PortfolioConcentrationMetric {
  readonly includedPositionCount: number;
  readonly marketValueUsd: DecimalString;
  /** Fraction of total or priced assets, never a formatted percentage. */
  readonly assetWeight: DecimalString;
}

export interface PortfolioConcentrationInsights {
  /** PARTIAL means unpriced stocks are excluded from both ranking and weight. */
  readonly status: PortfolioInsightCompleteness;
  readonly top1: PortfolioConcentrationMetric | null;
  readonly top3: PortfolioConcentrationMetric | null;
  readonly top5: PortfolioConcentrationMetric | null;
}

export interface PortfolioStructureInsights {
  readonly pricingComplete: boolean;
  readonly pricedPositionCount: number;
  readonly unpricedPositionCount: number;
  /**
   * The denominator used by assetWeight. It is null when neither a priced
   * stock nor cash is available.
   */
  readonly totalPricedAssetsUsd: DecimalString | null;
  readonly weightBasis: PortfolioWeightBasis;
  readonly positions: readonly PortfolioStructurePosition[];
  readonly cash: PortfolioCashStructure | null;
  readonly concentration: PortfolioConcentrationInsights;
}

export type DailyContributionStatus =
  | "AVAILABLE"
  | "MISSING_PRICE"
  | "MISSING_PREVIOUS_CLOSE";

export type DailyContributionDirection =
  | "POSITIVE"
  | "NEGATIVE"
  | "NEUTRAL"
  | "UNAVAILABLE";

export type DailyContributionShareBasis =
  | "COMPLETE_PORTFOLIO"
  | "CALCULABLE_POSITIONS"
  | "ZERO_ABSOLUTE_EFFECT"
  | "UNAVAILABLE";

export interface PortfolioDailyContribution {
  readonly instrumentKey: string;
  readonly symbol: string;
  readonly name: string;
  readonly status: DailyContributionStatus;
  /** Signed, unrounded USD amount. */
  readonly amountUsd: DecimalString | null;
  readonly direction: DailyContributionDirection;
  /**
   * abs(amountUsd) divided by the sum of absolute calculable contributions.
   * This is null for a missing contribution or a zero absolute denominator.
   */
  readonly absoluteContributionShare: DecimalString | null;
}

export interface PortfolioDailyContributor {
  readonly instrumentKey: string;
  readonly symbol: string;
  readonly name: string;
  /** Signed, unrounded USD amount. */
  readonly amountUsd: DecimalString;
  readonly absoluteContributionShare: DecimalString;
}

export interface PortfolioDailyInsights {
  readonly status: PortfolioInsightCompleteness;
  readonly totalPositionCount: number;
  readonly calculablePositionCount: number;
  /**
   * A portfolio net amount exists only when every stock is calculable.
   * Missing prices or previous closes never enter this value as zero.
   */
  readonly netEffectUsd: DecimalString | null;
  /** Sum of abs(amountUsd) for calculable positions, including partial data. */
  readonly calculableAbsoluteEffectUsd: DecimalString | null;
  readonly shareBasis: DailyContributionShareBasis;
  readonly contributions: readonly PortfolioDailyContribution[];
  /** Largest known positive contributor; status says whether coverage is full. */
  readonly largestPositiveContributor: PortfolioDailyContributor | null;
  /** Largest known negative contributor; status says whether coverage is full. */
  readonly largestNegativeContributor: PortfolioDailyContributor | null;
}

export interface PortfolioInsights {
  /** Monetary truth remains USD; a CNY UI derives amounts from these fields. */
  readonly currency: "USD";
  readonly structure: PortfolioStructureInsights;
  readonly daily: PortfolioDailyInsights;
}

interface AvailableDailyContribution {
  readonly position: PortfolioCopyPosition;
  readonly amount: PreciseDecimal;
}

function decimal(value: DecimalString): PreciseDecimal {
  return new Decimal(value);
}

function canonical(value: PreciseDecimal): DecimalString {
  return canonicalDecimal(value);
}

function assetDenominator(
  source: PortfolioCopySource,
): PreciseDecimal | null {
  const hasPricedPosition = source.positions.some(
    ({ value }) => value.marketValue !== null,
  );
  if (!hasPricedPosition && source.cash === null) {
    return null;
  }
  const pricedMarketValue = source.positions.reduce((total, position) => {
    const marketValue = position.value.marketValue;
    return marketValue === null ? total : total.add(marketValue);
  }, new Decimal(0));
  return source.cash === null
    ? pricedMarketValue
    : pricedMarketValue.add(source.cash.totalBalance);
}

function structurePosition(
  position: PortfolioCopyPosition,
  denominator: PreciseDecimal | null,
): PortfolioStructurePosition {
  const marketValue =
    position.value.marketValue === null
      ? null
      : decimal(position.value.marketValue);
  return {
    instrumentKey: position.instrumentKey,
    symbol: position.value.instrument.symbol,
    name: position.name,
    marketRank: position.marketRank,
    marketValueUsd: marketValue === null ? null : canonical(marketValue),
    assetWeight:
      marketValue === null || denominator === null || denominator.isZero()
        ? null
        : canonical(marketValue.div(denominator)),
  };
}

function concentrationMetric(
  pricedPositions: readonly PortfolioCopyPosition[],
  limit: 1 | 3 | 5,
  denominator: PreciseDecimal | null,
): PortfolioConcentrationMetric | null {
  if (pricedPositions.length === 0 || denominator === null || denominator.isZero()) {
    return null;
  }
  const selected = pricedPositions.slice(0, limit);
  const marketValue = selected.reduce((total, position) => {
    if (position.value.marketValue === null) {
      throw new Error("a concentration position must have a market value");
    }
    return total.add(position.value.marketValue);
  }, new Decimal(0));
  return {
    includedPositionCount: selected.length,
    marketValueUsd: canonical(marketValue),
    assetWeight: canonical(marketValue.div(denominator)),
  };
}

function createStructureInsights(
  source: PortfolioCopySource,
): PortfolioStructureInsights {
  const denominator = assetDenominator(source);
  const pricedPositions = source.positions.filter(
    ({ value }) => value.marketValue !== null,
  );
  const unpricedPositionCount =
    source.positions.length - pricedPositions.length;
  const pricingComplete = unpricedPositionCount === 0;
  const weightBasis: PortfolioWeightBasis =
    denominator === null || denominator.isZero()
      ? "UNAVAILABLE"
      : pricingComplete
        ? "TOTAL_ASSETS"
        : "PRICED_ASSETS";
  const concentrationStatus: PortfolioInsightCompleteness =
    pricedPositions.length === 0 || denominator === null || denominator.isZero()
      ? "UNAVAILABLE"
      : pricingComplete
        ? "COMPLETE"
        : "PARTIAL";

  return {
    pricingComplete,
    pricedPositionCount: pricedPositions.length,
    unpricedPositionCount,
    totalPricedAssetsUsd:
      denominator === null ? null : canonical(denominator),
    weightBasis,
    positions: source.positions.map((position) =>
      structurePosition(position, denominator),
    ),
    cash:
      source.cash === null
        ? null
        : {
            balanceUsd: canonical(
              decimal(source.cash.totalBalance),
            ),
            assetWeight:
              denominator === null || denominator.isZero()
                ? null
                : canonical(
                    decimal(source.cash.totalBalance).div(
                      denominator,
                    ),
                  ),
          },
    concentration: {
      status: concentrationStatus,
      top1: concentrationMetric(pricedPositions, 1, denominator),
      top3: concentrationMetric(pricedPositions, 3, denominator),
      top5: concentrationMetric(pricedPositions, 5, denominator),
    },
  };
}

function contributionStatus(
  position: PortfolioCopyPosition,
): DailyContributionStatus {
  if (
    position.value.marketValue === null ||
    position.value.valuationPrice === null
  ) {
    return "MISSING_PRICE";
  }
  return position.value.estimatedDailyPriceEffect === null ||
    position.value.previousRegularCloseValue === null
    ? "MISSING_PREVIOUS_CLOSE"
    : "AVAILABLE";
}

function contributionDirection(
  amount: PreciseDecimal | null,
): DailyContributionDirection {
  if (amount === null) {
    return "UNAVAILABLE";
  }
  if (amount.isZero()) {
    return "NEUTRAL";
  }
  return amount.isPositive() ? "POSITIVE" : "NEGATIVE";
}

function contributor(
  entry: AvailableDailyContribution,
  absoluteTotal: PreciseDecimal,
): PortfolioDailyContributor {
  return {
    instrumentKey: entry.position.instrumentKey,
    symbol: entry.position.value.instrument.symbol,
    name: entry.position.name,
    amountUsd: canonical(entry.amount),
    absoluteContributionShare: canonical(
      entry.amount.abs().div(absoluteTotal),
    ),
  };
}

function createDailyInsights(
  source: PortfolioCopySource,
): PortfolioDailyInsights {
  const available: AvailableDailyContribution[] = [];
  for (const position of source.positions) {
    if (contributionStatus(position) !== "AVAILABLE") {
      continue;
    }
    const amount = position.value.estimatedDailyPriceEffect;
    if (amount !== null) {
      available.push({ position, amount: decimal(amount) });
    }
  }

  const totalPositionCount = source.positions.length;
  const calculablePositionCount = available.length;
  const status: PortfolioInsightCompleteness =
    totalPositionCount === 0 || calculablePositionCount === 0
      ? "UNAVAILABLE"
      : calculablePositionCount === totalPositionCount
        ? "COMPLETE"
        : "PARTIAL";
  const calculableNet = available.reduce(
    (total, entry) => total.add(entry.amount),
    new Decimal(0),
  );
  const absoluteTotal = available.reduce(
    (total, entry) => total.add(entry.amount.abs()),
    new Decimal(0),
  );
  const hasAbsoluteDenominator =
    calculablePositionCount > 0 && !absoluteTotal.isZero();
  const shareBasis: DailyContributionShareBasis =
    calculablePositionCount === 0
      ? "UNAVAILABLE"
      : absoluteTotal.isZero()
        ? "ZERO_ABSOLUTE_EFFECT"
        : status === "COMPLETE"
          ? "COMPLETE_PORTFOLIO"
          : "CALCULABLE_POSITIONS";
  const amountsByInstrument = new Map(
    available.map((entry) => [entry.position.instrumentKey, entry.amount]),
  );

  let largestPositive: AvailableDailyContribution | null = null;
  let largestNegative: AvailableDailyContribution | null = null;
  for (const entry of available) {
    if (
      entry.amount.isPositive() &&
      (largestPositive === null || entry.amount.gt(largestPositive.amount))
    ) {
      largestPositive = entry;
    }
    if (
      entry.amount.isNegative() &&
      (largestNegative === null || entry.amount.lt(largestNegative.amount))
    ) {
      largestNegative = entry;
    }
  }

  return {
    status,
    totalPositionCount,
    calculablePositionCount,
    netEffectUsd:
      status === "COMPLETE" ? canonical(calculableNet) : null,
    calculableAbsoluteEffectUsd:
      calculablePositionCount === 0 ? null : canonical(absoluteTotal),
    shareBasis,
    contributions: source.positions.map((position) => {
      const contribution = amountsByInstrument.get(position.instrumentKey) ?? null;
      const positionStatus = contributionStatus(position);
      return {
        instrumentKey: position.instrumentKey,
        symbol: position.value.instrument.symbol,
        name: position.name,
        status: positionStatus,
        amountUsd:
          contribution === null ? null : canonical(contribution),
        direction: contributionDirection(contribution),
        absoluteContributionShare:
          contribution === null || !hasAbsoluteDenominator
            ? null
            : canonical(contribution.abs().div(absoluteTotal)),
      };
    }),
    largestPositiveContributor:
      largestPositive === null || !hasAbsoluteDenominator
        ? null
        : contributor(largestPositive, absoluteTotal),
    largestNegativeContributor:
      largestNegative === null || !hasAbsoluteDenominator
        ? null
        : contributor(largestNegative, absoluteTotal),
  };
}

export function createPortfolioInsights(
  source: PortfolioCopySource,
): PortfolioInsights {
  return {
    currency: "USD",
    structure: createStructureInsights(source),
    daily: createDailyInsights(source),
  };
}
