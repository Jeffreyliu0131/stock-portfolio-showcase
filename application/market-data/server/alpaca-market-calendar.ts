import type { MarketSession } from "../../../domain/quotes.ts";
import {
  inferUsEquityMarketSession,
  newYorkMarketTime,
} from "./us-market-session.ts";

const DEFAULT_BASE_URL = "https://paper-api.alpaca.markets";
const ALLOWED_ORIGINS = new Set([
  "https://paper-api.alpaca.markets",
  "https://api.alpaca.markets",
]);
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 65_536;
const REGULAR_CLOSE_MINUTE = 16 * 60;
const EXTENDED_CLOSE_MINUTE = 20 * 60;

export interface AlpacaMarketCalendarHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type AlpacaMarketCalendarFetch = (
  input: string,
  init: RequestInit,
) => Promise<AlpacaMarketCalendarHttpResponse>;

export interface AlpacaMarketCalendarOptions {
  readonly apiKeyId: string;
  readonly apiSecretKey: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: AlpacaMarketCalendarFetch;
  readonly timeoutMs?: number;
}

interface TradingDay {
  readonly date: string;
  readonly openMinute: number;
  readonly closeMinute: number;
}

function credential(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function baseUrl(value: string | undefined): URL {
  const url = new URL(value ?? DEFAULT_BASE_URL);
  if (
    !ALLOWED_ORIGINS.has(url.origin) ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("Alpaca trading API base URL is not allowed");
  }
  return url;
}

function clockMinute(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function parseCalendar(source: string): ReadonlyMap<string, TradingDay> | null {
  if (new TextEncoder().encode(source).byteLength > MAX_RESPONSE_BYTES) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > 4) {
    return null;
  }

  const days = new Map<string, TradingDay>();
  for (const value of parsed) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return null;
    }
    const record = value as Readonly<Record<string, unknown>>;
    const date = record.date;
    const openMinute = clockMinute(record.open);
    const closeMinute = clockMinute(record.close);
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      openMinute === null ||
      closeMinute === null ||
      openMinute >= closeMinute ||
      days.has(date)
    ) {
      return null;
    }
    days.set(date, { date, openMinute, closeMinute });
  }
  return days;
}

function calendarSession(
  instant: string,
  calendar: ReadonlyMap<string, TradingDay>,
): MarketSession {
  const marketTime = newYorkMarketTime(instant);
  if (marketTime === null) {
    return "UNKNOWN";
  }
  const fallback = inferUsEquityMarketSession(instant);
  const { date, nextDate, minuteOfDay } = marketTime;

  if (fallback === "OVERNIGHT") {
    const tradingDate = minuteOfDay < 4 * 60 ? date : nextDate;
    return calendar.has(tradingDate) ? "OVERNIGHT" : "CLOSED";
  }

  const tradingDay = calendar.get(date);
  if (tradingDay === undefined) {
    return fallback === "CLOSED" ? "CLOSED" : "HOLIDAY";
  }
  if (minuteOfDay < tradingDay.openMinute) {
    return minuteOfDay >= 4 * 60 ? "PRE_MARKET" : "OVERNIGHT";
  }
  if (minuteOfDay < tradingDay.closeMinute) {
    return "REGULAR";
  }
  if (
    tradingDay.closeMinute === REGULAR_CLOSE_MINUTE &&
    minuteOfDay < EXTENDED_CLOSE_MINUTE
  ) {
    return "AFTER_HOURS";
  }
  if (minuteOfDay >= EXTENDED_CLOSE_MINUTE) {
    return calendar.has(nextDate) ? "OVERNIGHT" : "CLOSED";
  }
  return "CLOSED";
}

export class AlpacaMarketCalendar {
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly apiBaseUrl: URL;
  private readonly fetchImpl: AlpacaMarketCalendarFetch;
  private readonly timeoutMs: number;

  constructor(options: AlpacaMarketCalendarOptions) {
    if (typeof window !== "undefined") {
      throw new Error("AlpacaMarketCalendar can only run on the server");
    }
    this.apiKeyId = credential(
      options.apiKeyId,
      "Alpaca API key ID",
    );
    this.apiSecretKey = credential(
      options.apiSecretKey,
      "Alpaca API secret key",
    );
    this.apiBaseUrl = baseUrl(options.apiBaseUrl);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 60_000
    ) {
      throw new Error("timeoutMs must be from 1 to 60000");
    }
  }

  async getSession(instant: string): Promise<MarketSession> {
    const fallback = inferUsEquityMarketSession(instant);
    const marketTime = newYorkMarketTime(instant);
    if (marketTime === null) {
      return "UNKNOWN";
    }

    const url = new URL("/v2/calendar", this.apiBaseUrl);
    url.searchParams.set("start", marketTime.date);
    url.searchParams.set("end", marketTime.nextDate);
    url.searchParams.set("date_type", "TRADING");
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "APCA-API-KEY-ID": this.apiKeyId,
          "APCA-API-SECRET-KEY": this.apiSecretKey,
        },
        signal: controller.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        return fallback;
      }
      const calendar = parseCalendar(await response.text());
      return calendar === null
        ? fallback
        : calendarSession(instant, calendar);
    } catch {
      return fallback;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}
