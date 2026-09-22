import { parsePortfolioWireRequest, portfolioWireResponse } from "@/application/ai/portfolio-wire-compatibility";
import { NextResponse } from "next/server";

import {
  PORTFOLIO_CONSULTATION_PROMPT_VERSION,
  PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
  type PortfolioConsultationApiError,
} from "@/application/ai/portfolio-consultation-api";
import {
  DeepSeekPortfolioConsultationError,
  consultPortfolioWithDeepSeek,
} from "@/application/ai/server/deepseek-portfolio-consultant";
import {
  callerKey,
  readBoundedJson,
} from "@/application/http/request-security";
import {
  providerCorsPreflight,
  requestIsAllowedProviderClient,
} from "@/application/http/provider-proxy-cors";
import { portfolioAiRouteLimiter } from "@/application/http/public-route-rate-limiters";
import { serverEnvironmentValue } from "@/application/runtime/server-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_REQUEST_BYTES = 262_144;

export function OPTIONS(request: Request): Response {
  return providerCorsPreflight(request, "POST");
}

function response(
  body: unknown,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });
}

function errorResponse(
  status: number,
  code: PortfolioConsultationApiError["code"],
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse {
  return response({ kind: "ERROR", code, message }, status, extraHeaders);
}

export async function POST(
  request: Request,
): Promise<NextResponse> {
  if (!requestIsAllowedProviderClient(request)) {
    return errorResponse(403, "INVALID_REQUEST", "AI 组合咨询请求来源无效。");
  }

  const rateLimit = portfolioAiRouteLimiter.take(await callerKey(request));
  if (!rateLimit.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "组合咨询较频繁，请稍后再试。",
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  const rawBody = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!rawBody.ok) {
    if (rawBody.reason === "UNSUPPORTED_MEDIA_TYPE") {
      return errorResponse(415, "INVALID_REQUEST", "AI 组合咨询请求格式无效。");
    }
    if (rawBody.reason === "TOO_LARGE") {
      return errorResponse(413, "INVALID_REQUEST", "AI 组合咨询请求体过大。");
    }
    return errorResponse(400, "INVALID_REQUEST", "AI 组合咨询请求格式无效。");
  }
  const wire = parsePortfolioWireRequest(rawBody.value);
  const parsed = wire?.request ?? null;
  if (parsed === null) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "AI 组合上下文结构无效；没有调用 DeepSeek。",
    );
  }

  const apiKey = serverEnvironmentValue("DEEPSEEK_API_KEY")?.trim() ?? "";
  if (serverEnvironmentValue("PORTFOLIO_AI_ENABLED") === "false" || apiKey === "") {
    return errorResponse(
      503,
      "AI_NOT_CONFIGURED",
      "AI 组合咨询尚未配置，确定性组合分析仍可正常使用。",
    );
  }

  try {
    const result = await consultPortfolioWithDeepSeek(parsed, {
      apiKey,
      legacyV3: wire!.version === 3,
    });
    return response(
      portfolioWireResponse({
        kind: "PORTFOLIO_CONSULTATION_RESULT",
        schemaVersion: PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        model: result.model,
        promptVersion: PORTFOLIO_CONSULTATION_PROMPT_VERSION,
        mode: parsed.mode,
        ...result.output,
      }, wire!.version),
      200,
    );
  } catch (error) {
    if (error instanceof DeepSeekPortfolioConsultationError) {
      if (error.code === "RATE_LIMITED") {
        return errorResponse(429, "RATE_LIMITED", error.message, {
          "Retry-After": "30",
        });
      }
      if (error.code === "INVALID_MODEL_OUTPUT") {
        return errorResponse(502, "INVALID_MODEL_OUTPUT", error.message);
      }
    }
    return errorResponse(
      502,
      "AI_PROVIDER_UNAVAILABLE",
      "AI 组合咨询暂时不可用；确定性组合分析仍可正常使用。",
    );
  }
}
