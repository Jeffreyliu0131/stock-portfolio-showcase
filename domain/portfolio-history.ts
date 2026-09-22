import {
  Decimal,
  canonicalDecimal,
  parseDecimal,
  parsePositiveInput,
  type DecimalString,
  type PreciseDecimal,
} from "./decimal.ts";
import { failDomain } from "./errors.ts";
import {
  compareRfc3339,
  rfc3339ToEpochNanoseconds,
} from "./time.ts";

export const PORTFOLIO_TREND_RANGES = [
  "1D",
  "1W",
  "1M",
  "3M",
  "1Y",
  "ALL",
] as const;

export type PortfolioTrendRange = (typeof PORTFOLIO_TREND_RANGES)[number];
export type HistoricalPortfolioTrendRange = Exclude<PortfolioTrendRange, "1D">;

export interface HistoricalNavObservation {
  readonly observedAt: string;
  readonly valueUsd: DecimalString;
  readonly coverageComplete: boolean;
  readonly sourceScopeCount: number;
  /** Stable hashed source-set identity; equal keys may form a partial segment. */
  readonly sourceCoverageKey?: string;
}

export interface HistoricalExternalFlow {
  readonly occurredAt: string;
  /** Deposits are positive; withdrawals are negative. */
  readonly amountUsd: DecimalString;
}

export interface HistoricalReturnPoint {
  readonly sourceEventAt: string;
  readonly actualNav: DecimalString;
  readonly flowAdjustedChange: DecimalString;
  readonly returnRate: DecimalString;
  readonly connectFromPrevious: boolean;
}

export type HistoricalReturnUnavailableReason =
  | "NO_HISTORY"
  | "INSUFFICIENT_NAV"
  | "UNKNOWN_EXTERNAL_FLOW"
  | "INVALID_DIETZ_DENOMINATOR"
  | "NO_POINTS_IN_RANGE";

export type HistoricalReturnResult =
  | {
      readonly status: "READY" | "PARTIAL";
      readonly basis: "MODIFIED_DIETZ";
      readonly range: HistoricalPortfolioTrendRange;
      readonly rangeReturnRate: DecimalString | null;
      readonly rangeFlowAdjustedChange: DecimalString | null;
      readonly points: readonly HistoricalReturnPoint[];
      readonly segmentCount: number;
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly basis: "MODIFIED_DIETZ";
      readonly range: HistoricalPortfolioTrendRange;
      readonly reason: HistoricalReturnUnavailableReason;
      readonly points: readonly [];
    };

export interface CreateHistoricalReturnInput {
  readonly range: HistoricalPortfolioTrendRange;
  readonly observations: readonly HistoricalNavObservation[];
  readonly flows: readonly HistoricalExternalFlow[];
  readonly now: string;
  readonly hasUnknownExternalFlow?: boolean;
  /** A larger interval begins a new honest segment rather than an interpolated line. */
  readonly maximumConnectedGapDays?: number;
}

interface PreparedObservation {
  readonly observedAt: string;
  readonly instant: bigint;
  readonly valueUsd: PreciseDecimal;
  readonly coverageComplete: boolean;
  readonly sourceScopeCount: number;
  readonly sourceCoverageKey: string;
}

interface PreparedFlow {
  readonly occurredAt: string;
  readonly instant: bigint;
  readonly amountUsd: PreciseDecimal;
}

interface RangeObservations {
  readonly values: readonly PreparedObservation[];
  readonly boundaryCoverageComplete: boolean;
}

const NANOSECONDS_PER_DAY = 86_400_000_000_000n;
const RANGE_BOUNDARY_TOLERANCE = 3n * NANOSECONDS_PER_DAY;
const RANGE_PARTIAL_BASELINE_TOLERANCE = 14n * NANOSECONDS_PER_DAY;

function unavailable(
  range: HistoricalPortfolioTrendRange,
  reason: HistoricalReturnUnavailableReason,
): HistoricalReturnResult {
  return {
    status: "UNAVAILABLE",
    basis: "MODIFIED_DIETZ",
    range,
    reason,
    points: [],
  };
}

function prepareObservations(
  values: readonly HistoricalNavObservation[],
): readonly PreparedObservation[] {
  const sorted = values
    .map((value): PreparedObservation => {
      if (
        !Number.isSafeInteger(value.sourceScopeCount) ||
        value.sourceScopeCount < 1
      ) {
        failDomain({
          code: "INVALID_ENTRY",
          field: "historicalNav.sourceScopeCount",
          message: "historical NAV must have at least one source scope",
        });
      }
      return {
        observedAt: value.observedAt,
        instant: rfc3339ToEpochNanoseconds(
          value.observedAt,
          "historicalNav.observedAt",
        ),
        valueUsd: parsePositiveInput(
          value.valueUsd,
          "historicalNav.valueUsd",
        ),
        coverageComplete: value.coverageComplete,
        sourceScopeCount: value.sourceScopeCount,
        sourceCoverageKey:
          value.sourceCoverageKey ??
          (value.coverageComplete
            ? `COMPLETE:${value.sourceScopeCount}`
            : `UNKNOWN_PARTIAL:${value.observedAt}`),
      };
    })
    .toSorted((left, right) => compareRfc3339(left.observedAt, right.observedAt));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]?.instant === sorted[index - 1]?.instant) {
      failDomain({
        code: "INVALID_ENTRY",
        field: "historicalNav.observedAt",
        message: "historical NAV timestamps must be unique",
      });
    }
  }
  return sorted;
}

function prepareFlows(
  values: readonly HistoricalExternalFlow[],
): readonly PreparedFlow[] {
  return values
    .map((value): PreparedFlow => ({
      occurredAt: value.occurredAt,
      instant: rfc3339ToEpochNanoseconds(
        value.occurredAt,
        "historicalFlow.occurredAt",
      ),
      amountUsd: parseDecimal(value.amountUsd, {
        field: "historicalFlow.amountUsd",
        maxFractionalDigits: 8,
      }),
    }))
    .filter((value) => !value.amountUsd.isZero())
    .toSorted((left, right) => compareRfc3339(left.occurredAt, right.occurredAt));
}

export function historicalRangeStart(
  range: HistoricalPortfolioTrendRange,
  now: string,
): string | null {
  rfc3339ToEpochNanoseconds(now, "historicalRange.now");
  if (range === "ALL") {
    return null;
  }
  const value = new Date(now);
  if (Number.isNaN(value.getTime())) {
    failDomain({
      code: "INVALID_TIMESTAMP",
      field: "historicalRange.now",
      message: "historicalRange.now must be a valid timestamp",
    });
  }
  if (range === "1W") {
    value.setUTCDate(value.getUTCDate() - 7);
  } else if (range === "1M") {
    subtractUtcMonths(value, 1);
  } else if (range === "3M") {
    subtractUtcMonths(value, 3);
  } else {
    subtractUtcMonths(value, 12);
  }
  return value.toISOString();
}

function subtractUtcMonths(value: Date, months: number): void {
  const originalDay = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(originalDay, lastDay));
}

function observationsForRange(
  observations: readonly PreparedObservation[],
  range: HistoricalPortfolioTrendRange,
  now: string,
): RangeObservations {
  const start = historicalRangeStart(range, now);
  const nowInstant = rfc3339ToEpochNanoseconds(now, "historicalRange.now");
  const notFuture = observations.filter((value) => value.instant <= nowInstant);
  if (start === null) {
    return { values: notFuture, boundaryCoverageComplete: true };
  }
  const startInstant = rfc3339ToEpochNanoseconds(start, "historicalRange.start");
  const afterStart = notFuture.filter((value) => value.instant >= startInstant);
  const baseline = notFuture.findLast((value) => value.instant < startInstant);
  const baselineIsCloseEnoughToDisplay =
    baseline !== undefined &&
    startInstant - baseline.instant <= RANGE_PARTIAL_BASELINE_TOLERANCE;
  const values = baselineIsCloseEnoughToDisplay
    ? [baseline, ...afterStart]
    : afterStart;
  const first = values[0];
  const latest = values.at(-1);
  const startCovered =
    first !== undefined &&
    (first.instant >= startInstant
      ? first.instant - startInstant
      : startInstant - first.instant) <= RANGE_BOUNDARY_TOLERANCE;
  const endCovered =
    latest !== undefined &&
    nowInstant - latest.instant <= RANGE_BOUNDARY_TOLERANCE;
  return {
    values,
    boundaryCoverageComplete: startCovered && endCovered,
  };
}

function maximumGapNanoseconds(days: number): bigint {
  if (!Number.isSafeInteger(days) || days < 1 || days > 400) {
    throw new RangeError("maximumConnectedGapDays must be an integer from 1 to 400");
  }
  return BigInt(days) * NANOSECONDS_PER_DAY;
}

function intervalReturn(
  beginning: PreparedObservation,
  ending: PreparedObservation,
  flows: readonly PreparedFlow[],
): PreciseDecimal | null {
  const interval = ending.instant - beginning.instant;
  if (interval <= 0n) {
    return null;
  }
  let externalFlow = new Decimal(0);
  let weightedExternalFlow = new Decimal(0);
  for (const flow of flows) {
    if (flow.instant <= beginning.instant || flow.instant > ending.instant) {
      continue;
    }
    const remaining = ending.instant - flow.instant;
    const weight = new Decimal(remaining.toString()).div(interval.toString());
    externalFlow = externalFlow.add(flow.amountUsd);
    weightedExternalFlow = weightedExternalFlow.add(
      weight.mul(flow.amountUsd),
    );
  }
  const denominator = beginning.valueUsd.add(weightedExternalFlow);
  if (denominator.lte(0)) {
    return null;
  }
  return ending.valueUsd
    .sub(beginning.valueUsd)
    .sub(externalFlow)
    .div(denominator);
}

export function createHistoricalReturnSeries(
  input: CreateHistoricalReturnInput,
): HistoricalReturnResult {
  if (input.hasUnknownExternalFlow === true) {
    return unavailable(input.range, "UNKNOWN_EXTERNAL_FLOW");
  }
  if (input.observations.length === 0) {
    return unavailable(input.range, "NO_HISTORY");
  }
  const allObservations = prepareObservations(input.observations);
  const rangeObservations = observationsForRange(
    allObservations,
    input.range,
    input.now,
  );
  const observations = rangeObservations.values;
  if (observations.length === 0) {
    return unavailable(input.range, "NO_POINTS_IN_RANGE");
  }
  if (observations.length < 2) {
    return unavailable(input.range, "INSUFFICIENT_NAV");
  }
  const flows = prepareFlows(input.flows);
  const maximumGap = maximumGapNanoseconds(
    input.maximumConnectedGapDays ?? 40,
  );

  let segmentStart = observations[0];
  if (segmentStart === undefined) {
    return unavailable(input.range, "INSUFFICIENT_NAV");
  }
  let linkedFactor = new Decimal(1);
  let segmentCount = 1;
  let partial =
    !segmentStart.coverageComplete ||
    !rangeObservations.boundaryCoverageComplete;
  let anyValidInterval = false;
  let invalidDenominator = false;
  const points: HistoricalReturnPoint[] = [
    {
      sourceEventAt: segmentStart.observedAt,
      actualNav: canonicalDecimal(segmentStart.valueUsd),
      flowAdjustedChange: "0",
      returnRate: "0",
      connectFromPrevious: false,
    },
  ];

  for (let index = 1; index < observations.length; index += 1) {
    const beginning = observations[index - 1];
    const ending = observations[index];
    if (beginning === undefined || ending === undefined) {
      continue;
    }
    const coverageChanged =
      beginning.sourceCoverageKey !== ending.sourceCoverageKey ||
      beginning.sourceScopeCount !== ending.sourceScopeCount;
    const gap = ending.instant - beginning.instant > maximumGap;
    if (coverageChanged || gap) {
      partial = true;
      segmentCount += 1;
      segmentStart = ending;
      linkedFactor = new Decimal(1);
      points.push({
        sourceEventAt: ending.observedAt,
        actualNav: canonicalDecimal(ending.valueUsd),
        flowAdjustedChange: "0",
        returnRate: "0",
        connectFromPrevious: false,
      });
      continue;
    }
    const periodReturn = intervalReturn(beginning, ending, flows);
    if (periodReturn === null) {
      invalidDenominator = true;
      partial = true;
      segmentCount += 1;
      segmentStart = ending;
      linkedFactor = new Decimal(1);
      points.push({
        sourceEventAt: ending.observedAt,
        actualNav: canonicalDecimal(ending.valueUsd),
        flowAdjustedChange: "0",
        returnRate: "0",
        connectFromPrevious: false,
      });
      continue;
    }
    anyValidInterval = true;
    linkedFactor = linkedFactor.mul(periodReturn.add(1));
    const linkedReturn = linkedFactor.sub(1);
    points.push({
      sourceEventAt: ending.observedAt,
      actualNav: canonicalDecimal(ending.valueUsd),
      flowAdjustedChange: canonicalDecimal(segmentStart.valueUsd.mul(linkedReturn)),
      returnRate: canonicalDecimal(linkedReturn),
      connectFromPrevious: true,
    });
  }

  if (!anyValidInterval) {
    return unavailable(
      input.range,
      invalidDenominator
        ? "INVALID_DIETZ_DENOMINATOR"
        : "INSUFFICIENT_NAV",
    );
  }
  const latest = points.at(-1);
  const rangeIsComplete = !partial && segmentCount === 1 && latest !== undefined;
  return {
    status: rangeIsComplete ? "READY" : "PARTIAL",
    basis: "MODIFIED_DIETZ",
    range: input.range,
    rangeReturnRate: rangeIsComplete ? latest.returnRate : null,
    rangeFlowAdjustedChange: rangeIsComplete
      ? latest.flowAdjustedChange
      : null,
    points,
    segmentCount,
  };
}
