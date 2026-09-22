import { describe, expect, it } from "vitest";

import {
  parseBuffettResearchModelOutput,
  parseBuffettResearchRequest,
} from "../application/ai/research/buffett-research-api.ts";
import {
  aaplEvidenceForContract,
  aaplModelOutput,
  aaplResearchRequest,
} from "./buffett-research-fixtures.ts";

describe("Buffett research contract", () => {
  it("accepts the narrow AAPL/MSFT request and rejects expanded scope", () => {
    const request = aaplResearchRequest();
    expect(parseBuffettResearchRequest(request)).toEqual(request);
    expect(
      parseBuffettResearchRequest({ ...request, symbol: "TSLA" }),
    ).toBeNull();
    expect(
      parseBuffettResearchRequest({ ...request, holdings: "private" }),
    ).toBeNull();
    expect(
      parseBuffettResearchRequest({ ...request, question: "x".repeat(801) }),
    ).toBeNull();
  });

  it("requires every claim and lens finding to bind current evidence", () => {
    const evidence = aaplEvidenceForContract();
    const output = aaplModelOutput();
    expect(parseBuffettResearchModelOutput(output, evidence)).toEqual(output);
    expect(
      parseBuffettResearchModelOutput(
        {
          ...output,
          claims: [
            {
              ...output.claims[0]!,
              evidenceRefs: ["sec.xbrl.unknown"],
            },
          ],
        },
        evidence,
      ),
    ).toBeNull();
    expect(
      parseBuffettResearchModelOutput(
        output,
        evidence.map((item) =>
          item.metric === "OPERATING_CASH_FLOW" ||
          item.metric === "CAPITAL_EXPENDITURES"
            ? { ...item, authority: "DISCOVERY" as const }
            : item,
        ),
      ),
    ).toBeNull();
  });

  it("rejects generated numbers, impersonation, trade actions, and duplicate lenses", () => {
    const evidence = aaplEvidenceForContract();
    const output = aaplModelOutput();
    for (const assessment of [
      "建议买入并提高仓位。",
      "我是巴菲特，这就是我的判断。",
      "该指标提高了 20%。",
    ]) {
      expect(
        parseBuffettResearchModelOutput(
          {
            ...output,
            findings: [
              { ...output.findings[0]!, assessment },
              output.findings[1]!,
            ],
          },
          evidence,
        ),
      ).toBeNull();
    }
    expect(
      parseBuffettResearchModelOutput(
        {
          ...output,
          findings: [output.findings[0]!, output.findings[0]!],
        },
        evidence,
      ),
    ).toBeNull();
  });
});
