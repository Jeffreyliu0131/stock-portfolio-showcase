import { describe, expect, it, vi } from "vitest";

import { runBuffettResearchPipeline } from "../application/ai/research/server/buffett-research-pipeline.ts";
import {
  researchOfficialWebWithOpenAi,
} from "../application/ai/research/server/openai-buffett-research.ts";
import { buffettResearchIssuer } from "../application/ai/research/supported-issuers.ts";
import {
  RESEARCH_NOW,
  aaplResearchRequest,
  officialWebSearchResponse,
  syntheticSecCompanyFacts,
  syntheticSecSubmissions,
  synthesisResponse,
} from "./buffett-research-fixtures.ts";

const CONFIG = {
  apiKey: "private-test-key",
  model: "gpt-5.5",
  retrievedAt: RESEARCH_NOW,
} as const;

describe("OpenAI Buffett research provider", () => {
  it("uses hosted web search with official-domain filters and no portfolio data", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer private-test-key",
      );
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "gpt-5.5",
        store: false,
        tool_choice: { type: "web_search" },
        include: ["web_search_call.action.sources"],
      });
      expect(body.tools[0]).toMatchObject({
        type: "web_search",
        external_web_access: true,
        filters: { allowed_domains: ["sec.gov", "apple.com"] },
      });
      expect(String(init?.body)).not.toContain("quantity");
      expect(String(init?.body)).not.toContain("averageCost");
      return new Response(JSON.stringify(officialWebSearchResponse()), {
        status: 200,
      });
    });
    const result = await researchOfficialWebWithOpenAi(
      aaplResearchRequest(),
      buffettResearchIssuer("AAPL"),
      CONFIG,
      new AbortController().signal,
      fetchMock,
    );
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.every((item) => item.authority === "DISCOVERY")).toBe(
      true,
    );
  });

  it("runs SEC and web retrieval before a no-tool structured synthesis", async () => {
    let openAiCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("data.sec.gov/submissions")) {
        return new Response(JSON.stringify(syntheticSecSubmissions()), {
          status: 200,
        });
      }
      if (url.includes("data.sec.gov/api/xbrl/companyfacts")) {
        return new Response(JSON.stringify(syntheticSecCompanyFacts()), {
          status: 200,
        });
      }
      openAiCalls += 1;
      const body = JSON.parse(String(init?.body));
      if (openAiCalls === 1) {
        expect(body.tools[0].type).toBe("web_search");
        return new Response(JSON.stringify(officialWebSearchResponse()), {
          status: 200,
        });
      }
      expect(body).not.toHaveProperty("tools");
      expect(body.text.format).toMatchObject({
        type: "json_schema",
        name: "buffett_research_result",
        strict: true,
      });
      expect(String(init?.body)).toContain("ASSUMPTION_REQUIRED");
      return new Response(JSON.stringify(synthesisResponse()), { status: 200 });
    });
    const result = await runBuffettResearchPipeline(
      aaplResearchRequest(),
      {
        generatedAt: RESEARCH_NOW,
        openAi: CONFIG,
        sec: {
          userAgent: "StockPortfolioResearch/0.1 contact@example.com",
          retrievedAt: RESEARCH_NOW,
        },
      },
      fetchMock,
    );
    expect(openAiCalls).toBe(2);
    expect(result.ownerEarnings.status).toBe("ASSUMPTION_REQUIRED");
    expect(result.trace.map((step) => step.stage)).toEqual([
      "PLAN",
      "SEC_RETRIEVAL",
      "WEB_SEARCH",
      "CALCULATION",
      "SYNTHESIS",
      "EVIDENCE_GATE",
    ]);
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "FREE_CASH_FLOW_PROXY" }),
        expect.objectContaining({ key: "NET_MARGIN" }),
      ]),
    );
  });
});
