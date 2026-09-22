import Decimal from "decimal.js";

export { formatCny, formatQuantity, formatUsd } from "./financial-format.ts";

export type CostMode = "average" | "total";

export type PositionInputRow = {
  quantity: string;
  cost: string;
  costMode: CostMode;
};

export type PositionPreview = {
  totalQuantity: string;
  totalOpenCost: string;
  averageCost: string;
};

const POSITIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;
const UiDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
});

export function isPositiveDecimalInput(value: string): boolean {
  const normalized = value.trim();
  if (!POSITIVE_DECIMAL_PATTERN.test(normalized)) {
    return false;
  }

  return new UiDecimal(normalized).greaterThan(0);
}

export function isNonNegativeDecimalInput(value: string): boolean {
  const normalized = value.trim();
  if (!POSITIVE_DECIMAL_PATTERN.test(normalized)) {
    return false;
  }

  return new UiDecimal(normalized).greaterThanOrEqualTo(0);
}

export function calculatePositionPreview(
  rows: readonly PositionInputRow[],
): PositionPreview | null {
  if (
    rows.length === 0 ||
    rows.some(
      (row) =>
        !isPositiveDecimalInput(row.quantity) ||
        !isNonNegativeDecimalInput(row.cost),
    )
  ) {
    return null;
  }

  let totalQuantity = new UiDecimal(0);
  let totalOpenCost = new UiDecimal(0);

  for (const row of rows) {
    const quantity = new UiDecimal(row.quantity.trim());
    const cost = new UiDecimal(row.cost.trim());

    totalQuantity = totalQuantity.plus(quantity);
    totalOpenCost = totalOpenCost.plus(
      row.costMode === "average" ? quantity.times(cost) : cost,
    );
  }

  return {
    totalQuantity: totalQuantity.toString(),
    totalOpenCost: totalOpenCost.toString(),
    averageCost: totalOpenCost.dividedBy(totalQuantity).toString(),
  };
}
