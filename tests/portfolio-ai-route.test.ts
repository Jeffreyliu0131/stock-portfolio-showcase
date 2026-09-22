import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/ai/portfolio-analysis/route.ts";
import type { PortfolioConsultationRequest } from "../application/ai/portfolio-consultation-api.ts";
import { resetPortfolioAiRateLimitForTests } from "../application/http/public-route-rate-limiters.ts";
import {
  initialPortfolioConsultationOutput,
  initialPortfolioConsultationRequest,
} from "./portfolio-consultation-fixtures.ts";

function factsRequest(): PortfolioConsultationRequest {
  return initialPortfolioConsultationRequest();
}

function modelOutput() {
  return initialPortfolioConsultationOutput();
}

function strictToolArguments() {
  const output = modelOutput();
  return {
    classifications: Object.fromEntries(
      output.classifications.map((classification) => [
        classification.positionId,
        {
          instrumentType: classification.instrumentType,
          sector: classification.sector,
          themes: classification.themes,
          confidence: classification.confidence,
          rationale: classification.rationale,
        },
      ]),
    ),
    headline: output.brief?.headline,
    summary: output.brief?.summary,
    dimensions: Object.fromEntries(
      (output.brief?.dimensions ?? []).map((dimension) => [
        dimension.kind,
        {
          title: dimension.title,
          text: dimension.text,
          evidenceRefs: dimension.evidenceRefs,
        },
      ]),
    ),
  };
}

function routeRequest(
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request("https://portfolio.example/api/ai/portfolio-analysis", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  resetPortfolioAiRateLimitForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/ai/portfolio-analysis", () => {
  it("rejects cross-site requests and unknown payload fields before contacting DeepSeek", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const crossSite = await POST(
      routeRequest(factsRequest(), {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      }),
    );
    expect(crossSite.status).toBe(403);

    const unknownField = await POST(
      routeRequest({ ...factsRequest(), accountNumber: "private" }),
    );
    expect(unknownField.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a browser same-origin request when the framework uses an internal request URL", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    const result = await POST(
      new Request("http://localhost:3417/api/ai/portfolio-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "127.0.0.1:3417",
          Origin: "http://127.0.0.1:3417",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify(factsRequest()),
      }),
    );

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "AI_NOT_CONFIGURED",
    });
  });

  it("rejects same-site but cross-origin browser requests", async () => {
    const result = await POST(
      routeRequest(factsRequest(), {
        Origin: "https://other.portfolio.example",
        "Sec-Fetch-Site": "same-site",
      }),
    );

    expect(result.status).toBe(403);
  });

  it("rejects oversized requests before provider or schema processing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const declaredOversized = await POST(
      routeRequest(factsRequest(), { "Content-Length": "262145" }),
    );
    expect(declaredOversized.status).toBe(413);

    const measuredOversized = await POST(
      routeRequest({
        ...factsRequest(),
        padding: "x".repeat(263_000),
      }),
    );
    expect(measuredOversized.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails safely when the server-only API key is absent", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await POST(routeRequest(factsRequest()));

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toEqual({
      kind: "ERROR",
      code: "AI_NOT_CONFIGURED",
      message: "AI 组合咨询尚未配置，确定性组合分析仍可正常使用。",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors the server-side AI kill switch before contacting DeepSeek", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-secret-key");
    vi.stubEnv("PORTFOLIO_AI_ENABLED", "false");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await POST(routeRequest(factsRequest()));

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "AI_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only validated analysis and never caches the response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T08:00:05.000Z"));
    vi.stubEnv("DEEPSEEK_API_KEY", "test-secret-key");
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const upstreamBody = JSON.parse(String(init?.body)) as {
        messages: readonly { readonly content: string }[];
        tools: readonly { readonly function: { readonly strict: boolean } }[];
      };
      const userPrompt = upstreamBody.messages[1]?.content ?? "";
      expect(userPrompt).toContain('"totalAssetsUsd":"4000"');
      expect(userPrompt).toContain('"cashBalanceUsd":"1000"');
      expect(userPrompt).toContain('"name":"Apple Inc."');
      expect(upstreamBody.tools[0]?.function.strict).toBe(true);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "return_portfolio_consultation",
                      arguments: JSON.stringify(strictToolArguments()),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await POST(routeRequest(factsRequest()));

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(result.headers.get("pragma")).toBe("no-cache");
    await expect(result.json()).resolves.toMatchObject({
      kind: "PORTFOLIO_CONSULTATION_RESULT",
      generatedAt: "2026-08-13T08:00:05.000Z",
      model: "deepseek-v4-flash",
      brief: modelOutput().brief,
    });
  });

  it("enforces a best-effort per-caller rate limit", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    for (let index = 0; index < 12; index += 1) {
      const response = await POST(routeRequest(factsRequest()));
      expect(response.status).toBe(503);
    }

    const limited = await POST(routeRequest(factsRequest()));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    await expect(limited.json()).resolves.toMatchObject({
      kind: "ERROR",
      code: "RATE_LIMITED",
    });
  });
});
