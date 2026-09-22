import { describe, expect, it } from "vitest";

import { calculateBuffettResearchMetrics } from "../application/ai/research/buffett-research-calculations.ts";
import { aaplEvidenceForContract } from "./buffett-research-fixtures.ts";

describe("Buffett research deterministic calculations", () => {
  it("derives a cash-flow proxy but refuses to call it owner earnings", () => {
    const result = calculateBuffettResearchMetrics(
      aaplEvidenceForContract(),
    );
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        key: "FREE_CASH_FLOW_PROXY",
        value: "120760000000",
        status: "DERIVED",
        evidenceRefs: [
          "sec.xbrl.operating_cash_flow.2025-09-27",
          "sec.xbrl.capital_expenditures.2025-09-27",
        ],
      }),
    );
    expect(result.ownerEarnings).toMatchObject({
      status: "ASSUMPTION_REQUIRED",
      freeCashFlowProxyUsd: "120760000000",
    });
  });
});

describe("comparable financial periods", () => {
  it("does not divide annual income by quarterly revenue sharing an end date", () => {
    const evidence = aaplEvidenceForContract().map(item => item.metric === "REVENUE" ? { ...item, periodStart: "2025-07-01" } : item);
    expect(calculateBuffettResearchMetrics(evidence).metrics.some(m => m.key === "NET_MARGIN")).toBe(false);
  });
  it("does not combine mismatched capex periods or restatement vintages", () => {
    for (const patch of [{ periodStart: "2025-07-01" }, { filedAt: "2026-02-01" }]) {
      const evidence = aaplEvidenceForContract().map(item => item.metric === "CAPITAL_EXPENDITURES" ? { ...item, ...patch } : item);
      const result = calculateBuffettResearchMetrics(evidence);
      expect(result.metrics.some(m => m.key === "FREE_CASH_FLOW_PROXY")).toBe(false);
      expect(result.ownerEarnings.freeCashFlowProxyUsd).toBeNull();
    }
  });
  it("does not derive a metric from a missing numerator", () => {
    const result = calculateBuffettResearchMetrics(aaplEvidenceForContract().filter(e => e.metric !== "NET_INCOME"));
    expect(result.metrics.some(m => m.key === "NET_MARGIN")).toBe(false);
  });
});
