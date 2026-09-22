import { describe, expect, it } from "vitest";

import {
  calculatePositionPreview,
  formatQuantity,
  formatUsd,
  isNonNegativeDecimalInput,
  isPositiveDecimalInput,
} from "./position-preview";

describe("calculatePositionPreview", () => {
  it("先合并数量和成本，再计算加权均价", () => {
    const preview = calculatePositionPreview(
      [
        { quantity: "10", cost: "100", costMode: "average" },
        { quantity: "5", cost: "120", costMode: "average" },
      ],
    );

    expect(preview).toMatchObject({
      totalQuantity: "15",
      totalOpenCost: "1600",
    });
    expect(formatUsd(preview?.averageCost ?? "0")).toBe("$106.67");
  });

  it("支持每组直接录入剩余总成本", () => {
    const preview = calculatePositionPreview(
      [
        { quantity: "10", cost: "1000", costMode: "total" },
        { quantity: "5", cost: "600", costMode: "total" },
      ],
    );

    expect(preview).toMatchObject({
      totalQuantity: "15",
      totalOpenCost: "1600",
    });
    expect(formatUsd(preview?.averageCost ?? "0")).toBe("$106.67");
  });

  it("支持同一批输入逐行混用平均成本和总成本", () => {
    const preview = calculatePositionPreview([
      { quantity: "10", cost: "100", costMode: "average" },
      { quantity: "5", cost: "600", costMode: "total" },
    ]);

    expect(preview).toMatchObject({
      totalQuantity: "15",
      totalOpenCost: "1600",
    });
    expect(formatUsd(preview?.averageCost ?? "0")).toBe("$106.67");
  });

  it("使用十进制精确合并碎股", () => {
    expect(
      calculatePositionPreview(
        [
          { quantity: "0.1", cost: "0.2", costMode: "average" },
          { quantity: "0.2", cost: "0.2", costMode: "average" },
        ],
      ),
    ).toEqual({
      totalQuantity: "0.3",
      totalOpenCost: "0.06",
      averageCost: "0.2",
    });
  });

  it("任一输入无效时不生成局部预览", () => {
    expect(
      calculatePositionPreview(
        [
          { quantity: "10", cost: "100", costMode: "average" },
          { quantity: "", cost: "120", costMode: "total" },
        ],
      ),
    ).toBeNull();
  });
});

describe("decimal input and display", () => {
  it("只接受正数且最多八位小数", () => {
    expect(isPositiveDecimalInput("0.00000001")).toBe(true);
    expect(isPositiveDecimalInput("0")).toBe(false);
    expect(isPositiveDecimalInput("-1")).toBe(false);
    expect(isPositiveDecimalInput("1.000000001")).toBe(false);
  });

  it("成本允许零但不允许负数", () => {
    expect(isNonNegativeDecimalInput("0")).toBe(true);
    expect(isNonNegativeDecimalInput("0.00000000")).toBe(true);
    expect(isNonNegativeDecimalInput("-0.01")).toBe(false);
  });

  it("格式化数量和 USD 时不借助二进制浮点数", () => {
    expect(formatQuantity("12345.12000000")).toBe("12,345.12");
    expect(formatUsd("12345.125")).toBe("$12,345.13");
    expect(formatUsd("-25")).toBe("−$25.00");
  });
});
