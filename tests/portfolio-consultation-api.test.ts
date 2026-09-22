import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_CONSULTATION_PROMPT_VERSION,
  parsePortfolioConsultationApiResponse,
  parsePortfolioConsultationModelOutput,
  parsePortfolioConsultationRequest,
} from "../application/ai/portfolio-consultation-api.ts";
import {
  chatPortfolioConsultationOutput,
  chatPortfolioConsultationRequest,
  followUpPortfolioConsultationOutput,
  followUpPortfolioConsultationRequest,
  initialPortfolioConsultationOutput,
  initialPortfolioConsultationRequest,
} from "./portfolio-consultation-fixtures.ts";

describe("portfolio consultation API contracts", () => {
  it("accepts a complete current-only portfolio context with amounts and NAV", () => {
    const request = initialPortfolioConsultationRequest();
    expect(parsePortfolioConsultationRequest(request)).toEqual(request);
    expect(JSON.stringify(request)).toContain("Apple Inc.");
    expect(JSON.stringify(request)).toContain('"quantity":"10"');
    expect(JSON.stringify(request)).toContain('"balanceUsd":"1000"');
    expect(JSON.stringify(request)).toContain('"netAssetValueUsd":"50000"');
  });

  it("accepts a valid fraction with more than eighty digits after the decimal point", () => {
    const request = initialPortfolioConsultationRequest();
    const longFraction = `0.${"0".repeat(80)}1`;
    expect(
      parsePortfolioConsultationRequest({
        ...request,
        portfolio: {
          ...request.portfolio,
          summary: {
            ...request.portfolio.summary,
            top1Weight: longFraction,
          },
        },
      }),
    ).not.toBeNull();
  });

  it("accepts valid RFC 3339 quote timestamps without fixed millisecond precision", () => {
    const request = initialPortfolioConsultationRequest();
    const positions = request.portfolio.positions.map((position, index) => ({
      ...position,
      quote: {
        ...position.quote,
        sourceEventAt:
          index === 0
            ? "2026-08-15T06:45:00Z"
            : "2026-08-15T06:44:00.123456789Z",
        fetchedAt: "2026-08-15T15:00:00+08:00",
      },
    }));

    expect(
      parsePortfolioConsultationRequest({
        ...request,
        generatedAt: "2026-08-15T15:00:00+08:00",
        portfolio: {
          ...request.portfolio,
          positions,
          quoteContext: {
            ...request.portfolio.quoteContext,
            oldestSourceEventAt: "2026-08-15T06:44:00.123456789Z",
            oldestFetchedAt: "2026-08-15T15:00:00+08:00",
          },
        },
      }),
    ).not.toBeNull();
  });

  it("rejects extra fields, inconsistent totals, and invalid fraction ranges", () => {
    const request = initialPortfolioConsultationRequest();
    expect(
      parsePortfolioConsultationRequest({ ...request, accountNumber: "private" }),
    ).toBeNull();
    expect(
      parsePortfolioConsultationRequest({
        ...request,
        portfolio: {
          ...request.portfolio,
          summary: {
            ...request.portfolio.summary,
            totalAssetsUsd: "4001",
          },
        },
      }),
    ).toBeNull();
    expect(
      parsePortfolioConsultationRequest({
        ...request,
        portfolio: {
          ...request.portfolio,
          positions: request.portfolio.positions.map((position, index) =>
            index === 0 ? { ...position, assetWeight: "1.01" } : position,
          ),
        },
      }),
    ).toBeNull();
  });

  it("requires a locked prior classification and alternating bounded history for follow-ups", () => {
    const request = followUpPortfolioConsultationRequest();
    expect(parsePortfolioConsultationRequest(request)).toEqual(request);
    expect(
      parsePortfolioConsultationRequest({
        ...request,
        history: [
          { role: "user", content: "先看行业暴露\n再看现金缓冲" },
          { role: "assistant", content: "可以分开说明这两个结构问题。" },
        ],
        question: "科技相关暴露主要来自哪里？\n现金起到什么作用？",
      }),
    ).not.toBeNull();
    expect(
      parsePortfolioConsultationRequest({
        ...request,
        priorClassifications: null,
      }),
    ).toBeNull();
    expect(
      parsePortfolioConsultationRequest({
        ...request,
        history: [{ role: "assistant", content: "顺序无效" }],
      }),
    ).toBeNull();
  });

  it("accepts the initial brief and follow-up answer variants", () => {
    expect(
      parsePortfolioConsultationModelOutput(
        initialPortfolioConsultationOutput(),
        initialPortfolioConsultationRequest(),
      ),
    ).toEqual(initialPortfolioConsultationOutput());
    expect(
      parsePortfolioConsultationModelOutput(
        followUpPortfolioConsultationOutput(),
        followUpPortfolioConsultationRequest(),
      ),
    ).toEqual(followUpPortfolioConsultationOutput());
  });

  it("accepts direct chat without prior classifications and keeps its output compact", () => {
    const request = chatPortfolioConsultationRequest();
    const output = chatPortfolioConsultationOutput();
    expect(parsePortfolioConsultationRequest(request)).toEqual(request);
    expect(parsePortfolioConsultationModelOutput(output, request)).toEqual(output);

    expect(
      parsePortfolioConsultationRequest({
        ...request,
        priorClassifications: initialPortfolioConsultationOutput().classifications,
      }),
    ).toBeNull();
    expect(
      parsePortfolioConsultationRequest({ ...request, question: null }),
    ).toBeNull();
    expect(
      parsePortfolioConsultationModelOutput(
        {
          ...output,
          classifications: initialPortfolioConsultationOutput().classifications,
        },
        request,
      ),
    ).toBeNull();
    expect(
      parsePortfolioConsultationModelOutput(
        {
          ...output,
          answer: {
            ...output.answer!,
            suggestedQuestions: ["还要继续看什么？"],
          },
        },
        request,
      ),
    ).toBeNull();
    expect(
      parsePortfolioConsultationModelOutput(
        {
          ...output,
          answer: {
            ...output.answer!,
            evidenceRefs: ["sector.INFORMATION_TECHNOLOGY"],
          },
        },
        request,
      ),
    ).toBeNull();
    for (const frameworkLenses of [
      [],
      ["UNKNOWN_LENS"],
      ["TEMPERAMENT", "TEMPERAMENT"],
      ["OWNER_EARNINGS"],
      [
        "CIRCLE_OF_COMPETENCE",
        "DURABLE_BUSINESS",
        "OPPORTUNITY_COST",
        "TEMPERAMENT",
      ],
    ]) {
      expect(
        parsePortfolioConsultationModelOutput(
          {
            ...output,
            answer: { ...output.answer!, frameworkLenses },
          },
          request,
        ),
      ).toBeNull();
    }
    expect(
      parsePortfolioConsultationModelOutput(
        {
          ...output,
          answer: {
            ...output.answer!,
            frameworkLenses: ["OWNER_EARNINGS", "EVIDENCE_GAP"],
          },
        },
        request,
      ),
    ).not.toBeNull();
  });

  it("rejects changed classifications, unknown evidence, generated numbers, and direct trade actions", () => {
    const request = followUpPortfolioConsultationRequest();
    const output = followUpPortfolioConsultationOutput();
    expect(
      parsePortfolioConsultationModelOutput(
        {
          ...output,
          classifications: output.classifications.map((entry, index) =>
            index === 0 ? { ...entry, sector: "FINANCIALS" } : entry,
          ),
        },
        request,
      ),
    ).toBeNull();
    for (const answer of [
      {
        ...output.answer!,
        evidenceRefs: ["sector.FINANCIALS"],
      },
      {
        ...output.answer!,
        text: "现金约占百分之二十五，可以提供流动性缓冲。",
      },
      {
        ...output.answer!,
        text: "建议卖出头部持仓来降低集中风险。",
      },
      {
        ...output.answer!,
        text: "应该降低仓位来减少结构敏感度。",
      },
      {
        ...output.answer!,
        text: "我是巴菲特，我会从机会成本开始判断。",
      },
      {
        ...output.answer!,
        suggestedQuestions: ["当前行业集中最需要关注什么？", "当前行业集中最需要关注什么？"],
      },
    ]) {
      expect(
        parsePortfolioConsultationModelOutput(
          { ...output, answer },
          request,
        ),
      ).toBeNull();
    }
    const initialRequest = initialPortfolioConsultationRequest();
    const initialOutput = initialPortfolioConsultationOutput();
    expect(
      parsePortfolioConsultationModelOutput(
        {
          ...initialOutput,
          classifications: initialOutput.classifications.map((entry, index) =>
            index === 0 ? { ...entry, themes: ["AI 2026"] } : entry,
          ),
        },
        initialRequest,
      ),
    ).toBeNull();
  });

  it("validates a complete success response against the originating request", () => {
    const request = initialPortfolioConsultationRequest();
    const output = initialPortfolioConsultationOutput();
    expect(
      parsePortfolioConsultationApiResponse(
        {
          kind: "PORTFOLIO_CONSULTATION_RESULT",
          schemaVersion: 4,
          generatedAt: "2026-08-15T07:00:05.000Z",
          model: "deepseek-v4-flash",
          promptVersion: PORTFOLIO_CONSULTATION_PROMPT_VERSION,
          mode: "INITIAL_ANALYSIS",
          ...output,
        },
        request,
      ),
    ).toMatchObject({
      kind: "PORTFOLIO_CONSULTATION_RESULT",
      brief: output.brief,
    });
  });
});
