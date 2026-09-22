import {
  Decimal,
  canonicalDecimal,
  parseNonNegativeInput,
  parsePositiveInput,
  type DecimalString,
  type PreciseDecimal,
} from "./decimal.ts";
import { failDomain } from "./errors.ts";
import {
  createInstrumentKey,
  instrumentKeyId,
  type InstrumentKey,
} from "./instrument.ts";
import {
  compareRfc3339,
  rfc3339ToEpochNanoseconds,
} from "./time.ts";

export interface PortfolioTrendPositionInput {
  readonly instrument: InstrumentKey;
  readonly quantity: DecimalString;
  readonly previousRegularClose: DecimalString | null;
}

/**
 * Domain-owned structural input. The market-data API type is intentionally
 * compatible without making the domain layer depend on application code.
 */
export interface PortfolioTrendBarInput {
  readonly close: DecimalString;
  readonly sourceEventAt: string;
  readonly priceType: "MINUTE_BAR_CLOSE";
}

export interface PortfolioTrendBarSeriesInput {
  readonly instrument: InstrumentKey;
  readonly status: "OK" | "NO_DATA" | "FAILED";
  readonly bars: readonly PortfolioTrendBarInput[];
}

export interface PortfolioTrendOvernightPrice {
  readonly instrument: InstrumentKey;
  readonly price: DecimalString;
}

export interface PortfolioTrendOvernightPointInput {
  readonly sourceEventAt: string;
  readonly prices: readonly PortfolioTrendOvernightPrice[];
}

export interface PortfolioTrendInput {
  readonly positions: readonly PortfolioTrendPositionInput[];
  readonly series: readonly PortfolioTrendBarSeriesInput[];
  readonly cashBalance: DecimalString;
  readonly overnightPoint?: PortfolioTrendOvernightPointInput;
}

export interface PortfolioTrendPoint {
  readonly sourceEventAt: string;
  readonly estimatedDailyPriceEffect: DecimalString;
  readonly estimatedDailyChangeRate: DecimalString;
  readonly estimatedAsset: DecimalString;
  readonly segment: "SIP_HISTORY" | "OVERNIGHT_CURRENT";
  readonly connectFromPrevious: boolean;
}

export type PortfolioTrendUnavailableReason =
  | "NO_POSITIONS"
  | "MISSING_REFERENCE_CLOSE"
  | "MISSING_SERIES"
  | "INSUFFICIENT_POINTS";

export type PortfolioTrendResult =
  | {
      readonly status: "READY";
      readonly referenceValue: DecimalString;
      readonly points: readonly PortfolioTrendPoint[];
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: PortfolioTrendUnavailableReason;
      readonly points: readonly [];
    };

interface PreparedPosition {
  readonly instrument: InstrumentKey;
  readonly key: string;
  readonly quantity: PreciseDecimal;
  readonly previousRegularClose: PreciseDecimal;
}

function unavailable(
  reason: PortfolioTrendUnavailableReason,
): PortfolioTrendResult {
  return { status: "UNAVAILABLE", reason, points: [] };
}

function preparedPositions(
  values: readonly PortfolioTrendPositionInput[],
): readonly PreparedPosition[] | PortfolioTrendResult {
  if (values.length === 0) {
    return unavailable("NO_POSITIONS");
  }
  const seen = new Set<string>();
  const positions: PreparedPosition[] = [];
  for (const value of values) {
    const instrument = createInstrumentKey(value.instrument);
    const key = instrumentKeyId(instrument);
    if (seen.has(key)) {
      failDomain({
        code: "INVALID_ENTRY",
        field: "portfolioTrend.positions",
        message: "portfolio trend contains a duplicate instrument",
      });
    }
    seen.add(key);
    if (value.previousRegularClose === null) {
      return unavailable("MISSING_REFERENCE_CLOSE");
    }
    positions.push({
      instrument,
      key,
      quantity: parsePositiveInput(
        value.quantity,
        "portfolioTrend.position.quantity",
      ),
      previousRegularClose: parsePositiveInput(
        value.previousRegularClose,
        "portfolioTrend.position.previousRegularClose",
      ),
    });
  }
  return positions;
}

function isPreparedPositions(
  value: readonly PreparedPosition[] | PortfolioTrendResult,
): value is readonly PreparedPosition[] {
  return Array.isArray(value);
}

function seriesByInstrument(
  values: readonly PortfolioTrendBarSeriesInput[],
): ReadonlyMap<string, PortfolioTrendBarSeriesInput> {
  const result = new Map<string, PortfolioTrendBarSeriesInput>();
  for (const value of values) {
    const key = instrumentKeyId(value.instrument);
    if (result.has(key)) {
      failDomain({
        code: "INVALID_ENTRY",
        field: "portfolioTrend.series",
        message: "portfolio trend contains duplicate bar series",
      });
    }
    result.set(key, value);
  }
  return result;
}

function validateTimestamp(value: string, field: string): void {
  rfc3339ToEpochNanoseconds(value, field);
}

function historicalEvents(
  positions: readonly PreparedPosition[],
  values: readonly PortfolioTrendBarSeriesInput[],
): ReadonlyMap<string, ReadonlyMap<string, PreciseDecimal>> | null {
  const indexedSeries = seriesByInstrument(values);
  const events = new Map<string, Map<string, PreciseDecimal>>();
  for (const position of positions) {
    const series = indexedSeries.get(position.key);
    if (series === undefined || series.status === "FAILED") {
      return null;
    }
    let previousTimestamp: string | null = null;
    for (const bar of series.bars) {
      validateTimestamp(
        bar.sourceEventAt,
        "portfolioTrend.bar.sourceEventAt",
      );
      if (
        previousTimestamp !== null &&
        compareRfc3339(previousTimestamp, bar.sourceEventAt) >= 0
      ) {
        failDomain({
          code: "INVALID_TIMESTAMP",
          field: "portfolioTrend.bar.sourceEventAt",
          message: "portfolio trend bars must be strictly increasing",
        });
      }
      previousTimestamp = bar.sourceEventAt;
      const atTimestamp = events.get(bar.sourceEventAt) ?? new Map();
      atTimestamp.set(
        position.key,
        parsePositiveInput(bar.close, "portfolioTrend.bar.close"),
      );
      events.set(bar.sourceEventAt, atTimestamp);
    }
  }
  return events;
}

function pointFromPrices(
  sourceEventAt: string,
  positions: readonly PreparedPosition[],
  prices: ReadonlyMap<string, PreciseDecimal>,
  cashBalance: PreciseDecimal,
  referenceValue: PreciseDecimal,
  segment: PortfolioTrendPoint["segment"],
  connectFromPrevious: boolean,
): PortfolioTrendPoint {
  let effect = new Decimal("0");
  let stockValue = new Decimal("0");
  for (const position of positions) {
    const price = prices.get(position.key);
    if (price === undefined) {
      failDomain({
        code: "INVALID_PRICE",
        field: "portfolioTrend.price",
        message: "portfolio trend point is missing a position price",
      });
    }
    effect = effect.add(
      position.quantity.mul(price.sub(position.previousRegularClose)),
    );
    stockValue = stockValue.add(position.quantity.mul(price));
  }
  return {
    sourceEventAt,
    estimatedDailyPriceEffect: canonicalDecimal(effect),
    estimatedDailyChangeRate: canonicalDecimal(
      effect.div(referenceValue),
    ),
    estimatedAsset: canonicalDecimal(stockValue.add(cashBalance)),
    segment,
    connectFromPrevious,
  };
}

function overnightPrices(
  value: PortfolioTrendOvernightPointInput,
  positions: readonly PreparedPosition[],
): ReadonlyMap<string, PreciseDecimal> | null {
  validateTimestamp(
    value.sourceEventAt,
    "portfolioTrend.overnightPoint.sourceEventAt",
  );
  const expectedKeys = new Set(positions.map((position) => position.key));
  const result = new Map<string, PreciseDecimal>();
  for (const item of value.prices) {
    const key = instrumentKeyId(item.instrument);
    if (result.has(key)) {
      failDomain({
        code: "INVALID_ENTRY",
        field: "portfolioTrend.overnightPoint.prices",
        message: "overnight point contains a duplicate instrument",
      });
    }
    if (!expectedKeys.has(key)) {
      continue;
    }
    result.set(
      key,
      parsePositiveInput(item.price, "portfolioTrend.overnightPoint.price"),
    );
  }
  return result.size === positions.length ? result : null;
}

export function createPortfolioTrend(
  input: PortfolioTrendInput,
): PortfolioTrendResult {
  const positionsOrUnavailable = preparedPositions(input.positions);
  if (!isPreparedPositions(positionsOrUnavailable)) {
    return positionsOrUnavailable;
  }
  const positions = positionsOrUnavailable;
  const cashBalance = parseNonNegativeInput(
    input.cashBalance,
    "portfolioTrend.cashBalance",
  );
  let referenceValue = new Decimal("0");
  const lastPrices = new Map<string, PreciseDecimal>();
  for (const position of positions) {
    referenceValue = referenceValue.add(
      position.quantity.mul(position.previousRegularClose),
    );
    lastPrices.set(position.key, position.previousRegularClose);
  }

  const events = historicalEvents(positions, input.series);
  if (events === null) {
    return unavailable("MISSING_SERIES");
  }
  const timestamps = [...events.keys()].sort(compareRfc3339);
  const points: PortfolioTrendPoint[] = [];
  for (const timestamp of timestamps) {
    const changes = events.get(timestamp);
    if (changes === undefined) {
      continue;
    }
    for (const [key, price] of changes) {
      lastPrices.set(key, price);
    }
    points.push(
      pointFromPrices(
        timestamp,
        positions,
        lastPrices,
        cashBalance,
        referenceValue,
        "SIP_HISTORY",
        points.length > 0,
      ),
    );
  }

  if (input.overnightPoint !== undefined) {
    const prices = overnightPrices(input.overnightPoint, positions);
    const lastTimestamp = points.at(-1)?.sourceEventAt;
    if (
      prices !== null &&
      (lastTimestamp === undefined ||
        compareRfc3339(input.overnightPoint.sourceEventAt, lastTimestamp) > 0)
    ) {
      points.push(
        pointFromPrices(
          input.overnightPoint.sourceEventAt,
          positions,
          prices,
          cashBalance,
          referenceValue,
          "OVERNIGHT_CURRENT",
          false,
        ),
      );
    }
  }

  if (points.length === 0) {
    return unavailable("INSUFFICIENT_POINTS");
  }
  return {
    status: "READY",
    referenceValue: canonicalDecimal(referenceValue),
    points,
  };
}
