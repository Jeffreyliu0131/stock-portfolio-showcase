import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  createIbkrUsdCashAccount,
  estimateIbkrUsdCashInterest,
} from "../domain/index.ts";

function account(
  balance: string,
  netAssetValue: string,
  pricingPlan: "IBKR_PRO" | "IBKR_LITE" = "IBKR_PRO",
) {
  return {
    provider: "IBKR" as const,
    currency: "USD" as const,
    balance,
    netAssetValue,
    navSource: "USER_ENTERED" as const,
    pricingPlan,
  };
}

describe("IBKR USD cash interest estimate", () => {
  it("applies the interest-free tier and proportional NAV adjustment", () => {
    const estimate = estimateIbkrUsdCashInterest(
      account("20000", "80000"),
    );
    expect(estimate).toMatchObject({
        cashBalance: "20000",
        netAssetValue: "80000",
        pricingPlan: "IBKR_PRO",
        interestBearingBalance: "10000",
        publishedAnnualRate: "0.0313",
        navRateMultiplier: "0.8",
        navAdjustedAnnualRate: "0.02504",
        blendedAnnualRate: "0.01252",
        estimatedAnnualInterest: "250.4",
      });
    expect(
      new Decimal(estimate.estimatedMonthlyInterest).toFixed(2),
    ).toBe("20.87");
  });

  it("estimates no interest when the balance does not exceed USD 10,000", () => {
    expect(
      estimateIbkrUsdCashInterest(account("10000", "150000")),
    ).toMatchObject({
      interestBearingBalance: "0",
      navRateMultiplier: "1",
      navAdjustedAnnualRate: "0.0313",
      blendedAnnualRate: "0",
      estimatedAnnualInterest: "0",
      estimatedMonthlyInterest: "0",
    });
  });

  it("uses the full IBKR Lite tier rate at or above USD 100,000 NAV", () => {
    expect(
      estimateIbkrUsdCashInterest(
        account("20000", "100000", "IBKR_LITE"),
      ),
    ).toMatchObject({
      publishedAnnualRate: "0.0213",
      navRateMultiplier: "1",
      navAdjustedAnnualRate: "0.0213",
      blendedAnnualRate: "0.01065",
      estimatedAnnualInterest: "213",
      estimatedMonthlyInterest: "17.75",
    });
  });

  it("keeps decimal values canonical and rejects invalid cash records", () => {
    expect(
      createIbkrUsdCashAccount({
        ...account("20000.50000000", "20000.50000000"),
        navSource: "CASH_BALANCE_FALLBACK",
      }),
    ).toMatchObject({
      balance: "20000.5",
      netAssetValue: "20000.5",
      navSource: "CASH_BALANCE_FALLBACK",
    });

    expect(() =>
      createIbkrUsdCashAccount({
        ...account("20000", "80000"),
        navSource: "CASH_BALANCE_FALLBACK",
      }),
    ).toThrow(/must equal cash\.balance/);

    expect(() =>
      createIbkrUsdCashAccount(account("0", "80000")),
    ).toThrow(/cash\.balance must be greater than zero/);
    expect(() =>
      createIbkrUsdCashAccount(account("1.123456789", "80000")),
    ).toThrow();
  });
});
