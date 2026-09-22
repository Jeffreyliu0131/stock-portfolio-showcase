import { NextResponse } from "next/server";

import {
  MAX_QUOTE_REQUEST_INSTRUMENTS,
  type QuoteApiError,
  type QuoteApiResponse,
} from "@/application/market-data/quote-api";
import {
  InMemoryLastValidQuoteStore,
  refreshMarketData,
  type RefreshMarketDataResult,
} from "@/application/market-data";
import {
  callerKey,
  readBoundedJson,
} from "@/application/http/request-security";
import {
  providerCorsPreflight,
  requestIsAllowedProviderClient,
} from "@/application/http/provider-proxy-cors";
import { quoteRouteLimiter } from "@/application/http/public-route-rate-limiters";
import {
  ALPACA_DELAYED_SIP_FEED,
  AlpacaMarketCalendar,
  AlpacaMarketDataProvider,
  inferUsEquityMarketSession,
} from "@/application/market-data/server";
import { resolveSupportedInstrument } from "@/application/instruments";
import {
  instrumentKeyId,
  type InstrumentKey,
} from "@/domain/instrument";
import type { ResolvedQuote } from "@/domain/quotes";
import { compareRfc3339 } from "@/domain/time";
import { serverEnvironmentValue } from "@/application/runtime/server-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const lastValidQuotes = new InMemoryLastValidQuoteStore();
const MAX_REQUEST_BYTES = 32_768;

export function OPTIONS(request: Request): Response {
  return providerCorsPreflight(request, "POST");
}

function isAtLeastAsRecent(
  candidate: ResolvedQuote,
  current: ResolvedQuote,
): boolean {
  if (candidate.sourceEventAt === null) {
    return false;
  }
  if (current.sourceEventAt === null) {
    return true;
  }
  try {
    const sourceOrder = compareRfc3339(
      candidate.sourceEventAt,
      current.sourceEventAt,
    );
    if (sourceOrder !== 0) {
      return sourceOrder > 0;
    }
    if (candidate.fetchedAt === null) {
      return false;
    }
    return (
      current.fetchedAt === null ||
      compareRfc3339(candidate.fetchedAt, current.fetchedAt) >= 0
    );
  } catch {
    return false;
  }
}

function mergeOvernightReferenceCloses(
  overnightQuotes: readonly ResolvedQuote[],
  delayedSipQuotes: readonly ResolvedQuote[],
): readonly ResolvedQuote[] {
  const delayedSipByInstrument = new Map(
    delayedSipQuotes.map((quote) => [
      instrumentKeyId(quote.instrument),
      quote,
    ]),
  );

  return overnightQuotes.map((overnightQuote) => {
    const delayedSipQuote = delayedSipByInstrument.get(
      instrumentKeyId(overnightQuote.instrument),
    );
    const selectedQuote =
      delayedSipQuote !== undefined &&
      delayedSipQuote.effectivePrice !== null &&
      (overnightQuote.effectivePrice === null ||
        (!overnightQuote.acceptedCandidate &&
          isAtLeastAsRecent(delayedSipQuote, overnightQuote)))
        ? delayedSipQuote
        : overnightQuote;
    const previousRegularClose =
      delayedSipQuote?.previousRegularClose ?? null;
    if (
      selectedQuote.previousRegularClose === previousRegularClose
    ) {
      return selectedQuote;
    }
    return {
      ...selectedQuote,
      previousRegularClose,
    };
  });
}

function response(
  body: QuoteApiResponse,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<QuoteApiResponse> {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function errorResponse(
  status: number,
  code: QuoteApiError["code"],
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<QuoteApiResponse> {
  return response({ kind: "ERROR", code, message }, status, extraHeaders);
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

function requestedInstruments(body: unknown):
  | { readonly ok: true; readonly instruments: readonly InstrumentKey[] }
  | { readonly ok: false; readonly tooMany: boolean } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Array.isArray(
      (body as Readonly<Record<string, unknown>>).instruments,
    )
  ) {
    return { ok: false, tooMany: false };
  }

  const values = (body as { readonly instruments: readonly unknown[] })
    .instruments;
  if (values.length > MAX_QUOTE_REQUEST_INSTRUMENTS) {
    return { ok: false, tooMany: true };
  }

  const instruments: InstrumentKey[] = [];
  const instrumentKeys = new Set<string>();
  const keyBySymbol = new Map<string, string>();
  for (const value of values) {
    if (!hasExactInstrumentFields(value)) {
      return { ok: false, tooMany: false };
    }
    const resolved = resolveSupportedInstrument(value);
    if (!resolved.ok) {
      return { ok: false, tooMany: false };
    }
    const key = instrumentKeyId(resolved.instrument);
    const existingSymbolKey = keyBySymbol.get(resolved.instrument.symbol);
    if (
      instrumentKeys.has(key) ||
      (existingSymbolKey !== undefined && existingSymbolKey !== key)
    ) {
      return { ok: false, tooMany: false };
    }
    instrumentKeys.add(key);
    keyBySymbol.set(resolved.instrument.symbol, key);
    instruments.push(resolved.instrument);
  }
  return { ok: true, instruments };
}

export async function POST(
  request: Request,
): Promise<NextResponse<QuoteApiResponse>> {
  if (!requestIsAllowedProviderClient(request)) {
    return errorResponse(403, "INVALID_REQUEST", "行情请求来源无效。");
  }
  const rateLimit = quoteRouteLimiter.take(await callerKey(request));
  if (!rateLimit.allowed) {
    return errorResponse(429, "RATE_LIMITED", "行情请求较频繁，请稍后重试。", {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const parsedBody = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    if (parsedBody.reason === "UNSUPPORTED_MEDIA_TYPE") {
      return errorResponse(415, "INVALID_REQUEST", "行情请求格式无效。");
    }
    if (parsedBody.reason === "TOO_LARGE") {
      return errorResponse(413, "INVALID_REQUEST", "行情请求体过大。");
    }
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "行情请求格式无效。",
    );
  }

  const parsed = requestedInstruments(parsedBody.value);
  if (!parsed.ok) {
    return parsed.tooMany
      ? errorResponse(
          400,
          "TOO_MANY_INSTRUMENTS",
          `一次最多查询 ${MAX_QUOTE_REQUEST_INSTRUMENTS} 个标的。`,
        )
      : errorResponse(
          400,
          "INVALID_REQUEST",
          "标的必须是受支持的 USD 美国上市股票或 ETF。",
        );
  }

  if (parsed.instruments.length === 0) {
    return response(
      {
        kind: "QUOTES",
        generatedAt: new Date().toISOString(),
        quotes: [],
      },
      200,
    );
  }

  const requestedAt = new Date().toISOString();
  const apiKeyId = serverEnvironmentValue("ALPACA_API_KEY_ID")?.trim();
  const apiSecretKey = serverEnvironmentValue("ALPACA_API_SECRET_KEY")?.trim();
  const tradingApiBaseUrl = serverEnvironmentValue(
    "ALPACA_TRADING_API_BASE_URL",
  );
  if (!apiKeyId || !apiSecretKey) {
    return errorResponse(
      503,
      "MARKET_DATA_NOT_CONFIGURED",
      "延迟行情尚未配置；持仓真值仍保存在本机。",
    );
  }

  let marketSession = inferUsEquityMarketSession(requestedAt);
  try {
    const calendar = new AlpacaMarketCalendar({
      apiKeyId,
      apiSecretKey,
      ...(tradingApiBaseUrl === undefined
        ? {}
        : {
            apiBaseUrl: tradingApiBaseUrl,
          }),
    });
    marketSession = await calendar.getSession(requestedAt);
  } catch {
    // Calendar failures must not block a quote refresh. The standard New York
    // 24/5 schedule remains the fallback.
  }

  try {
    const provider = new AlpacaMarketDataProvider({
      apiKeyId,
      apiSecretKey,
    });
    const refreshRequest = {
      instruments: parsed.instruments,
      now: () => new Date().toISOString(),
      marketSession,
      closedSessionDataFinal:
        marketSession === "CLOSED" ||
        marketSession === "HOLIDAY",
    } as const;
    let result: RefreshMarketDataResult;
    if (marketSession === "OVERNIGHT") {
      const delayedSipProvider = new AlpacaMarketDataProvider({
        apiKeyId,
        apiSecretKey,
        feed: ALPACA_DELAYED_SIP_FEED,
      });
      const [overnight, delayedSip] = await Promise.all([
        refreshMarketData(refreshRequest, provider, lastValidQuotes),
        refreshMarketData(
          refreshRequest,
          delayedSipProvider,
          new InMemoryLastValidQuoteStore(),
        ),
      ]);
      result = {
        ...overnight,
        quotes: mergeOvernightReferenceCloses(
          overnight.quotes,
          delayedSip.quotes,
        ),
      };
    } else {
      result = await refreshMarketData(
        refreshRequest,
        provider,
        lastValidQuotes,
      );
    }
    return response(
      {
        kind: "QUOTES",
        generatedAt: new Date().toISOString(),
        quotes: result.quotes,
      },
      200,
    );
  } catch {
    return errorResponse(
      503,
      "MARKET_DATA_UNAVAILABLE",
      "延迟行情暂时不可用；请稍后重试。",
    );
  }
}
