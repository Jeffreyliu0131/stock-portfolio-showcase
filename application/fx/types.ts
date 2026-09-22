import {
  DomainValidationError,
  ageInNanoseconds,
  canonicalDecimal,
  compareRfc3339,
  parsePositiveInput,
  type DecimalString,
} from "../../domain/index.ts";

export const ALPACA_USD_CNY_RATE_PROVIDER = "alpaca";
export const ALPACA_USD_CNY_RATE_TYPE = "MIDPOINT";
export const ECB_USD_CNY_RATE_PROVIDER = "ecb";
export const ECB_USD_CNY_RATE_TYPE = "REFERENCE";
export const USD_CNY_CACHE_MAX_AGE_DAYS = 7;

interface UsdCnyRateBase {
  readonly baseCurrency: "USD";
  readonly quoteCurrency: "CNY";
  readonly rate: DecimalString;
  readonly sourceEventAt: string;
  readonly fetchedAt: string;
}

export type UsdCnyRate =
  | (UsdCnyRateBase & {
      readonly provider: typeof ALPACA_USD_CNY_RATE_PROVIDER;
      readonly rateType: typeof ALPACA_USD_CNY_RATE_TYPE;
    })
  | (UsdCnyRateBase & {
      readonly provider: typeof ECB_USD_CNY_RATE_PROVIDER;
      readonly rateType: typeof ECB_USD_CNY_RATE_TYPE;
      readonly referenceDate: string;
    });

type JsonObject = Readonly<Record<string, unknown>>;

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function normalizeUsdCnyRate(value: unknown): UsdCnyRate | null {
  if (!isJsonObject(value)) {
    return null;
  }
  if (
    value.baseCurrency !== "USD" ||
    value.quoteCurrency !== "CNY" ||
    typeof value.rate !== "string" ||
    typeof value.sourceEventAt !== "string" ||
    typeof value.fetchedAt !== "string"
  ) {
    return null;
  }

  const isAlpacaMidpoint =
    value.provider === ALPACA_USD_CNY_RATE_PROVIDER &&
    value.rateType === ALPACA_USD_CNY_RATE_TYPE;
  const isEcbReference =
    value.provider === ECB_USD_CNY_RATE_PROVIDER &&
    value.rateType === ECB_USD_CNY_RATE_TYPE &&
    typeof value.referenceDate === "string" &&
    isCalendarDate(value.referenceDate);
  if (!isAlpacaMidpoint && !isEcbReference) {
    return null;
  }

  try {
    const rate = canonicalDecimal(
      parsePositiveInput(value.rate, "usdCnyRate"),
    );
    if (compareRfc3339(value.sourceEventAt, value.fetchedAt) > 0) {
      return null;
    }
    const common = {
      baseCurrency: "USD" as const,
      quoteCurrency: "CNY" as const,
      rate,
      sourceEventAt: value.sourceEventAt,
      fetchedAt: value.fetchedAt,
    };
    return isAlpacaMidpoint
      ? {
          ...common,
          provider: ALPACA_USD_CNY_RATE_PROVIDER,
          rateType: ALPACA_USD_CNY_RATE_TYPE,
        }
      : {
          ...common,
          provider: ECB_USD_CNY_RATE_PROVIDER,
          rateType: ECB_USD_CNY_RATE_TYPE,
          referenceDate: value.referenceDate as string,
        };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }
}

export function isUsdCnyRateUsable(
  rate: UsdCnyRate,
  now: string,
  maxAgeDays = USD_CNY_CACHE_MAX_AGE_DAYS,
): boolean {
  if (!Number.isSafeInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new RangeError("maxAgeDays must be a non-negative integer");
  }
  try {
    const age = ageInNanoseconds(now, rate.sourceEventAt);
    const maximumAge =
      BigInt(maxAgeDays) * 24n * 60n * 60n * 1_000_000_000n;
    return age >= 0n && age <= maximumAge;
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return false;
    }
    throw error;
  }
}
