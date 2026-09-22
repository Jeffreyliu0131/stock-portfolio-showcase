import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseBuffettResearchModelOutput,
  parseBuffettResearchRequest,
} from "../application/ai/research/buffett-research-api.ts";
import { calculateBuffettResearchMetrics } from "../application/ai/research/buffett-research-calculations.ts";
import {
  aaplEvidenceForContract,
  aaplModelOutput,
  aaplResearchRequest,
} from "./buffett-research-fixtures.ts";

interface EvalCase {
  readonly id: string;
  readonly category: string;
  readonly variant: string;
  readonly expected: string;
}

const cases = JSON.parse(
  readFileSync(new URL("../evals/buffett-research/cases.json", import.meta.url), "utf8"),
) as readonly EvalCase[];

function observed(candidate: EvalCase): string {
  const request = aaplResearchRequest();
  const output = aaplModelOutput();
  const evidence = aaplEvidenceForContract();
  switch (candidate.variant) {
    case "AAPL_VALID":
      return parseBuffettResearchRequest(request) === null ? "REJECT" : "PASS";
    case "MSFT_VALID":
      return parseBuffettResearchRequest({ ...request, symbol: "MSFT" }) === null
        ? "REJECT"
        : "PASS";
    case "UNSUPPORTED_ISSUER":
      return parseBuffettResearchRequest({ ...request, symbol: "TSLA" }) === null
        ? "REJECT"
        : "PASS";
    case "UNKNOWN_EVIDENCE_REF":
      return parseBuffettResearchModelOutput(
        {
          ...output,
          claims: [
            { ...output.claims[0]!, evidenceRefs: ["web.unknown"] },
          ],
        },
        evidence,
      ) === null
        ? "REJECT"
        : "PASS";
    case "DIRECT_TRADE_ACTION":
    case "BUFFETT_IMPERSONATION":
    case "GENERATED_NUMBER": {
      const assessment =
        candidate.variant === "DIRECT_TRADE_ACTION"
          ? "建议买入并提高仓位。"
          : candidate.variant === "BUFFETT_IMPERSONATION"
            ? "我是巴菲特，这是我的结论。"
            : "这项结果提高了 20%。";
      return parseBuffettResearchModelOutput(
        {
          ...output,
          findings: [
            { ...output.findings[0]!, assessment },
            output.findings[1]!,
          ],
        },
        evidence,
      ) === null
        ? "REJECT"
        : "PASS";
    }
    case "OWNER_EARNINGS_ASSUMPTION":
      return calculateBuffettResearchMetrics(evidence).ownerEarnings.status;
    case "DISCOVERY_ONLY_FACT":
      return parseBuffettResearchModelOutput(
        output,
        evidence.map((item) => ({ ...item, authority: "DISCOVERY" as const })),
      ) === null
        ? "REJECT"
        : "PASS";
    default:
      return "UNKNOWN";
  }
}

describe("Buffett research fixed eval", () => {
  for (const candidate of cases) {
    it(`${candidate.id} ${candidate.variant}`, () => {
      expect(observed(candidate)).toBe(candidate.expected);
    });
  }
});
