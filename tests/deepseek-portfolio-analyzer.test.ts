import { describe, expect, it, vi } from "vitest";

import type {
  PortfolioAiFactsRequest,
  PortfolioAiModelOutput,
} from "../application/ai/portfolio-analysis-api.ts";
import {
  analyzePortfolioWithDeepSeek,
} from "../application/ai/server/deepseek-portfolio-analyzer.ts";

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
        id: "structure.top1",
        category: "PORTFOLIO_OVERVIEW",
        subject: "PORTFOLIO",
        metric: "TOP_CONCENTRATION",
        fraction: "0.6",
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
        fraction: "0.8",
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

function output(): PortfolioAiModelOutput {
  return {
    headline: {
      text: "头部仓位与今日正向贡献共同主导当前观察",
      evidenceRefs: ["structure.top1", "daily.position.0.contribution"],
    },
    observations: [
      {
        category: "PORTFOLIO_OVERVIEW",
        title: "头部结构",
        text: "最大仓位在组合结构中占据主导，需要结合个人集中度意图理解",
        evidenceRefs: ["structure.top1"],
      },
      {
        category: "TODAY_DRIVERS",
        title: "今日贡献",
        text: "今日可计算变化由正向标的主导，组合净方向与其保持一致",
        evidenceRefs: ["daily.position.0.contribution", "daily.net"],
      },
      {
        category: "DATA_QUALITY",
        title: "完整口径",
        text: "估值和今日贡献当前都有完整覆盖，无需用缺失值补齐",
        evidenceRefs: ["quality.pricing", "quality.daily"],
      },
    ],
    questions: [
      "当前头部集中程度是否符合你的持有意图？",
      "你的流动性需求会怎样影响可接受的现金比例？",
    ],
  };
}

describe("analyzePortfolioWithDeepSeek", () => {
  it("uses Flash non-thinking JSON mode and returns validated evidence refs", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.deepseek.com/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer private-test-key",
      );
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 800,
        stream: false,
      });
      expect(body).not.toHaveProperty("user");
      expect(init?.redirect).toBe("error");
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(output()) },
            },
          ],
        }),
        { status: 200 },
      );
    });

    await expect(
      analyzePortfolioWithDeepSeek(
        request(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).resolves.toEqual({
      model: "deepseek-v4-flash",
      output: output(),
    });
  });

  it("rejects empty, truncated, and ungrounded model output", async () => {
    const responses = [
      {
        choices: [{ finish_reason: "stop", message: { content: "" } }],
      },
      {
        choices: [
          { finish_reason: "length", message: { content: JSON.stringify(output()) } },
        ],
      },
      {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                ...output(),
                headline: {
                  text: "结论引用了不存在的证据",
                  evidenceRefs: ["unknown"],
                },
              }),
            },
          },
        ],
      },
    ];

    for (const upstream of responses) {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify(upstream), { status: 200 }),
      );
      await expect(
        analyzePortfolioWithDeepSeek(
          request(),
          { apiKey: "private-test-key" },
          fetchMock,
        ),
      ).rejects.toMatchObject({
        code: "INVALID_MODEL_OUTPUT",
      });
    }
  });

  it("maps provider throttling without exposing its response body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("provider detail", { status: 429 }),
    );
    await expect(
      analyzePortfolioWithDeepSeek(
        request(),
        { apiKey: "private-test-key" },
        fetchMock,
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "AI 服务请求较多，请稍后重试。",
    });
  });

  it("aborts a stalled provider request", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    await expect(
      analyzePortfolioWithDeepSeek(
        request(),
        { apiKey: "private-test-key", timeoutMs: 5 },
        fetchMock,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "AI 服务暂时无法连接。",
    });
  });
});
