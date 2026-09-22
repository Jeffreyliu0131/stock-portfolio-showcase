import type { MarketSession } from "../../../domain/quotes.ts";

const NEW_YORK_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface NewYorkMarketTime {
  readonly date: string;
  readonly nextDate: string;
  readonly weekday: string;
  readonly minuteOfDay: number;
}

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const OVERNIGHT_EVENINGS = new Set(["Sun", "Mon", "Tue", "Wed", "Thu"]);

function nextDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid New York date");
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function newYorkMarketTime(
  instant: string,
): NewYorkMarketTime | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Map(
    NEW_YORK_PARTS.formatToParts(date).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const weekday = parts.get("weekday");
  const hour = Number(parts.get("hour"));
  const minute = Number(parts.get("minute"));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    weekday === undefined ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }
  const marketDate = `${year}-${month}-${day}`;
  return {
    date: marketDate,
    nextDate: nextDate(marketDate),
    weekday,
    minuteOfDay: hour * 60 + minute,
  };
}

/**
 * Standard 24/5 US equity sessions. Alpaca's calendar resolver overrides this
 * fallback on holidays and early-close days.
 */
export function inferUsEquityMarketSession(
  instant: string,
): MarketSession {
  const marketTime = newYorkMarketTime(instant);
  if (marketTime === null) {
    return "UNKNOWN";
  }
  const { minuteOfDay, weekday } = marketTime;

  if (minuteOfDay < 4 * 60) {
    return WEEKDAYS.has(weekday) ? "OVERNIGHT" : "CLOSED";
  }
  if (!WEEKDAYS.has(weekday)) {
    return minuteOfDay >= 20 * 60 &&
      OVERNIGHT_EVENINGS.has(weekday)
      ? "OVERNIGHT"
      : "CLOSED";
  }
  if (minuteOfDay < 9 * 60 + 30) {
    return "PRE_MARKET";
  }
  if (minuteOfDay < 16 * 60) {
    return "REGULAR";
  }
  if (minuteOfDay < 20 * 60) {
    return "AFTER_HOURS";
  }
  return OVERNIGHT_EVENINGS.has(weekday) ? "OVERNIGHT" : "CLOSED";
}
