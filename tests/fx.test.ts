import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  Decimal,
  DomainValidationError,
  deriveCnyAmount,
} from "../domain/index.ts";
import { goldenFixture } from "./fixtures/golden.ts";

describe("USD/CNY derived display boundary", () => {
  it("passes G-010 without changing the USD source amount", () => {
    const input = goldenFixture.cases.G010;
    const result = deriveCnyAmount(input.usdAmount, input.usdCnyRate);

    expect(result).toEqual({
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      usdAmount: input.usdAmount,
      usdCnyRate: "7.2",
      cnyAmount: input.expectedCnyAmount,
      calculationVersion: goldenFixture.fxCalculationVersion,
    });
  });

  it("uses the unrounded USD amount and supports negative PnL", () => {
    expect(deriveCnyAmount("1.005", "7.2").cnyAmount).toBe("7.236");
    expect(deriveCnyAmount("-12.34", "7.2").cnyAmount).toBe("-88.848");
  });

  it("allows a zero USD amount but rejects invalid rates", () => {
    expect(deriveCnyAmount("0", "7.2").cnyAmount).toBe("0");

    for (const invalidRate of ["0", "-1", "7.123456789", "1e1"]) {
      expect(() => deriveCnyAmount("100", invalidRate)).toThrow(
        DomainValidationError,
      );
    }
  });

  it("equals the exact decimal product for arbitrary valid inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        (amount, rate) => {
          const amountString = new Decimal(amount).div("10000").toFixed(4);
          const rateString = new Decimal(rate).div("100000000").toFixed(8);
          const result = deriveCnyAmount(amountString, rateString);

          expect(
            new Decimal(result.cnyAmount).eq(
              new Decimal(amountString).mul(rateString),
            ),
          ).toBe(true);
          expect(new Decimal(result.usdAmount).eq(amountString)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
