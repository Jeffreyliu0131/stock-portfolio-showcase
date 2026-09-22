import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  calculateBrokerPositions,
  foldBrokerPosition,
  resolveEffectiveLedgerEntries,
} from "../domain/index.ts";
import { goldenFixture } from "./fixtures/golden.ts";
import {
  AAPL,
  buyEntry,
  openingEntry,
  reconciliationEntry,
  sellEntry,
} from "./helpers.ts";

const golden = goldenFixture.cases;

function expectIssue(
  run: () => unknown,
  code: DomainValidationError["issues"][number]["code"],
): void {
  try {
    run();
    throw new Error("expected a DomainValidationError");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).issues[0]?.code).toBe(code);
  }
}

describe("broker ledger fold", () => {
  it("passes G-001 single-broker buy", () => {
    const input = golden.G001;
    const position = foldBrokerPosition([
      buyEntry({
        id: "buy-1",
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        fee: input.fee,
      }),
    ]);

    expect(position.quantity).toBe(input.quantity);
    expect(position.openCost).toBe(input.expectedOpenCost);
    expect(position.averageCost).toBe(input.expectedAverageCost);
  });

  it("passes G-003 fractional shares without truncation", () => {
    const input = golden.G003;
    const position = foldBrokerPosition([
      buyEntry({
        id: "buy-fractional",
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        fee: input.fee,
      }),
    ]);

    expect(position.quantity).toBe(input.quantity);
    expect(position.openCost).toBe(input.expectedOpenCost);
    expect(position.averageCost).toBe(input.expectedAverageCost);
  });

  it("passes G-007 and ignores optional sell price and fee", () => {
    const input = golden.G007;
    const opening = openingEntry({
      id: "opening",
      quantity: input.openingQuantity,
      costInput: { mode: "TOTAL_COST", value: input.openingCost },
    });
    const withMetadata = foldBrokerPosition([
      opening,
      sellEntry({
        id: "sell",
        effectiveAt: "2026-07-02T14:00:00Z",
        createdAt: "2026-07-02T14:00:01Z",
        quantity: input.sellQuantity,
        unitPrice: "130",
        fee: "0.50",
      }),
    ]);
    const withoutMetadata = foldBrokerPosition([
      opening,
      sellEntry({
        id: "sell",
        effectiveAt: "2026-07-02T14:00:00Z",
        createdAt: "2026-07-02T14:00:01Z",
        quantity: input.sellQuantity,
      }),
    ]);

    expect(withMetadata.quantity).toBe(input.expectedQuantity);
    expect(withMetadata.openCost).toBe(input.expectedOpenCost);
    expect(withMetadata.averageCost).toBe(input.expectedAverageCost);
    expect(withMetadata).toEqual(withoutMetadata);
    expect(withMetadata).not.toHaveProperty("realizedPnl");
  });

  it("sets quantity and cost to zero after a full sale", () => {
    const position = foldBrokerPosition([
      openingEntry({
        id: "opening",
        quantity: "2.5",
        costInput: { mode: "TOTAL_COST", value: "250" },
      }),
      sellEntry({
        id: "sell-all",
        effectiveAt: "2026-07-02T14:00:00Z",
        quantity: "2.5",
      }),
    ]);

    expect(position.quantity).toBe("0");
    expect(position.openCost).toBe("0");
    expect(position.averageCost).toBeNull();
  });

  it("passes G-008 reconciliation as an atomic checkpoint", () => {
    const input = golden.G008;
    const position = foldBrokerPosition([
      openingEntry({
        id: "opening",
        quantity: input.initialQuantity,
        costInput: { mode: "TOTAL_COST", value: input.initialCost },
      }),
      reconciliationEntry({
        id: "reconcile",
        effectiveAt: "2026-07-02T14:00:00Z",
        quantity: input.reconciledQuantity,
        costInput: { mode: "TOTAL_COST", value: input.reconciledCost },
        reason: "match synthetic broker fixture",
      }),
      buyEntry({
        id: "buy-after-reconcile",
        effectiveAt: "2026-07-03T14:00:00Z",
        quantity: input.buyQuantity,
        unitPrice: input.buyUnitPrice,
        fee: "0",
      }),
    ]);

    expect(position.quantity).toBe(input.expectedQuantity);
    expect(position.openCost).toBe(input.expectedOpenCost);
    expect(position.averageCost).toBe(input.expectedAverageCost);
    expect(position.appliedEntryIds).toEqual([
      "opening",
      "reconcile",
      "buy-after-reconcile",
    ]);
  });

  it("passes G-009 using the unrounded reported average cost", () => {
    const input = golden.G009;
    const position = foldBrokerPosition([
      openingEntry({
        id: "opening-average",
        quantity: input.quantity,
        costInput: {
          mode: "AVERAGE_COST",
          value: input.reportedAverageCost,
        },
      }),
    ]);

    expect(position.openCost).toBe(input.expectedOpenCost);
    expect(position.averageCost).toBe(input.reportedAverageCost);
  });

  it("rejects a sale that would create a negative position", () => {
    expectIssue(
      () =>
        foldBrokerPosition([
          openingEntry({
            id: "opening",
            quantity: "12.5",
            costInput: { mode: "TOTAL_COST", value: "1250" },
          }),
          sellEntry({
            id: "oversell",
            effectiveAt: "2026-07-02T14:00:00Z",
            quantity: "12.50000001",
          }),
        ]),
      "NEGATIVE_POSITION",
    );
  });

  it("rejects zero quantities and negative fees at the domain boundary", () => {
    expectIssue(
      () =>
        foldBrokerPosition([
          buyEntry({
            id: "zero-buy",
            quantity: "0",
            unitPrice: "100",
          }),
        ]),
      "INVALID_QUANTITY",
    );
    expectIssue(
      () =>
        foldBrokerPosition([
          buyEntry({
            id: "negative-fee",
            quantity: "1",
            unitPrice: "100",
            fee: "-0.01",
          }),
        ]),
      "INVALID_FEE",
    );
  });

  it("allows 18 decimal places for total cost but only 8 for average cost", () => {
    expect(
      foldBrokerPosition([
        openingEntry({
          id: "precise-total",
          quantity: "1",
          costInput: {
            mode: "TOTAL_COST",
            value: "1.123456789012345678",
          },
        }),
      ]).openCost,
    ).toBe("1.123456789012345678");

    expectIssue(
      () =>
        foldBrokerPosition([
          openingEntry({
            id: "over-precise-average",
            quantity: "1",
            costInput: {
              mode: "AVERAGE_COST",
              value: "1.123456789",
            },
          }),
        ]),
      "DECIMAL_SCALE_EXCEEDED",
    );

    expect(
      foldBrokerPosition([
        openingEntry({
          id: "negative-zero-cost",
          quantity: "1",
          costInput: { mode: "TOTAL_COST", value: "-0" },
        }),
      ]).openCost,
    ).toBe("0");
  });

  it("requires a zero reconciliation to use TOTAL_COST 0", () => {
    const closed = foldBrokerPosition([
      reconciliationEntry({
        id: "close-by-reconciliation",
        quantity: "0",
        costInput: { mode: "TOTAL_COST", value: "0" },
        reason: "synthetic account is empty",
      }),
    ]);
    expect(closed.quantity).toBe("0");
    expect(closed.openCost).toBe("0");

    expectIssue(
      () =>
        foldBrokerPosition([
          reconciliationEntry({
            id: "invalid-zero-average",
            quantity: "0",
            costInput: { mode: "AVERAGE_COST", value: "0" },
            reason: "invalid synthetic input",
          }),
        ]),
      "ZERO_QUANTITY_REQUIRES_ZERO_COST",
    );
  });

  it("rejects a second effective opening and ordinary records at its cutover", () => {
    expectIssue(
      () =>
        foldBrokerPosition([
          openingEntry({
            id: "opening-1",
            quantity: "1",
            costInput: { mode: "TOTAL_COST", value: "100" },
          }),
          openingEntry({
            id: "opening-2",
            effectiveAt: "2026-07-02T14:00:00Z",
            quantity: "1",
            costInput: { mode: "TOTAL_COST", value: "100" },
          }),
        ]),
      "MULTIPLE_OPENING_POSITIONS",
    );

    expectIssue(
      () =>
        foldBrokerPosition([
          buyEntry({
            id: "duplicate-history",
            quantity: "1",
            unitPrice: "90",
          }),
          openingEntry({
            id: "opening",
            quantity: "1",
            costInput: { mode: "TOTAL_COST", value: "100" },
          }),
        ]),
      "ENTRY_AT_OR_BEFORE_OPENING",
    );
  });

  it("uses effective correction leaves while retaining the old records for audit", () => {
    const original = buyEntry({
      id: "buy-original",
      quantity: "1",
      unitPrice: "100",
    });
    const corrected = buyEntry({
      id: "buy-corrected",
      quantity: "2",
      unitPrice: "100",
      supersedesEntryId: original.id,
      reason: "correct synthetic quantity",
    });

    expect(resolveEffectiveLedgerEntries([original, corrected])).toEqual([
      corrected,
    ]);
    expect(foldBrokerPosition([original, corrected]).quantity).toBe("2");
  });

  it("rejects correction forks, cycles, and cross-broker corrections", () => {
    const original = buyEntry({
      id: "original",
      quantity: "1",
      unitPrice: "100",
    });
    const correctionA = buyEntry({
      id: "correction-a",
      quantity: "2",
      unitPrice: "100",
      supersedesEntryId: original.id,
      reason: "first correction",
    });
    const correctionB = buyEntry({
      id: "correction-b",
      quantity: "3",
      unitPrice: "100",
      supersedesEntryId: original.id,
      reason: "second correction",
    });
    expectIssue(
      () =>
        resolveEffectiveLedgerEntries([
          original,
          correctionA,
          correctionB,
        ]),
      "SUPERSEDE_FORK",
    );

    const cycleA = buyEntry({
      id: "cycle-a",
      quantity: "1",
      unitPrice: "100",
      supersedesEntryId: "cycle-b",
      reason: "cycle",
    });
    const cycleB = buyEntry({
      id: "cycle-b",
      quantity: "1",
      unitPrice: "100",
      supersedesEntryId: "cycle-a",
      reason: "cycle",
    });
    expectIssue(
      () => resolveEffectiveLedgerEntries([cycleA, cycleB]),
      "SUPERSEDE_CYCLE",
    );

    const crossBroker = buyEntry({
      id: "cross-broker",
      brokerAccountId: "broker-b",
      quantity: "1",
      unitPrice: "100",
      supersedesEntryId: original.id,
      reason: "invalid cross-broker correction",
    });
    expectIssue(
      () => resolveEffectiveLedgerEntries([original, crossBroker]),
      "SUPERSEDE_GROUP_MISMATCH",
    );

    const typeChange = sellEntry({
      id: "type-change",
      quantity: "1",
      supersedesEntryId: original.id,
      reason: "invalid economic type change",
    });
    expectIssue(
      () => resolveEffectiveLedgerEntries([original, typeChange]),
      "SUPERSEDE_TYPE_MISMATCH",
    );
  });

  it("sorts economic records by nanosecond instant before applying them", () => {
    const position = foldBrokerPosition([
      openingEntry({
        id: "opening",
        effectiveAt: "2026-07-01T14:00:00Z",
        quantity: "1",
        costInput: { mode: "TOTAL_COST", value: "50" },
      }),
      sellEntry({
        id: "sell",
        effectiveAt: "2026-07-02T14:00:00.000000002Z",
        quantity: "1",
      }),
      buyEntry({
        id: "buy",
        effectiveAt: "2026-07-02T10:00:00.000000001-04:00",
        quantity: "1",
        unitPrice: "100",
      }),
    ]);

    expect(position.quantity).toBe("1");
    expect(position.openCost).toBe("75");
    expect(position.appliedEntryIds).toEqual(["opening", "buy", "sell"]);
  });

  it("keeps the two brokers independent before aggregation", () => {
    const positions = calculateBrokerPositions([
      buyEntry({
        id: "broker-a-buy",
        brokerAccountId: "broker-a",
        quantity: "10",
        unitPrice: "100",
        fee: "1",
      }),
      buyEntry({
        id: "broker-b-buy",
        brokerAccountId: "broker-b",
        quantity: "5",
        unitPrice: "120",
        fee: "2",
      }),
    ]);

    expect(positions).toHaveLength(2);
    expect(positions.map((position) => position.openCost)).toEqual([
      "1001",
      "602",
    ]);
    expect(positions.map((position) => position.instrument)).toEqual([
      AAPL,
      AAPL,
    ]);
  });
});
