import {
  Decimal,
  canonicalDecimal,
  parseDecimal,
  parseNonNegativeInput,
  parsePositiveInput,
  type PreciseDecimal,
} from "../decimal.ts";
import {
  failDomain,
  requireNonEmpty,
} from "../errors.ts";
import {
  createInstrumentKey,
  instrumentKeyId,
  type InstrumentKey,
} from "../instrument.ts";
import { compareStableText } from "../order.ts";
import {
  compareRfc3339,
  rfc3339ToEpochNanoseconds,
} from "../time.ts";
import { CALCULATION_VERSION } from "../version.ts";
import type {
  BrokerPosition,
  CostInput,
  LedgerEntry,
  OpenPositionState,
} from "./types.ts";

interface DecimalPositionState {
  readonly quantity: PreciseDecimal;
  readonly openCost: PreciseDecimal;
}

function normalizedCurrency(value: string, entryId: string): string {
  const currency = requireNonEmpty(value, "currency", entryId).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    failDomain({
      code: "INVALID_CURRENCY",
      field: "currency",
      entryId,
      message: `entry ${entryId} currency must be a three-letter code`,
    });
  }
  return currency;
}

function ledgerGroupId(entry: LedgerEntry): string {
  const userId = requireNonEmpty(entry.userId, "userId", entry.id);
  const brokerAccountId = requireNonEmpty(
    entry.brokerAccountId,
    "brokerAccountId",
    entry.id,
  );
  return JSON.stringify([
    userId,
    brokerAccountId,
    instrumentKeyId(entry.instrument),
  ]);
}

function validateCostInput(
  quantity: PreciseDecimal,
  costInput: CostInput,
  entryId: string,
): DecimalPositionState {
  const field =
    costInput.mode === "TOTAL_COST"
      ? "costInput.totalCost"
      : "costInput.averageCost";
  const costValue = parseDecimal(costInput.value, {
    field,
    maxFractionalDigits:
      costInput.mode === "TOTAL_COST" ? 18 : 8,
  });
  if (costValue.lt(0)) {
    failDomain({
      code: "INVALID_COST",
      field,
      entryId,
      message: `entry ${entryId} cost input must be greater than or equal to zero`,
    });
  }

  if (quantity.isZero()) {
    if (costInput.mode !== "TOTAL_COST" || !costValue.isZero()) {
      failDomain({
        code: "ZERO_QUANTITY_REQUIRES_ZERO_COST",
        field,
        entryId,
        message: `entry ${entryId} with zero quantity requires TOTAL_COST 0`,
      });
    }
    return { quantity, openCost: new Decimal("0") };
  }

  return {
    quantity,
    openCost:
      costInput.mode === "TOTAL_COST"
        ? costValue
        : quantity.mul(costValue),
  };
}

function validateEntry(entry: LedgerEntry): void {
  requireNonEmpty(entry.id, "id", entry.id);
  requireNonEmpty(entry.userId, "userId", entry.id);
  requireNonEmpty(entry.brokerAccountId, "brokerAccountId", entry.id);

  const instrument = createInstrumentKey(entry.instrument);
  if (normalizedCurrency(entry.currency, entry.id) !== instrument.currency) {
    failDomain({
      code: "INVALID_CURRENCY",
      field: "currency",
      entryId: entry.id,
      message: `entry ${entry.id} currency must match its instrument currency`,
    });
  }

  rfc3339ToEpochNanoseconds(entry.effectiveAt, "effectiveAt");
  rfc3339ToEpochNanoseconds(entry.createdAt, "createdAt");

  if (entry.supersedesEntryId !== undefined) {
    requireNonEmpty(
      entry.supersedesEntryId,
      "supersedesEntryId",
      entry.id,
    );
    if (entry.reason === undefined || entry.reason.trim().length === 0) {
      failDomain({
        code: "SUPERSEDE_REASON_REQUIRED",
        field: "reason",
        entryId: entry.id,
        message: `entry ${entry.id} must explain why it supersedes another entry`,
      });
    }
  }

  switch (entry.type) {
    case "OPENING_POSITION": {
      const quantity = parsePositiveInput(entry.quantity, "quantity");
      validateCostInput(quantity, entry.costInput, entry.id);
      return;
    }
    case "BUY":
      parsePositiveInput(entry.quantity, "quantity");
      parsePositiveInput(entry.unitPrice, "unitPrice");
      if (entry.fee !== undefined) {
        parseNonNegativeInput(entry.fee, "fee", "INVALID_FEE");
      }
      return;
    case "SELL":
      parsePositiveInput(entry.quantity, "quantity");
      if (entry.unitPrice !== undefined) {
        parsePositiveInput(entry.unitPrice, "unitPrice");
      }
      if (entry.fee !== undefined) {
        parseNonNegativeInput(entry.fee, "fee", "INVALID_FEE");
      }
      return;
    case "POSITION_RECONCILIATION": {
      if (entry.reason.trim().length === 0) {
        failDomain({
          code: "MISSING_RECONCILIATION_REASON",
          field: "reason",
          entryId: entry.id,
          message: `entry ${entry.id} reconciliation reason must not be empty`,
        });
      }
      const quantity = parseNonNegativeInput(
        entry.quantity,
        "quantity",
      );
      validateCostInput(quantity, entry.costInput, entry.id);
      return;
    }
    default: {
      const unsupported = entry as { readonly id?: string; readonly type?: string };
      failDomain({
        code: "INVALID_ENTRY",
        ...(unsupported.id === undefined
          ? {}
          : { entryId: unsupported.id }),
        message: `unsupported ledger entry type: ${String(unsupported.type)}`,
      });
    }
  }
}

function compareLedgerEntries(left: LedgerEntry, right: LedgerEntry): number {
  const effectiveOrder = compareRfc3339(left.effectiveAt, right.effectiveAt);
  if (effectiveOrder !== 0) {
    return effectiveOrder;
  }

  const createdOrder = compareRfc3339(left.createdAt, right.createdAt);
  if (createdOrder !== 0) {
    return createdOrder;
  }
  return compareStableText(left.id, right.id);
}

export function resolveEffectiveLedgerEntries(
  entries: readonly LedgerEntry[],
): readonly LedgerEntry[] {
  const entriesById = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    validateEntry(entry);
    if (entriesById.has(entry.id)) {
      failDomain({
        code: "DUPLICATE_ENTRY_ID",
        field: "id",
        entryId: entry.id,
        message: `duplicate ledger entry id: ${entry.id}`,
      });
    }
    entriesById.set(entry.id, entry);
  }

  const successorByTargetId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.supersedesEntryId === undefined) {
      continue;
    }

    const target = entriesById.get(entry.supersedesEntryId);
    if (target === undefined) {
      failDomain({
        code: "UNKNOWN_SUPERSEDED_ENTRY",
        field: "supersedesEntryId",
        entryId: entry.id,
        message: `entry ${entry.id} supersedes an unknown entry`,
      });
    }
    if (ledgerGroupId(target) !== ledgerGroupId(entry)) {
      failDomain({
        code: "SUPERSEDE_GROUP_MISMATCH",
        field: "supersedesEntryId",
        entryId: entry.id,
        message: `entry ${entry.id} cannot supersede an entry in another ledger group`,
      });
    }
    if (target.type !== entry.type) {
      failDomain({
        code: "SUPERSEDE_TYPE_MISMATCH",
        field: "supersedesEntryId",
        entryId: entry.id,
        message: `entry ${entry.id} cannot change the economic type of ${target.id}`,
      });
    }
    if (successorByTargetId.has(target.id)) {
      failDomain({
        code: "SUPERSEDE_FORK",
        field: "supersedesEntryId",
        entryId: entry.id,
        message: `entry ${target.id} has more than one direct correction`,
      });
    }
    successorByTargetId.set(target.id, entry.id);
  }

  for (const entry of entries) {
    const visited = new Set<string>();
    let current: LedgerEntry | undefined = entry;
    while (current?.supersedesEntryId !== undefined) {
      if (visited.has(current.id)) {
        failDomain({
          code: "SUPERSEDE_CYCLE",
          entryId: entry.id,
          message: `supersede chain containing ${entry.id} is cyclic`,
        });
      }
      visited.add(current.id);
      current = entriesById.get(current.supersedesEntryId);
    }
  }

  return entries
    .filter((entry) => !successorByTargetId.has(entry.id))
    .toSorted(compareLedgerEntries);
}

function validateState(state: OpenPositionState): DecimalPositionState {
  const quantity = parseDecimal(state.quantity, { field: "state.quantity" });
  const openCost = parseDecimal(state.openCost, { field: "state.openCost" });
  if (quantity.lt(0) || openCost.lt(0)) {
    failDomain({
      code: "NEGATIVE_POSITION",
      message: "position quantity and open cost must not be negative",
    });
  }
  if (quantity.isZero() && !openCost.isZero()) {
    failDomain({
      code: "ZERO_QUANTITY_REQUIRES_ZERO_COST",
      message: "zero position quantity requires zero open cost",
    });
  }
  return { quantity, openCost };
}

function applyEntryToDecimalState(
  state: DecimalPositionState,
  entry: LedgerEntry,
): DecimalPositionState {
  switch (entry.type) {
    case "OPENING_POSITION": {
      const quantity = parsePositiveInput(entry.quantity, "quantity");
      return validateCostInput(quantity, entry.costInput, entry.id);
    }
    case "BUY": {
      const quantity = parsePositiveInput(entry.quantity, "quantity");
      const unitPrice = parsePositiveInput(entry.unitPrice, "unitPrice");
      const fee =
        entry.fee === undefined
          ? new Decimal("0")
          : parseNonNegativeInput(entry.fee, "fee", "INVALID_FEE");
      return {
        quantity: state.quantity.add(quantity),
        openCost: state.openCost.add(quantity.mul(unitPrice)).add(fee),
      };
    }
    case "SELL": {
      const quantity = parsePositiveInput(entry.quantity, "quantity");
      if (quantity.gt(state.quantity)) {
        failDomain({
          code: "NEGATIVE_POSITION",
          field: "quantity",
          entryId: entry.id,
          message: `entry ${entry.id} sells ${entry.quantity}, exceeding available quantity ${canonicalDecimal(state.quantity)}`,
        });
      }

      const remainingQuantity = state.quantity.sub(quantity);
      if (remainingQuantity.isZero()) {
        return {
          quantity: new Decimal("0"),
          openCost: new Decimal("0"),
        };
      }

      const averageCostBefore = state.openCost.div(state.quantity);
      return {
        quantity: remainingQuantity,
        openCost: remainingQuantity.mul(averageCostBefore),
      };
    }
    case "POSITION_RECONCILIATION": {
      const quantity = parseNonNegativeInput(entry.quantity, "quantity");
      return validateCostInput(quantity, entry.costInput, entry.id);
    }
  }
}

function publicState(state: DecimalPositionState): OpenPositionState {
  return {
    quantity: canonicalDecimal(state.quantity),
    openCost: canonicalDecimal(state.openCost),
  };
}

export function applyOpenPositionEntry(
  state: OpenPositionState,
  entry: LedgerEntry,
): OpenPositionState {
  validateEntry(entry);
  return publicState(applyEntryToDecimalState(validateState(state), entry));
}

function foldEffectiveGroup(
  effectiveEntries: readonly LedgerEntry[],
): BrokerPosition {
  const first = effectiveEntries[0];
  if (first === undefined) {
    failDomain({
      code: "INVALID_ENTRY",
      message: "cannot fold an empty ledger group",
    });
  }

  const groupId = ledgerGroupId(first);
  for (const entry of effectiveEntries) {
    if (ledgerGroupId(entry) !== groupId) {
      failDomain({
        code: "MIXED_LEDGER_GROUP",
        entryId: entry.id,
        message: "broker position fold received entries from multiple groups",
      });
    }
  }

  const openings = effectiveEntries.filter(
    (entry) => entry.type === "OPENING_POSITION",
  );
  if (openings.length > 1) {
    failDomain({
      code: "MULTIPLE_OPENING_POSITIONS",
      message: "a ledger group can have at most one effective opening position",
    });
  }

  const opening = openings[0];
  let entriesToApply = effectiveEntries;
  if (opening !== undefined) {
    for (const entry of effectiveEntries) {
      if (
        (entry.type === "BUY" || entry.type === "SELL") &&
        compareRfc3339(entry.effectiveAt, opening.effectiveAt) <= 0
      ) {
        failDomain({
          code: "ENTRY_AT_OR_BEFORE_OPENING",
          field: "effectiveAt",
          entryId: entry.id,
          message: `entry ${entry.id} is at or before the opening-position cutover`,
        });
      }
    }

    entriesToApply = effectiveEntries.filter(
      (entry) =>
        entry.id === opening.id ||
        compareRfc3339(entry.effectiveAt, opening.effectiveAt) > 0,
    );
  }

  let state: DecimalPositionState = {
    quantity: new Decimal("0"),
    openCost: new Decimal("0"),
  };
  const appliedEntryIds: string[] = [];
  for (const entry of entriesToApply.toSorted(compareLedgerEntries)) {
    state = applyEntryToDecimalState(state, entry);
    appliedEntryIds.push(entry.id);
  }

  const instrument: InstrumentKey = createInstrumentKey(first.instrument);
  return {
    userId: first.userId.trim(),
    brokerAccountId: first.brokerAccountId.trim(),
    instrument,
    quantity: canonicalDecimal(state.quantity),
    openCost: canonicalDecimal(state.openCost),
    averageCost: state.quantity.isZero()
      ? null
      : canonicalDecimal(state.openCost.div(state.quantity)),
    appliedEntryIds,
    calculationVersion: CALCULATION_VERSION,
  };
}

export function foldBrokerPosition(
  entries: readonly LedgerEntry[],
): BrokerPosition {
  const effectiveEntries = resolveEffectiveLedgerEntries(entries);
  return foldEffectiveGroup(effectiveEntries);
}

export function calculateBrokerPositions(
  entries: readonly LedgerEntry[],
): readonly BrokerPosition[] {
  const effectiveEntries = resolveEffectiveLedgerEntries(entries);
  const groups = new Map<string, LedgerEntry[]>();

  for (const entry of effectiveEntries) {
    const groupId = ledgerGroupId(entry);
    const group = groups.get(groupId);
    if (group === undefined) {
      groups.set(groupId, [entry]);
    } else {
      group.push(entry);
    }
  }

  return [...groups.values()]
    .map((group) => foldEffectiveGroup(group))
    .toSorted((left, right) => {
      const userOrder = compareStableText(left.userId, right.userId);
      if (userOrder !== 0) {
        return userOrder;
      }
      const brokerOrder = compareStableText(
        left.brokerAccountId,
        right.brokerAccountId,
      );
      if (brokerOrder !== 0) {
        return brokerOrder;
      }
      return compareStableText(
        instrumentKeyId(left.instrument),
        instrumentKeyId(right.instrument),
      );
    });
}
