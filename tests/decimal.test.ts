import { describe, expect, it } from "vitest";

import {
  Decimal,
  DomainValidationError,
  canonicalDecimal,
  compareRfc3339,
  parsePositiveInput,
  roundForDisplay,
} from "../domain/index.ts";

describe("precise decimal boundary", () => {
  it("does not inherit JavaScript binary floating-point errors", () => {
    expect(canonicalDecimal(new Decimal("0.1").add("0.2"))).toBe("0.3");
  });

  it("rejects exponent notation and more than eight input decimals", () => {
    expect(() => parsePositiveInput("1e-8", "quantity")).toThrow(
      DomainValidationError,
    );
    expect(() => parsePositiveInput("0.123456789", "quantity")).toThrow(
      DomainValidationError,
    );
  });

  it("rounds display values half up without changing the source value", () => {
    const source = "106.86666667";
    expect(roundForDisplay(source, 2)).toBe("106.87");
    expect(source).toBe("106.86666667");
  });

  it("accepts harmless leading zeros and canonicalizes negative zero", () => {
    expect(canonicalDecimal(parsePositiveInput("001.2500", "quantity"))).toBe(
      "1.25",
    );
    expect(canonicalDecimal(new Decimal("-0"))).toBe("0");
  });

  it("orders RFC 3339 instants at nanosecond precision and across offsets", () => {
    expect(
      compareRfc3339(
        "2026-07-29T10:00:00.000000001-04:00",
        "2026-07-29T14:00:00.000000002Z",
      ),
    ).toBe(-1);
  });
});
