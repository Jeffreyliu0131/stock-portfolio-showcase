import Decimal from "decimal.js";

const DisplayDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
});

function groupIntegerDigits(value: string): string {
  const [integer = "0", decimal] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimal === undefined ? grouped : `${grouped}.${decimal}`;
}

export function formatQuantity(value: string): string {
  const fixed = new DisplayDecimal(value).toFixed(8);
  return groupIntegerDigits(fixed.replace(/\.?0+$/, ""));
}

export function formatUsd(value: string): string {
  const amount = new DisplayDecimal(value);
  return `${amount.isNegative() ? "−" : ""}$${groupIntegerDigits(
    amount.abs().toFixed(2),
  )}`;
}

export function formatCny(value: string): string {
  const amount = new DisplayDecimal(value);
  return `${amount.isNegative() ? "−" : ""}¥${groupIntegerDigits(
    amount.abs().toFixed(2),
  )}`;
}
