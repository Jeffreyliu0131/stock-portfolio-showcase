import { NextResponse } from "next/server";

import {
  parseBuffettResearchRequest,
  type BuffettResearchApiError,
  type BuffettResearchApiResponse,
} from "@/application/ai/research/buffett-research-api";
import {
  runBuffettResearchPipeline,
} from "@/application/ai/research/server/buffett-research-pipeline";
import {
  OpenAiBuffettResearchError,
} from "@/application/ai/research/server/openai-buffett-research";
import {
  SecEdgarResearchError,
} from "@/application/ai/research/server/sec-edgar-research";
import {
  callerKey,
  readBoundedJson,
} from "@/application/http/request-security";
import {
  providerCorsPreflight,
  requestIsAllowedProviderClient,
} from "@/application/http/provider-proxy-cors";
import { buffettResearchRouteLimiter } from "@/application/http/public-route-rate-limiters";
import { serverEnvironmentValue } from "@/application/runtime/server-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_REQUEST_BYTES = 32_768;

export function OPTIONS(request: Request): Response {
  return providerCorsPreflight(request, "POST");
}

function response(
  body: BuffettResearchApiResponse,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<BuffettResearchApiResponse> {
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
  code: BuffettResearchApiError["code"],
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<BuffettResearchApiResponse> {
  return response({ kind: "ERROR", code, message }, status, extraHeaders);
}

export async function POST(
  request: Request,
): Promise<NextResponse<BuffettResearchApiResponse>> {
  if (!requestIsAllowedProviderClient(request)) {
    return errorResponse(403, "INVALID_REQUEST", "研究请求来源无效。");
  }
  const rateLimit = buffettResearchRouteLimiter.take(await callerKey(request));
  if (!rateLimit.allowed) {
    return errorResponse(429, "RATE_LIMITED", "研究请求较多，请稍后重试。", {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }
  const rawBody = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!rawBody.ok) {
    return errorResponse(
      rawBody.reason === "TOO_LARGE"
        ? 413
        : rawBody.reason === "UNSUPPORTED_MEDIA_TYPE"
          ? 415
          : 400,
      "INVALID_REQUEST",
      "研究请求格式无效。",
    );
  }
  const parsed = parseBuffettResearchRequest(rawBody.value);
  if (parsed === null) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "研究请求只支持 AAPL 与 MSFT，且不允许额外字段。",
    );
  }

  const apiKey = serverEnvironmentValue("OPENAI_API_KEY")?.trim() ?? "";
  const secUserAgent =
    serverEnvironmentValue("SEC_RESEARCH_USER_AGENT")?.trim() ?? "";
  if (
    serverEnvironmentValue("BUFFETT_RESEARCH_ENABLED") === "false" ||
    apiKey === "" ||
    secUserAgent === ""
  ) {
    return errorResponse(
      503,
      "RESEARCH_NOT_CONFIGURED",
      "巴菲特研究系统尚未配置，现有组合分析仍可使用。",
    );
  }

  const now = new Date().toISOString();
  try {
    const result = await runBuffettResearchPipeline(
      parsed,
      {
        generatedAt: now,
        openAi: {
          apiKey,
          model:
            serverEnvironmentValue("OPENAI_RESEARCH_MODEL")?.trim() ||
            "gpt-5.5",
          retrievedAt: now,
        },
        sec: { userAgent: secUserAgent, retrievedAt: now },
      },
    );
    return response(result, 200);
  } catch (error) {
    if (error instanceof OpenAiBuffettResearchError) {
      if (error.code === "RATE_LIMITED") {
        return errorResponse(429, "RATE_LIMITED", error.message, {
          "Retry-After": "30",
        });
      }
      return errorResponse(
        502,
        error.code === "INVALID_PROVIDER_OUTPUT"
          ? "INVALID_RESEARCH_OUTPUT"
          : "AI_PROVIDER_UNAVAILABLE",
        error.message,
      );
    }
    if (error instanceof SecEdgarResearchError) {
      return errorResponse(502, "SEC_UNAVAILABLE", error.message);
    }
    return errorResponse(
      502,
      "AI_PROVIDER_UNAVAILABLE",
      "巴菲特研究系统暂时不可用。",
    );
  }
}
