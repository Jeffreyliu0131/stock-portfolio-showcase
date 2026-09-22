import { NextResponse } from "next/server";

import {
  INTRADAY_BAR_ADJUSTMENT,
  INTRADAY_BAR_DELAY_MINUTES,
  INTRADAY_BAR_PROVIDER,
  INTRADAY_BAR_SOURCE_FEED,
  INTRADAY_BAR_TIMEFRAME,
  MAX_INTRADAY_BAR_REQUEST_INSTRUMENTS,
  type IntradayBarsApiError,
  type IntradayBarsApiResponse,
} from "@/application/market-data/intraday-bars-api";
import { AlpacaIntradayBarsProvider } from "@/application/market-data/server/alpaca-intraday-bars-provider";
import { resolveSupportedInstrument } from "@/application/instruments";
import {
  callerKey,
  readBoundedJson,
} from "@/application/http/request-security";
import {
  providerCorsPreflight,
  requestIsAllowedProviderClient,
} from "@/application/http/provider-proxy-cors";
import { intradayBarsRouteLimiter } from "@/application/http/public-route-rate-limiters";
import {
  DomainValidationError,
  instrumentKeyId,
  rfc3339ToEpochNanoseconds,
  type InstrumentKey,
} from "@/domain";
import { serverEnvironmentValue } from "@/application/runtime/server-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 32_768;
const MINUTE_MS = 60_000;

export function OPTIONS(request: Request): Response {
  return providerCorsPreflight(request, "POST");
}

interface ParsedRequest {
  readonly instruments: readonly InstrumentKey[];
  readonly asOf?: string;
}

type RequestParseResult =
  | { readonly ok: true; readonly value: ParsedRequest }
  | {
      readonly ok: false;
      readonly code: "INVALID_REQUEST" | "TOO_MANY_INSTRUMENTS";
    };

function response(
  body: IntradayBarsApiResponse,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<IntradayBarsApiResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function errorResponse(
  status: number,
  code: IntradayBarsApiError["code"],
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<IntradayBarsApiResponse> {
  return response({ kind: "ERROR", code, message }, status, extraHeaders);
}

function validAsOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    rfc3339ToEpochNanoseconds(value, "intradayBars.asOf");
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return null;
    }
    throw error;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hasExactInstrumentFields(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    keys.includes("listingMarket") &&
    keys.includes("symbol") &&
    keys.includes("currency")
  );
}

function parseRequest(body: unknown): RequestParseResult {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  const record = body as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).some(
      (key) => key !== "instruments" && key !== "asOf",
    ) ||
    !Array.isArray(record.instruments)
  ) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  if (
    record.instruments.length > MAX_INTRADAY_BAR_REQUEST_INSTRUMENTS
  ) {
    return { ok: false, code: "TOO_MANY_INSTRUMENTS" };
  }

  const asOf = record.asOf === undefined ? undefined : validAsOf(record.asOf);
  if (record.asOf !== undefined && asOf === null) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const instruments: InstrumentKey[] = [];
  const instrumentKeys = new Set<string>();
  const keyBySymbol = new Map<string, string>();
  for (const value of record.instruments) {
    if (!hasExactInstrumentFields(value)) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    const resolved = resolveSupportedInstrument(value);
    if (!resolved.ok) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    const key = instrumentKeyId(resolved.instrument);
    const existingSymbolKey = keyBySymbol.get(resolved.instrument.symbol);
    if (
      instrumentKeys.has(key) ||
      (existingSymbolKey !== undefined && existingSymbolKey !== key)
    ) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    instrumentKeys.add(key);
    keyBySymbol.set(resolved.instrument.symbol, key);
    instruments.push(resolved.instrument);
  }
  return {
    ok: true,
    value: {
      instruments,
      ...(typeof asOf === "string" ? { asOf } : {}),
    },
  };
}

function emptyResponse(request: ParsedRequest): IntradayBarsApiResponse {
  const generatedAt = new Date().toISOString();
  const requested = new Date(request.asOf ?? generatedAt);
  const cutoff = new Date(
    new Date(generatedAt).getTime() -
      INTRADAY_BAR_DELAY_MINUTES * MINUTE_MS,
  );
  const availableThrough = new Date(
    Math.min(requested.getTime(), cutoff.getTime()),
  ).toISOString();
  return {
    kind: "INTRADAY_BARS",
    generatedAt,
    requestedAsOf: requested.toISOString(),
    windowStartAt: availableThrough,
    availableThrough,
    provider: INTRADAY_BAR_PROVIDER,
    sourceFeed: INTRADAY_BAR_SOURCE_FEED,
    delayPolicy: "AT_LEAST_15_MINUTES",
    delayMinutes: INTRADAY_BAR_DELAY_MINUTES,
    timeframe: INTRADAY_BAR_TIMEFRAME,
    adjustment: INTRADAY_BAR_ADJUSTMENT,
    series: [],
  };
}

export async function POST(
  request: Request,
): Promise<NextResponse<IntradayBarsApiResponse>> {
  if (!requestIsAllowedProviderClient(request)) {
    return errorResponse(403, "INVALID_REQUEST", "日内走势请求来源无效。");
  }
  const rateLimit = intradayBarsRouteLimiter.take(await callerKey(request));
  if (!rateLimit.allowed) {
    return errorResponse(429, "RATE_LIMITED", "日内走势请求较频繁，请稍后重试。", {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const parsedBody = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    if (parsedBody.reason === "UNSUPPORTED_MEDIA_TYPE") {
      return errorResponse(415, "INVALID_REQUEST", "日内走势请求格式无效。");
    }
    if (parsedBody.reason === "TOO_LARGE") {
      return errorResponse(413, "INVALID_REQUEST", "日内走势请求体过大。");
    }
    return errorResponse(400, "INVALID_REQUEST", "日内走势请求格式无效。");
  }
  const parsed = parseRequest(parsedBody.value);
  if (!parsed.ok) {
    return parsed.code === "TOO_MANY_INSTRUMENTS"
      ? errorResponse(
          400,
          parsed.code,
          `一次最多查询 ${MAX_INTRADAY_BAR_REQUEST_INSTRUMENTS} 个标的。`,
        )
      : errorResponse(
          400,
          parsed.code,
          "请求只能包含受支持的标的和可选 asOf，不得包含数量、成本或现金。",
        );
  }
  if (parsed.value.instruments.length === 0) {
    return response(emptyResponse(parsed.value), 200);
  }

  const apiKeyId = serverEnvironmentValue("ALPACA_API_KEY_ID")?.trim();
  const apiSecretKey = serverEnvironmentValue("ALPACA_API_SECRET_KEY")?.trim();
  if (!apiKeyId || !apiSecretKey) {
    return errorResponse(
      503,
      "MARKET_DATA_NOT_CONFIGURED",
      "日内走势行情尚未配置；持仓真值仍保存在本机。",
    );
  }

  const provider = new AlpacaIntradayBarsProvider({
    apiKeyId,
    apiSecretKey,
  });
  const result = await provider.getBars({
    instruments: parsed.value.instruments,
    ...(parsed.value.asOf === undefined
      ? {}
      : { asOf: parsed.value.asOf }),
  });
  if (result.kind === "BATCH_FAILURE") {
    if (result.fetchStatus === "RATE_LIMITED") {
      return errorResponse(
        429,
        "RATE_LIMITED",
        "日内走势请求过于频繁，请稍后重试。",
      );
    }
    if (result.fetchStatus === "UNAUTHORIZED") {
      return errorResponse(
        503,
        "UNAUTHORIZED",
        "日内走势行情暂时无权访问。",
      );
    }
    return errorResponse(
      503,
      "MARKET_DATA_UNAVAILABLE",
      "日内走势行情暂时不可用；当前持仓与估值不受影响。",
    );
  }
  return response(
    {
      kind: "INTRADAY_BARS",
      generatedAt: result.generatedAt,
      requestedAsOf: result.requestedAsOf,
      windowStartAt: result.windowStartAt,
      availableThrough: result.availableThrough,
      provider: result.provider,
      sourceFeed: result.sourceFeed,
      delayPolicy: result.delayPolicy,
      delayMinutes: result.delayMinutes,
      timeframe: result.timeframe,
      adjustment: result.adjustment,
      series: result.series,
    },
    200,
  );
}
