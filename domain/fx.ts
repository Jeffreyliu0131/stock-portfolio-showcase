import {
  canonicalDecimal,
  parseDecimal,
  type DecimalString,
} from "./decimal.ts";
import { failDomain } from "./errors.ts";
import { FX_CALCULATION_VERSION } from "./version.ts";

export interface UsdCnyDerivedAmount {
  readonly baseCurrency: "USD";
  readonly quoteCurrency: "CNY";
  readonly usdAmount: DecimalString;
  readonly usdCnyRate: DecimalString;
  readonly cnyAmount: DecimalString;
  readonly calculationVersion: typeof FX_CALCULATION_VERSION;
}

export function deriveCnyAmount(
  usdAmount: DecimalString,
  usdCnyRate: DecimalString,
): UsdCnyDerivedAmount {
  const amount = parseDecimal(usdAmount, { field: "usdAmount" });
  const rate = parseDecimal(usdCnyRate, {
    field: "usdCnyRate",
    maxFractionalDigits: 8,
  });
  if (rate.lte(0)) {
    failDomain({
      code: "INVALID_RATE",
      field: "usdCnyRate",
      message: "usdCnyRate must be greater than zero",
    });
  }

  return {
    baseCurrency: "USD",
    quoteCurrency: "CNY",
    usdAmount: canonicalDecimal(amount),
    usdCnyRate: canonicalDecimal(rate),
    cnyAmount: canonicalDecimal(amount.mul(rate)),
    calculationVersion: FX_CALCULATION_VERSION,
  };
}
