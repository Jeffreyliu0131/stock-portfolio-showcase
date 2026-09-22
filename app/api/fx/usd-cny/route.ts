import { NextResponse } from "next/server";

import type {
  FxRateApiError,
  FxRateApiResponse,
} from "@/application/fx/fx-api";
import {
  AlpacaUsdCnyRateProvider,
  EcbUsdCnyRateProvider,
} from "@/application/fx/server";
import type { UsdCnyRate } from "@/application/fx";
import { getCachedUsdCnyRate } from "@/application/fx/server/usd-cny-route-cache";
import {
  callerKey,
} from "@/application/http/request-security";
import {
  providerCorsPreflight,
  requestIsAllowedProviderClient,
} from "@/application/http/provider-proxy-cors";
import { fxRouteLimiter } from "@/application/http/public-route-rate-limiters";
import { serverEnvironmentValue } from "@/application/runtime/server-environment";

export function OPTIONS(request: Request): Response {
  return providerCorsPreflight(request, "GET");
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(
  body: FxRateApiResponse,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<FxRateApiResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function errorResponse(
  status: number,
  code: FxRateApiError["code"],
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<FxRateApiResponse> {
  return response({ kind: "ERROR", code, message }, status, extraHeaders);
}

async function fetchLatestRate(): Promise<UsdCnyRate> {
  const apiKeyId = serverEnvironmentValue("ALPACA_API_KEY_ID")?.trim();
  const apiSecretKey = serverEnvironmentValue("ALPACA_API_SECRET_KEY")?.trim();

  if (apiKeyId && apiSecretKey) {
    try {
      const rate = await new AlpacaUsdCnyRateProvider({
        apiKeyId,
        apiSecretKey,
      }).getLatestRate();
      return rate;
    } catch {
      // Fall through to the credential-free ECB daily reference rate.
    }
  }

  return new EcbUsdCnyRateProvider().getLatestRate();
}

export async function GET(
  request: Request,
): Promise<NextResponse<FxRateApiResponse>> {
  if (!requestIsAllowedProviderClient(request)) {
    return errorResponse(403, "INVALID_REQUEST", "人民币估算汇率请求来源无效。");
  }
  const rateLimit = fxRouteLimiter.take(await callerKey(request));
  if (!rateLimit.allowed) {
    return errorResponse(429, "RATE_LIMITED", "人民币估算汇率请求较频繁，请稍后重试。", {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  try {
    const rate = await getCachedUsdCnyRate(fetchLatestRate);
    return response({ kind: "USD_CNY_RATE", rate }, 200);
  } catch {
    return errorResponse(
      503,
      "FX_RATE_UNAVAILABLE",
      "人民币估算汇率暂时不可用，当前继续显示 USD。",
    );
  }
}
