import { NextResponse } from "next/server";

import type {
  InstrumentApiError,
  InstrumentApiResponse,
} from "@/application/instruments/instrument-api";
import { normalizeSupportedSymbol } from "@/application/instruments";
import { AlpacaInstrumentResolver } from "@/application/instruments/server";
import {
  callerKey,
  readBoundedJson,
} from "@/application/http/request-security";
import {
  providerCorsPreflight,
  requestIsAllowedProviderClient,
} from "@/application/http/provider-proxy-cors";
import { instrumentRouteLimiter } from "@/application/http/public-route-rate-limiters";
import { serverEnvironmentValue } from "@/application/runtime/server-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1_024;

export function OPTIONS(request: Request): Response {
  return providerCorsPreflight(request, "POST");
}

function response(
  body: InstrumentApiResponse,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<InstrumentApiResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function errorResponse(
  status: number,
  code: InstrumentApiError["code"],
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<InstrumentApiResponse> {
  return response({ kind: "ERROR", code, message }, status, extraHeaders);
}

export async function POST(
  request: Request,
): Promise<NextResponse<InstrumentApiResponse>> {
  if (!requestIsAllowedProviderClient(request)) {
    return errorResponse(403, "INVALID_REQUEST", "标的验证请求来源无效。");
  }
  const rateLimit = instrumentRouteLimiter.take(await callerKey(request));
  if (!rateLimit.allowed) {
    return errorResponse(429, "RATE_LIMITED", "标的验证请求较频繁，请稍后重试。", {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const parsedBody = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    if (parsedBody.reason === "UNSUPPORTED_MEDIA_TYPE") {
      return errorResponse(415, "INVALID_REQUEST", "标的验证请求格式无效。");
    }
    if (parsedBody.reason === "TOO_LARGE") {
      return errorResponse(413, "INVALID_REQUEST", "标的验证请求体过大。");
    }
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "标的验证请求格式无效。",
    );
  }
  const body = parsedBody.value;
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "symbol")
  ) {
    return errorResponse(400, "INVALID_REQUEST", "标的验证请求格式无效。");
  }
  const requestedSymbol = normalizeSupportedSymbol(
    (body as Readonly<Record<string, unknown>>).symbol,
  );
  if (requestedSymbol === null) {
    return errorResponse(
      422,
      "INSTRUMENT_NOT_SUPPORTED",
      "请输入有效的美股或 ETF 代码。",
    );
  }

  const apiKeyId = serverEnvironmentValue("ALPACA_API_KEY_ID")?.trim();
  const apiSecretKey = serverEnvironmentValue("ALPACA_API_SECRET_KEY")?.trim();
  const tradingApiBaseUrl = serverEnvironmentValue(
    "ALPACA_TRADING_API_BASE_URL",
  );
  if (!apiKeyId || !apiSecretKey) {
    return errorResponse(
      503,
      "INSTRUMENT_SERVICE_NOT_CONFIGURED",
      "Alpaca 标的验证尚未配置。",
    );
  }

  let resolver: AlpacaInstrumentResolver;
  try {
    resolver = new AlpacaInstrumentResolver({
      apiKeyId,
      apiSecretKey,
      ...(tradingApiBaseUrl === undefined
        ? {}
        : {
            apiBaseUrl: tradingApiBaseUrl,
          }),
    });
  } catch {
    return errorResponse(
      503,
      "INSTRUMENT_SERVICE_NOT_CONFIGURED",
      "Alpaca 标的验证配置无效。",
    );
  }
  const result = await resolver.resolve(requestedSymbol);
  if (result.kind === "FOUND") {
    return response(
      {
        kind: "INSTRUMENT",
        instrument: result.instrument,
        displayName: result.displayName,
      },
      200,
    );
  }
  if (result.reason === "NOT_FOUND" || result.reason === "UNSUPPORTED") {
    return errorResponse(
      422,
      "INSTRUMENT_NOT_SUPPORTED",
      "Alpaca 未找到符合当前范围的标的，请核对股票代码。",
    );
  }
  return errorResponse(
    503,
    "INSTRUMENT_SERVICE_UNAVAILABLE",
    "Alpaca 标的验证暂时不可用，请稍后重试。",
  );
}
