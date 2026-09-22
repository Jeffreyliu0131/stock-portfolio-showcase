import {
  canonicalDecimal,
  parseNonNegativeInput,
  parsePositiveInput,
  type DecimalString,
  type PreciseDecimal,
} from "./decimal.ts";
import { failDomain, requireNonEmpty } from "./errors.ts";
import {
  createInstrumentKey,
  instrumentKeyId,
  sameInstrument,
  type InstrumentKey,
} from "./instrument.ts";
import { compareStableText } from "./order.ts";
import { CALCULATION_VERSION } from "./version.ts";

export type PositionCostInput =
  | {
      readonly mode: "AVERAGE_COST";
      readonly value: DecimalString;
    }
  | {
      readonly mode: "TOTAL_OPEN_COST";
      readonly value: DecimalString;
    };

export interface PositionInput {
  readonly id: string;
  readonly instrument: InstrumentKey;
  readonly quantity: DecimalString;
  readonly costInput: PositionCostInput;
}

export interface UnifiedPosition {
  readonly instrument: InstrumentKey;
  readonly quantity: DecimalString;
  readonly openCost: DecimalString;
  readonly averageCost: DecimalString;
  readonly calculationVersion: typeof CALCULATION_VERSION;
}

interface MutableUnifiedPosition {
  readonly instrument: InstrumentKey;
  quantity: PreciseDecimal;
  openCost: PreciseDecimal;
}

export function createPositionInput(input: PositionInput): PositionInput {
  const id = requireNonEmpty(input.id, "positionInput.id");
  const instrument = createInstrumentKey(input.instrument);
  parsePositiveInput(input.quantity, "positionInput.quantity");
  if (
    input.costInput.mode !== "AVERAGE_COST" &&
    input.costInput.mode !== "TOTAL_OPEN_COST"
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "positionInput.costInput.mode",
      entryId: id,
      message:
        "positionInput.costInput.mode must be AVERAGE_COST or TOTAL_OPEN_COST",
    });
  }
  parseNonNegativeInput(
    input.costInput.value,
    input.costInput.mode === "AVERAGE_COST"
      ? "positionInput.averageCost"
      : "positionInput.totalOpenCost",
  );

  return {
    id,
    instrument,
    quantity: input.quantity,
    costInput: { ...input.costInput },
  };
}

function inputOpenCost(input: PositionInput): PreciseDecimal {
  const quantity = parsePositiveInput(
    input.quantity,
    "positionInput.quantity",
  );
  const cost = parseNonNegativeInput(
    input.costInput.value,
    input.costInput.mode === "AVERAGE_COST"
      ? "positionInput.averageCost"
      : "positionInput.totalOpenCost",
  );
  return input.costInput.mode === "AVERAGE_COST"
    ? quantity.mul(cost)
    : cost;
}

export function aggregatePositionInputs(
  inputs: readonly PositionInput[],
): readonly UnifiedPosition[] {
  const grouped = new Map<string, MutableUnifiedPosition>();
  const inputIds = new Set<string>();

  for (const inputValue of inputs) {
    const input = createPositionInput(inputValue);
    const inputId = JSON.stringify([
      instrumentKeyId(input.instrument),
      input.id,
    ]);
    if (inputIds.has(inputId)) {
      failDomain({
        code: "DUPLICATE_ENTRY_ID",
        field: "positionInput.id",
        entryId: input.id,
        message: `duplicate position input id: ${input.id}`,
      });
    }
    inputIds.add(inputId);

    const quantity = parsePositiveInput(
      input.quantity,
      "positionInput.quantity",
    );
    const openCost = inputOpenCost(input);
    const groupKey = instrumentKeyId(input.instrument);
    const current = grouped.get(groupKey);
    if (current === undefined) {
      grouped.set(groupKey, {
        instrument: input.instrument,
        quantity,
        openCost,
      });
      continue;
    }

    if (!sameInstrument(current.instrument, input.instrument)) {
      failDomain({
        code: "INVALID_INSTRUMENT",
        message: "instrument key collision while aggregating positions",
      });
    }
    current.quantity = current.quantity.add(quantity);
    current.openCost = current.openCost.add(openCost);
  }

  return [...grouped.values()]
    .map((position): UnifiedPosition => ({
      instrument: position.instrument,
      quantity: canonicalDecimal(position.quantity),
      openCost: canonicalDecimal(position.openCost),
      averageCost: canonicalDecimal(
        position.openCost.div(position.quantity),
      ),
      calculationVersion: CALCULATION_VERSION,
    }))
    .toSorted((left, right) =>
      compareStableText(
        instrumentKeyId(left.instrument),
        instrumentKeyId(right.instrument),
      ),
    );
}
