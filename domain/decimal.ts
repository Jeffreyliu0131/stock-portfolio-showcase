import DecimalJs from "decimal.js";

import { failDomain } from "./errors.ts";

export type DecimalString = string;
export type PreciseDecimal = DecimalJs;

export const Decimal = DecimalJs.clone({
  precision: 80,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

const PLAIN_DECIMAL = /^-?\d+(?:\.(\d+))?$/;

interface ParseDecimalOptions {
  readonly field: string;
  readonly maxFractionalDigits?: number;
}

export function parseDecimal(
  value: DecimalString,
  options: ParseDecimalOptions,
): PreciseDecimal {
  const match = PLAIN_DECIMAL.exec(value);
  if (match === null) {
    failDomain({
      code: "INVALID_DECIMAL",
      field: options.field,
      message: `${options.field} must be a plain finite decimal string`,
    });
  }

  const fractionalDigits = match[1]?.length ?? 0;
  if (
    options.maxFractionalDigits !== undefined &&
    fractionalDigits > options.maxFractionalDigits
  ) {
    failDomain({
      code: "DECIMAL_SCALE_EXCEEDED",
      field: options.field,
      message: `${options.field} supports at most ${options.maxFractionalDigits} fractional digits`,
    });
  }

  return new Decimal(value);
}

export function parsePositiveInput(
  value: DecimalString,
  field: string,
): PreciseDecimal {
  const parsed = parseDecimal(value, { field, maxFractionalDigits: 8 });
  if (parsed.lte(0)) {
    failDomain({
      code: field.includes("quantity")
        ? "INVALID_QUANTITY"
        : "INVALID_PRICE",
      field,
      message: `${field} must be greater than zero`,
    });
  }
  return parsed;
}

export function parseNonNegativeInput(
  value: DecimalString,
  field: string,
  issueCode:
    | "INVALID_COST"
    | "INVALID_FEE"
    | "INVALID_QUANTITY" = field.includes("quantity")
    ? "INVALID_QUANTITY"
    : "INVALID_COST",
): PreciseDecimal {
  const parsed = parseDecimal(value, { field, maxFractionalDigits: 8 });
  if (parsed.lt(0)) {
    failDomain({
      code: issueCode,
      field,
      message: `${field} must be greater than or equal to zero`,
    });
  }
  return parsed;
}

export function canonicalDecimal(value: PreciseDecimal): DecimalString {
  if (value.isZero()) {
    return "0";
  }

  const fixed = value.toFixed();
  if (!fixed.includes(".")) {
    return fixed;
  }
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

export function roundForDisplay(
  value: DecimalString,
  fractionalDigits = 2,
): string {
  if (!Number.isSafeInteger(fractionalDigits) || fractionalDigits < 0) {
    throw new RangeError("fractionalDigits must be a non-negative integer");
  }
  return parseDecimal(value, { field: "value" }).toFixed(
    fractionalDigits,
    DecimalJs.ROUND_HALF_UP,
  );
}
