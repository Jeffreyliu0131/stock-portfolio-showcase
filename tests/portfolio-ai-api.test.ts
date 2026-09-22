import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_AI_PROMPT_VERSION,
  parsePortfolioAiApiResponse,
  parsePortfolioAiFactsRequest,
  parsePortfolioAiModelOutput,
  type PortfolioAiFactsRequest,
  type PortfolioAiModelOutput,
} from "../application/ai/portfolio-analysis-api.ts";

function factsRequest(): PortfolioAiFactsRequest {
  return {
    kind: "PORTFOLIO_AI_FACTS",
    schemaVersion: 1,
    generatedAt: "2026-08-13T08:00:00.000Z",
    locale: "zh-CN",
    evidence: [
      {
        id: "structure.status",
        category: "PORTFOLIO_OVERVIEW",
        subject: "PORTFOLIO",
        metric: "STRUCTURE_STATUS",
        status: "COMPLETE",
      },
      {
        id: "structure.top1",
        category: "PORTFOLIO_OVERVIEW",
        subject: "PORTFOLIO",
        metric: "TOP_CONCENTRATION",
        fraction: "0.5",
      },
      {
        id: "daily.net",
        category: "TODAY_DRIVERS",
        subject: "PORTFOLIO",
        metric: "DAILY_NET_DIRECTION",
        direction: "POSITIVE",
        status: "COMPLETE",
      },
      {
        id: "daily.position.0.contribution",
        category: "TODAY_DRIVERS",
        subject: "AAPL",
        metric: "DAILY_CONTRIBUTION",
        direction: "POSITIVE",
        fraction: "0.75",
      },
      {
        id: "quality.pricing",
        category: "DATA_QUALITY",
        subject: "PORTFOLIO",
        metric: "PRICING_COVERAGE",
        availableCount: 1,
        totalCount: 1,
        status: "COMPLETE",
      },
      {
        id: "quality.daily",
        category: "DATA_QUALITY",
        subject: "PORTFOLIO",
        metric: "DAILY_COVERAGE",
        availableCount: 1,
        totalCount: 1,
        status: "COMPLETE",
      },
    ],
  };
}

function modelOutput(): PortfolioAiModelOutput {
  return {
    headline: {
      text: "组合结构集中，今日贡献由少数标的主导",
      evidenceRefs: ["structure.top1", "daily.position.0.contribution"],
    },
    observations: [
      {
        category: "PORTFOLIO_OVERVIEW",
        title: "结构集中",
        text: "最大仓位与头部持仓共同决定当前组合的主要结构暴露",
        evidenceRefs: ["structure.top1"],
      },
      {
        category: "TODAY_DRIVERS",
        title: "今日驱动",
        text: "今日绝对变化主要由正向标的贡献，负向影响相对有限",
        evidenceRefs: ["daily.position.0.contribution", "daily.net"],
      },
      {
        category: "DATA_QUALITY",
        title: "数据完整",
        text: "当前估值与今日贡献覆盖完整，结论没有使用缺失值补齐",
        evidenceRefs: ["quality.pricing", "quality.daily"],
      },
    ],
    questions: [
      "当前的集中程度是否符合你的长期持有意图？",
      "你希望保留多少流动性来应对未来资金需要？",
    ],
  };
}

describe("portfolio AI API contracts", () => {
  it("accepts the privacy-minimized evidence request", () => {
    expect(parsePortfolioAiFactsRequest(factsRequest())).toEqual(factsRequest());
  });

  it("rejects exact amount fields and duplicate evidence ids", () => {
    const request = factsRequest();
    expect(
      parsePortfolioAiFactsRequest({
        ...request,
        totalAssetsUsd: "100000",
      }),
    ).toBeNull();
    expect(
      parsePortfolioAiFactsRequest({
        ...request,
        evidence: [...request.evidence, request.evidence[0]],
      }),
    ).toBeNull();
  });

  it("rejects invalid fractions and impossible coverage", () => {
    const request = factsRequest();
    expect(
      parsePortfolioAiFactsRequest({
        ...request,
        evidence: request.evidence.map((entry) =>
          entry.id === "structure.top1"
            ? { ...entry, fraction: "1.01" }
            : entry,
        ),
      }),
    ).toBeNull();
    expect(
      parsePortfolioAiFactsRequest({
        ...request,
        evidence: request.evidence.map((entry) =>
          entry.id === "quality.pricing"
            ? { ...entry, availableCount: 4 }
            : entry,
        ),
      }),
    ).toBeNull();
    expect(
      parsePortfolioAiFactsRequest({
        ...request,
        evidence: request.evidence.map((entry) =>
          entry.id === "quality.daily"
            ? { ...entry, availableCount: 2 }
            : entry,
        ),
      }),
    ).toBeNull();
    expect(
      parsePortfolioAiFactsRequest({
        ...request,
        evidence: request.evidence.map((entry) =>
          entry.id === "daily.net"
            ? { ...entry, direction: "UNAVAILABLE" }
            : entry,
        ),
      }),
    ).toBeNull();
  });

  it("accepts three evidence-bound observations and two questions", () => {
    expect(
      parsePortfolioAiModelOutput(modelOutput(), factsRequest().evidence),
    ).toEqual(modelOutput());
  });

  it("rejects invented numbers, recommendations, and external causal claims", () => {
    const output = modelOutput();
    for (const unsafeText of [
      "最大仓位占比达到百分之五十",
      "建议减仓以降低集中风险",
      "由于财报改善，今日表现偏强",
      "当前头部仓位预计将上涨",
      "第一只股票主导了组合结构",
    ]) {
      expect(
        parsePortfolioAiModelOutput(
          {
            ...output,
            observations: output.observations.map((entry, index) =>
              index === 0 ? { ...entry, text: unsafeText } : entry,
            ),
          },
          factsRequest().evidence,
        ),
      ).toBeNull();
    }
  });

  it("rejects unknown and cross-category evidence references", () => {
    const output = modelOutput();
    for (const evidenceRefs of [["missing.ref"], ["daily.net"]]) {
      expect(
        parsePortfolioAiModelOutput(
          {
            ...output,
            observations: output.observations.map((entry, index) =>
              index === 0 ? { ...entry, evidenceRefs } : entry,
            ),
          },
          factsRequest().evidence,
        ),
      ).toBeNull();
    }
  });

  it("validates the complete client response against the original evidence", () => {
    const output = modelOutput();
    expect(
      parsePortfolioAiApiResponse(
        {
          kind: "PORTFOLIO_AI_ANALYSIS",
          schemaVersion: 1,
          generatedAt: "2026-08-13T08:00:01.000Z",
          model: "deepseek-v4-flash",
          promptVersion: PORTFOLIO_AI_PROMPT_VERSION,
          ...output,
        },
        factsRequest().evidence,
      ),
    ).toMatchObject({
      kind: "PORTFOLIO_AI_ANALYSIS",
      headline: output.headline,
    });
  });
});
