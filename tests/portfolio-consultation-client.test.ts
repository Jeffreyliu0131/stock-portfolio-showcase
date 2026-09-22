import { describe, expect, it, vi } from "vitest";

import {
  requestPortfolioConsultation,
} from "../application/ai/browser/portfolio-consultation-client.ts";
import {
  initialPortfolioConsultationOutput,
  initialPortfolioConsultationRequest,
} from "./portfolio-consultation-fixtures.ts";

describe("requestPortfolioConsultation", () => {
  it("posts the supplied full context to the same-origin no-store route", async () => {
    const request = initialPortfolioConsultationRequest();
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      expect(init).toMatchObject({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      expect(JSON.parse(String(init.body))).toEqual(request);
      return new Response(
        JSON.stringify({
          kind: "ERROR",
          code: "AI_NOT_CONFIGURED",
          message: "AI 组合咨询尚未配置。",
        }),
        { status: 503 },
      );
    });

    await expect(
      requestPortfolioConsultation(request, fetchMock),
    ).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      message: "AI 组合咨询尚未配置。",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/portfolio-analysis",
      expect.any(Object),
    );
  });

  it("accepts only a response validated against the original snapshot", async () => {
    const request = initialPortfolioConsultationRequest();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          kind: "PORTFOLIO_CONSULTATION_RESULT",
          schemaVersion: 4,
          generatedAt: "2026-08-15T07:00:05.000Z",
          model: "deepseek-v4-flash",
          promptVersion: "portfolio-value-advisor-v4",
          mode: "INITIAL_ANALYSIS",
          ...initialPortfolioConsultationOutput(),
        }),
        { status: 200 },
      ),
    );

    await expect(
      requestPortfolioConsultation(request, fetchMock),
    ).resolves.toMatchObject({
      kind: "PORTFOLIO_CONSULTATION_RESULT",
      brief: initialPortfolioConsultationOutput().brief,
    });
  });

  it("rejects malformed success responses and maps network failures safely", async () => {
    await expect(
      requestPortfolioConsultation(
        initialPortfolioConsultationRequest(),
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              kind: "PORTFOLIO_CONSULTATION_RESULT",
              invented: true,
            }),
            { status: 200 },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    await expect(
      requestPortfolioConsultation(
        initialPortfolioConsultationRequest(),
        vi.fn(async () => {
          throw new Error("secret transport detail");
        }),
      ),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "无法连接 AI 组合咨询；下方确定性分析仍可使用。",
    });
  });
});
