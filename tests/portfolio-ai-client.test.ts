import { describe, expect, it, vi } from "vitest";

import type {
  PortfolioAiFactsRequest,
} from "../application/ai/portfolio-analysis-api.ts";
import {
  requestPortfolioAiAnalysis,
} from "../application/ai/browser/portfolio-analysis-client.ts";

function request(): PortfolioAiFactsRequest {
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
        id: "daily.net",
        category: "TODAY_DRIVERS",
        subject: "PORTFOLIO",
        metric: "DAILY_NET_DIRECTION",
        direction: "NEUTRAL",
        status: "COMPLETE",
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
    ],
  };
}

describe("requestPortfolioAiAnalysis", () => {
  it("posts only the supplied facts to the same-origin no-store route", async () => {
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      expect(init).toMatchObject({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      expect(JSON.parse(String(init.body))).toEqual(request());
      return new Response(
        JSON.stringify({
          kind: "ERROR",
          code: "AI_NOT_CONFIGURED",
          message: "AI 解读尚未配置。",
        }),
        { status: 503 },
      );
    });

    await expect(
      requestPortfolioAiAnalysis(request(), fetchMock),
    ).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      message: "AI 解读尚未配置。",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/portfolio-analysis",
      expect.any(Object),
    );
  });

  it("rejects an unvalidated success response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          kind: "PORTFOLIO_AI_ANALYSIS",
          invented: true,
        }),
        { status: 200 },
      ),
    );
    await expect(
      requestPortfolioAiAnalysis(request(), fetchMock),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("maps network failures without exposing transport details", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("secret network detail");
    });
    await expect(
      requestPortfolioAiAnalysis(request(), fetchMock),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "无法连接 AI 解读服务；上方确定性分析仍可使用。",
    });
  });
});
