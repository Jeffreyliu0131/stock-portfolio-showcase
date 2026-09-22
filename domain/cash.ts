import {
  Decimal,
  canonicalDecimal,
  parseDecimal,
  type DecimalString,
} from "./decimal.ts";
import { failDomain } from "./errors.ts";

export type IbkrPricingPlan = "IBKR_PRO" | "IBKR_LITE";

export interface IbkrUsdCashAccount {
  readonly provider: "IBKR";
  readonly currency: "USD";
  readonly balance: DecimalString;
  readonly netAssetValue: DecimalString;
  readonly navSource: "USER_ENTERED" | "CASH_BALANCE_FALLBACK";
  readonly pricingPlan: IbkrPricingPlan;
}

export interface IbkrUsdInterestPolicy {
  readonly currency: "USD";
  readonly interestFreeBalance: DecimalString;
  readonly fullRateNavThreshold: DecimalString;
  readonly proAnnualRate: DecimalString;
  readonly liteAnnualRate: DecimalString;
  readonly source: "Interactive Brokers";
  readonly sourceUrl: string;
  readonly verifiedAt: string;
}

export interface IbkrUsdCashInterestEstimate {
  readonly cashBalance: DecimalString;
  readonly netAssetValue: DecimalString;
  readonly pricingPlan: IbkrPricingPlan;
  readonly interestBearingBalance: DecimalString;
  readonly publishedAnnualRate: DecimalString;
  readonly navRateMultiplier: DecimalString;
  readonly navAdjustedAnnualRate: DecimalString;
  readonly blendedAnnualRate: DecimalString;
  readonly estimatedAnnualInterest: DecimalString;
  readonly estimatedMonthlyInterest: DecimalString;
}

/**
 * IBKR direct-client USD credit-interest terms verified on 2026-08-02.
 * Rates can change; the UI always displays the verification date and source.
 */
export const IBKR_USD_INTEREST_POLICY: IbkrUsdInterestPolicy = {
  currency: "USD",
  interestFreeBalance: "10000",
  fullRateNavThreshold: "100000",
  proAnnualRate: "0.0313",
  liteAnnualRate: "0.0213",
  source: "Interactive Brokers",
  sourceUrl:
    "https://www.interactivebrokers.com/en/accounts/fees/pricing-interest-rates.php",
  verifiedAt: "2026-08-02",
};

function positiveCashDecimal(
  value: DecimalString,
  field: string,
) {
  const parsed = parseDecimal(value, {
    field,
    maxFractionalDigits: 8,
  });
  if (parsed.lte(0)) {
    failDomain({
      code: "INVALID_COST",
      field,
      message: `${field} must be greater than zero`,
    });
  }
  return parsed;
}

export function createIbkrUsdCashAccount(
  input: IbkrUsdCashAccount,
): IbkrUsdCashAccount {
  if (input.provider !== "IBKR") {
    failDomain({
      code: "INVALID_ENTRY",
      field: "cash.provider",
      message: "cash.provider must be IBKR",
    });
  }
  if (input.currency !== "USD") {
    failDomain({
      code: "INVALID_ENTRY",
      field: "cash.currency",
      message: "cash.currency must be USD",
    });
  }
  if (
    input.pricingPlan !== "IBKR_PRO" &&
    input.pricingPlan !== "IBKR_LITE"
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "cash.pricingPlan",
      message: "cash.pricingPlan must be IBKR_PRO or IBKR_LITE",
    });
  }
  if (
    input.navSource !== "USER_ENTERED" &&
    input.navSource !== "CASH_BALANCE_FALLBACK"
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "cash.navSource",
      message:
        "cash.navSource must be USER_ENTERED or CASH_BALANCE_FALLBACK",
    });
  }

  const balance = positiveCashDecimal(input.balance, "cash.balance");
  const netAssetValue = positiveCashDecimal(
    input.netAssetValue,
    "cash.netAssetValue",
  );
  if (
    input.navSource === "CASH_BALANCE_FALLBACK" &&
    !netAssetValue.eq(balance)
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "cash.netAssetValue",
      message:
        "cash.netAssetValue must equal cash.balance when NAV uses the cash-balance fallback",
    });
  }

  return {
    provider: "IBKR",
    currency: "USD",
    balance: canonicalDecimal(balance),
    netAssetValue: canonicalDecimal(netAssetValue),
    navSource: input.navSource,
    pricingPlan: input.pricingPlan,
  };
}

export function estimateIbkrUsdCashInterest(
  accountInput: IbkrUsdCashAccount,
  policy: IbkrUsdInterestPolicy = IBKR_USD_INTEREST_POLICY,
): IbkrUsdCashInterestEstimate {
  const account = createIbkrUsdCashAccount(accountInput);
  const balance = positiveCashDecimal(account.balance, "cash.balance");
  const netAssetValue = positiveCashDecimal(
    account.netAssetValue,
    "cash.netAssetValue",
  );
  const interestFreeBalance = positiveCashDecimal(
    policy.interestFreeBalance,
    "cashInterestPolicy.interestFreeBalance",
  );
  const fullRateNavThreshold = positiveCashDecimal(
    policy.fullRateNavThreshold,
    "cashInterestPolicy.fullRateNavThreshold",
  );
  const publishedAnnualRate = positiveCashDecimal(
    account.pricingPlan === "IBKR_PRO"
      ? policy.proAnnualRate
      : policy.liteAnnualRate,
    "cashInterestPolicy.publishedAnnualRate",
  );
  const navRateMultiplier = Decimal.min(
    netAssetValue.div(fullRateNavThreshold),
    new Decimal(1),
  );
  const interestBearingBalance = Decimal.max(
    balance.sub(interestFreeBalance),
    new Decimal(0),
  );
  const navAdjustedAnnualRate = publishedAnnualRate.mul(
    navRateMultiplier,
  );
  const estimatedAnnualInterest = interestBearingBalance.mul(
    navAdjustedAnnualRate,
  );
  const blendedAnnualRate = estimatedAnnualInterest.div(balance);

  return {
    cashBalance: canonicalDecimal(balance),
    netAssetValue: canonicalDecimal(netAssetValue),
    pricingPlan: account.pricingPlan,
    interestBearingBalance: canonicalDecimal(interestBearingBalance),
    publishedAnnualRate: canonicalDecimal(publishedAnnualRate),
    navRateMultiplier: canonicalDecimal(navRateMultiplier),
    navAdjustedAnnualRate: canonicalDecimal(navAdjustedAnnualRate),
    blendedAnnualRate: canonicalDecimal(blendedAnnualRate),
    estimatedAnnualInterest: canonicalDecimal(estimatedAnnualInterest),
    estimatedMonthlyInterest: canonicalDecimal(
      estimatedAnnualInterest.div(12),
    ),
  };
}
