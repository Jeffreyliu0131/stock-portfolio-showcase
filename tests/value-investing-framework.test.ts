import { describe, expect, it } from "vitest";

import {
  VALUE_INVESTING_ADVISOR_DISCLOSURE,
  VALUE_INVESTING_FRAMEWORK_LENSES,
  VALUE_INVESTING_FRAMEWORK_LENS_LABELS,
  valueInvestingFrameworkSystemPolicy,
} from "../application/ai/value-investing-framework.ts";

describe("value-investing framework policy", () => {
  it("keeps every machine lens unique and user-visible", () => {
    expect(new Set(VALUE_INVESTING_FRAMEWORK_LENSES).size).toBe(
      VALUE_INVESTING_FRAMEWORK_LENSES.length,
    );
    expect(Object.keys(VALUE_INVESTING_FRAMEWORK_LENS_LABELS).toSorted()).toEqual(
      [...VALUE_INVESTING_FRAMEWORK_LENSES].toSorted(),
    );
  });

  it("requires evidence gaps and explicitly forbids impersonation", () => {
    const policy = valueInvestingFrameworkSystemPolicy();
    expect(policy).toContain("当前证据不足");
    expect(policy).toContain("不得自称本人");
    expect(policy).toContain("所有者收益");
    expect(VALUE_INVESTING_ADVISOR_DISCLOSURE).toContain("不代表巴菲特本人");
  });
});
