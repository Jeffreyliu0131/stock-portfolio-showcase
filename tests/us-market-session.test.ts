import { describe, expect, it } from "vitest";

import {
  inferUsEquityMarketSession,
  newYorkMarketTime,
} from "../application/market-data/server/us-market-session.ts";

describe("inferUsEquityMarketSession", () => {
  it("classifies the full standard 24/5 New York trading day", () => {
    expect(inferUsEquityMarketSession("2026-08-03T07:59:59Z")).toBe(
      "OVERNIGHT",
    );
    expect(inferUsEquityMarketSession("2026-08-03T08:00:00Z")).toBe(
      "PRE_MARKET",
    );
    expect(inferUsEquityMarketSession("2026-08-03T13:30:00Z")).toBe(
      "REGULAR",
    );
    expect(inferUsEquityMarketSession("2026-08-03T19:59:59Z")).toBe(
      "REGULAR",
    );
    expect(inferUsEquityMarketSession("2026-08-03T20:00:00Z")).toBe(
      "AFTER_HOURS",
    );
    expect(inferUsEquityMarketSession("2026-08-04T00:00:00Z")).toBe(
      "OVERNIGHT",
    );
  });

  it("opens Sunday evening and closes after Friday after-hours", () => {
    expect(inferUsEquityMarketSession("2026-08-02T23:59:59Z")).toBe(
      "CLOSED",
    );
    expect(inferUsEquityMarketSession("2026-08-03T00:00:00Z")).toBe(
      "OVERNIGHT",
    );
    expect(inferUsEquityMarketSession("2026-08-01T00:00:00Z")).toBe(
      "CLOSED",
    );
    expect(inferUsEquityMarketSession("2026-08-01T07:00:00Z")).toBe(
      "CLOSED",
    );
  });

  it("returns unknown for malformed input and exposes calendar dates", () => {
    expect(inferUsEquityMarketSession("not-a-date")).toBe("UNKNOWN");
    expect(newYorkMarketTime("2026-08-03T01:00:00Z")).toEqual({
      date: "2026-08-02",
      nextDate: "2026-08-03",
      weekday: "Sun",
      minuteOfDay: 21 * 60,
    });
  });
});
