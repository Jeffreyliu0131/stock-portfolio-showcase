import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  Decimal,
  aggregatePositionInputs,
  foldBrokerPosition,
  resolveQuote,
} from "../domain/index.ts";
import {
  AAPL,
  buyEntry,
  openingEntry,
  sellEntry,
  validQuote,
} from "./helpers.ts";

function fixedPoint(value: number, scale: number): string {
  const digits = Math.abs(value).toString().padStart(scale + 1, "0");
  const sign = value < 0 ? "-" : "";
  if (scale === 0) {
    return `${sign}${digits}`;
  }
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

describe("domain properties", () => {
  it("sums buy-only quantities and gross costs exactly", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            quantity: fc.integer({ min: 1, max: 1_000_000 }),
            price: fc.integer({ min: 1, max: 1_000_000 }),
            fee: fc.integer({ min: 0, max: 10_000 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (items) => {
          const entries = items.map((item, index) =>
            buyEntry({
              id: `buy-${index}`,
              quantity: fixedPoint(item.quantity, 4),
              unitPrice: fixedPoint(item.price, 4),
              fee: fixedPoint(item.fee, 4),
            }),
          );
          const position = foldBrokerPosition(entries);
          const expectedQuantity = items.reduce(
            (sum, item) => sum.add(fixedPoint(item.quantity, 4)),
            new Decimal(0),
          );
          const expectedCost = items.reduce(
            (sum, item) =>
              sum
                .add(
                  new Decimal(fixedPoint(item.quantity, 4)).mul(
                    fixedPoint(item.price, 4),
                  ),
                )
                .add(fixedPoint(item.fee, 4)),
            new Decimal(0),
          );

          expect(new Decimal(position.quantity).eq(expectedQuantity)).toBe(
            true,
          );
          expect(new Decimal(position.openCost).eq(expectedCost)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("keeps partial-sale average cost unchanged for exact input ratios", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (quantity, rawSell, averageCost) => {
          const sellQuantity = (rawSell % (quantity - 1)) + 1;
          const position = foldBrokerPosition([
            openingEntry({
              id: "opening",
              quantity: String(quantity),
              costInput: {
                mode: "TOTAL_COST",
                value: new Decimal(quantity).mul(averageCost).toFixed(),
              },
            }),
            sellEntry({
              id: "sell",
              effectiveAt: "2026-07-02T14:00:00Z",
              quantity: String(sellQuantity),
            }),
          ]);

          expect(position.averageCost).toBe(String(averageCost));
          expect(position.quantity).toBe(String(quantity - sellQuantity));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("makes SELL reference price and fee economically inert", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10_000 }),
        fc.integer({ min: 1, max: 9_999 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (quantity, rawSell, sellPrice, fee) => {
          const sellQuantity = (rawSell % (quantity - 1)) + 1;
          const opening = openingEntry({
            id: "opening",
            quantity: String(quantity),
            costInput: {
              mode: "AVERAGE_COST",
              value: "100.12345678",
            },
          });
          const common = {
            id: "sell",
            effectiveAt: "2026-07-02T14:00:00Z",
            quantity: String(sellQuantity),
          } as const;
          const withMetadata = foldBrokerPosition([
            opening,
            sellEntry({
              ...common,
              unitPrice: fixedPoint(sellPrice, 4),
              fee: fixedPoint(fee, 4),
            }),
          ]);
          const withoutMetadata = foldBrokerPosition([
            opening,
            sellEntry(common),
          ]);

          expect(withMetadata).toEqual(withoutMetadata);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("makes unified aggregation independent of traversal order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            quantity: fc.integer({ min: 1, max: 10_000 }),
            price: fc.integer({ min: 1, max: 100_000 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (items) => {
          const inputs = items.map((item, index) => ({
            id: `buy-${index}`,
            instrument: AAPL,
            quantity: fixedPoint(item.quantity, 2),
            costInput: {
              mode: "AVERAGE_COST" as const,
              value: fixedPoint(item.price, 2),
            },
          }));
          const forward = aggregatePositionInputs(inputs);
          const reverse = aggregatePositionInputs(
            [...inputs].reverse(),
          );
          expect(forward).toEqual(reverse);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("makes average-cost and total-open-cost inputs economically equivalent", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (quantity, averageCost) => {
          const quantityString = fixedPoint(quantity, 4);
          const averageCostString = fixedPoint(averageCost, 4);
          const totalOpenCost = new Decimal(quantityString)
            .mul(averageCostString)
            .toFixed();
          const [fromAverage] = aggregatePositionInputs([
            {
              id: "average-input",
              instrument: AAPL,
              quantity: quantityString,
              costInput: {
                mode: "AVERAGE_COST",
                value: averageCostString,
              },
            },
          ]);
          const [fromTotal] = aggregatePositionInputs([
            {
              id: "total-input",
              instrument: AAPL,
              quantity: quantityString,
              costInput: {
                mode: "TOTAL_OPEN_COST",
                value: totalOpenCost,
              },
            },
          ]);

          expect(fromAverage).toEqual(fromTotal);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("derives opening total cost from the unrounded average input", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (quantity, average) => {
          const quantityString = fixedPoint(quantity, 4);
          const averageString = fixedPoint(average, 4);
          const position = foldBrokerPosition([
            openingEntry({
              id: "opening",
              quantity: quantityString,
              costInput: {
                mode: "AVERAGE_COST",
                value: averageString,
              },
            }),
          ]);
          expect(
            new Decimal(position.openCost).eq(
              new Decimal(quantityString).mul(averageString),
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never creates zero price when any fetch status fails", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "FETCH_FAILED" as const,
          "RATE_LIMITED" as const,
          "UNAUTHORIZED" as const,
        ),
        fc.integer({ min: 1, max: 100_000_000 }),
        (fetchStatus, price) => {
          const priceString = fixedPoint(price, 4);
          const resolved = resolveQuote({
            requestedInstrument: AAPL,
            now: "2026-07-29T15:01:00Z",
            fetchStatus,
            marketSession: "REGULAR",
            lastValidQuote: validQuote({ price: priceString }),
          });
          expect(resolved.effectivePrice).toBe(priceString.replace(/\.?0+$/, ""));
          expect(resolved.effectivePrice).not.toBe("0");
        },
      ),
      { numRuns: 100 },
    );
  });
});
