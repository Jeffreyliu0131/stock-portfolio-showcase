import type { InstrumentKey } from "../../../domain/instrument.ts";
import type { ResolvedQuote } from "../../../domain/quotes.ts";
import {
  MAX_QUOTE_REQUEST_INSTRUMENTS,
  type QuoteApiErrorCode,
} from "../quote-api.ts";
import {
  isVercelProviderUrl,
  providerApiUrl,
} from "../../http/provider-proxy-contract.ts";

export class QuoteClientError extends Error {
  readonly code: QuoteApiErrorCode | "INVALID_RESPONSE";

  constructor(
    code: QuoteApiErrorCode | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "QuoteClientError";
    this.code = code;
  }
}

export type QuoteFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface DelayedQuoteBatch {
  readonly generatedAt: string;
  readonly quotes: readonly ResolvedQuote[];
}

export async function requestDelayedQuotes(
  instruments: readonly InstrumentKey[],
  fetchImpl: QuoteFetch = globalThis.fetch,
): Promise<DelayedQuoteBatch> {
  if (instruments.length > MAX_QUOTE_REQUEST_INSTRUMENTS) {
    throw new QuoteClientError(
      "TOO_MANY_INSTRUMENTS",
      `一次最多查询 ${MAX_QUOTE_REQUEST_INSTRUMENTS} 个标的。`,
    );
  }

  let response: Response;
  try {
    const url = providerApiUrl("/api/quotes");
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ instruments }),
      cache: "no-store",
      ...(isVercelProviderUrl(url) ? { credentials: "omit" } : {}),
    });
  } catch {
    throw new QuoteClientError(
      "MARKET_DATA_UNAVAILABLE",
      "无法连接延迟行情服务。",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new QuoteClientError(
      "INVALID_RESPONSE",
      "延迟行情服务返回了无效响应。",
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw new QuoteClientError(
      "INVALID_RESPONSE",
      "延迟行情服务返回了无效响应。",
    );
  }
  const record = body as Readonly<Record<string, unknown>>;
  if (
    response.ok &&
    record.kind === "QUOTES" &&
    typeof record.generatedAt === "string" &&
    Array.isArray(record.quotes)
  ) {
    return {
      generatedAt: record.generatedAt,
      quotes: record.quotes as readonly ResolvedQuote[],
    };
  }

  if (
    record.kind === "ERROR" &&
    typeof record.code === "string" &&
    typeof record.message === "string"
  ) {
    throw new QuoteClientError(
      record.code as QuoteApiErrorCode,
      record.message,
    );
  }
  throw new QuoteClientError(
    "INVALID_RESPONSE",
    "延迟行情服务返回了无效响应。",
  );
}
