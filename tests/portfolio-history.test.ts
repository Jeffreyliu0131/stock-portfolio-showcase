import { describe, expect, it } from "vitest";

import {
  createHistoricalReturnSeries,
  historicalRangeStart,
} from "../domain/portfolio-history.ts";

const START = "2026-01-01T00:00:00Z";
const MIDDLE = "2026-01-06T00:00:00Z";
const END = "2026-01-11T00:00:00Z";

describe("cash-flow-adjusted historical portfolio returns", () => {
  it("calculates an exact no-flow Modified Dietz return", () => {
    expect(
      createHistoricalReturnSeries({
        range: "ALL",
        now: END,
        observations: [
          { observedAt: START, valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
          { observedAt: END, valueUsd: "110", coverageComplete: true, sourceScopeCount: 1 },
        ],
        flows: [],
      }),
    ).toEqual({
      status: "READY",
      basis: "MODIFIED_DIETZ",
      range: "ALL",
      rangeReturnRate: "0.1",
      rangeFlowAdjustedChange: "10",
      segmentCount: 1,
      points: [
        {
          sourceEventAt: START,
          actualNav: "100",
          flowAdjustedChange: "0",
          returnRate: "0",
          connectFromPrevious: false,
        },
        {
          sourceEventAt: END,
          actualNav: "110",
          flowAdjustedChange: "10",
          returnRate: "0.1",
          connectFromPrevious: true,
        },
      ],
    });
  });

  it("excludes a mid-period deposit from performance", () => {
    const result = createHistoricalReturnSeries({
      range: "ALL",
      now: END,
      observations: [
        { observedAt: START, valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: END, valueUsd: "160", coverageComplete: true, sourceScopeCount: 1 },
      ],
      flows: [{ occurredAt: MIDDLE, amountUsd: "50" }],
    });

    expect(result).toMatchObject({
      status: "READY",
      rangeReturnRate: "0.08",
      rangeFlowAdjustedChange: "8",
    });
  });

  it("uses the signed withdrawal in both numerator and weighted capital", () => {
    const result = createHistoricalReturnSeries({
      range: "ALL",
      now: END,
      observations: [
        { observedAt: START, valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: END, valueUsd: "70", coverageComplete: true, sourceScopeCount: 1 },
      ],
      flows: [{ occurredAt: MIDDLE, amountUsd: "-40" }],
    });

    expect(result).toMatchObject({
      status: "READY",
      rangeReturnRate: "0.125",
      rangeFlowAdjustedChange: "12.5",
    });
  });

  it("chain-links adjacent period returns without summing them", () => {
    const result = createHistoricalReturnSeries({
      range: "ALL",
      now: "2026-01-21T00:00:00Z",
      observations: [
        { observedAt: START, valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: END, valueUsd: "110", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: "2026-01-21T00:00:00Z", valueUsd: "99", coverageComplete: true, sourceScopeCount: 1 },
      ],
      flows: [],
    });

    expect(result).toMatchObject({
      status: "READY",
      rangeReturnRate: "-0.01",
      rangeFlowAdjustedChange: "-1",
    });
  });

  it("breaks a real gap and refuses to report a complete range return", () => {
    const result = createHistoricalReturnSeries({
      range: "ALL",
      now: "2026-04-20T00:00:00Z",
      maximumConnectedGapDays: 40,
      observations: [
        { observedAt: START, valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: END, valueUsd: "110", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: "2026-04-20T00:00:00Z", valueUsd: "120", coverageComplete: true, sourceScopeCount: 1 },
      ],
      flows: [],
    });

    expect(result).toMatchObject({
      status: "PARTIAL",
      rangeReturnRate: null,
      rangeFlowAdjustedChange: null,
      segmentCount: 2,
      points: [
        {},
        { connectFromPrevious: true },
        { connectFromPrevious: false },
      ],
    });
  });

  it("blocks an interval with an unknown external cash classification", () => {
    expect(
      createHistoricalReturnSeries({
        range: "1Y",
        now: END,
        observations: [
          { observedAt: START, valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
          { observedAt: END, valueUsd: "110", coverageComplete: true, sourceScopeCount: 1 },
        ],
        flows: [],
        hasUnknownExternalFlow: true,
      }),
    ).toEqual({
      status: "UNAVAILABLE",
      basis: "MODIFIED_DIETZ",
      range: "1Y",
      reason: "UNKNOWN_EXTERNAL_FLOW",
      points: [],
    });
  });

  it("uses a real observation immediately before the selected range as baseline", () => {
    const result = createHistoricalReturnSeries({
      range: "1W",
      now: END,
      observations: [
        { observedAt: START, valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: "2026-01-05T00:00:00Z", valueUsd: "102", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: END, valueUsd: "110", coverageComplete: true, sourceScopeCount: 1 },
      ],
      flows: [],
    });

    expect(result.status).toBe("READY");
    if (result.status === "READY") {
      expect(result.points[0]?.sourceEventAt).toBe(START);
      expect(result.rangeReturnRate).toBe("0.1");
    }
    expect(historicalRangeStart("1W", END)).toBe("2026-01-04T00:00:00.000Z");
    expect(historicalRangeStart("1M", "2026-03-31T12:00:00Z")).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    expect(historicalRangeStart("1Y", "2028-02-29T12:00:00Z")).toBe(
      "2027-02-28T12:00:00.000Z",
    );
  });

  it("marks a fixed range partial when NAV starts well after its boundary", () => {
    const result = createHistoricalReturnSeries({
      range: "1M",
      now: "2026-08-31T21:00:00Z",
      observations: [
        { observedAt: "2026-07-01T21:00:00Z", valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: "2026-08-15T21:00:00Z", valueUsd: "105", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: "2026-08-31T21:00:00Z", valueUsd: "110", coverageComplete: true, sourceScopeCount: 1 },
      ],
      flows: [],
    });

    expect(result).toMatchObject({
      status: "PARTIAL",
      rangeReturnRate: null,
      rangeFlowAdjustedChange: null,
      points: [
        { sourceEventAt: "2026-08-15T21:00:00Z", connectFromPrevious: false },
        { sourceEventAt: "2026-08-31T21:00:00Z", connectFromPrevious: true },
      ],
    });
  });

  it("marks a fixed range partial when its latest NAV is stale", () => {
    const result = createHistoricalReturnSeries({
      range: "1M",
      now: "2026-08-31T21:00:00Z",
      observations: [
        { observedAt: "2026-07-31T21:00:00Z", valueUsd: "100", coverageComplete: true, sourceScopeCount: 1 },
        { observedAt: "2026-08-20T21:00:00Z", valueUsd: "110", coverageComplete: true, sourceScopeCount: 1 },
      ],
      flows: [],
    });

    expect(result).toMatchObject({
      status: "PARTIAL",
      rangeReturnRate: null,
      rangeFlowAdjustedChange: null,
    });
  });

  it("draws a nearby monthly partial segment without joining it to a different coverage set", () => {
    const result = createHistoricalReturnSeries({
      range: "1M",
      now: "2026-08-11T21:00:00Z",
      observations: [
        {
          observedAt: "2026-06-30T21:00:00Z",
          valueUsd: "100",
          coverageComplete: false,
          sourceScopeCount: 1,
          sourceCoverageKey: "PARTIAL:moomoo",
        },
        {
          observedAt: "2026-07-31T21:00:00Z",
          valueUsd: "110",
          coverageComplete: false,
          sourceScopeCount: 1,
          sourceCoverageKey: "PARTIAL:moomoo",
        },
        {
          observedAt: "2026-08-11T21:00:00Z",
          valueUsd: "250",
          coverageComplete: true,
          sourceScopeCount: 1,
          sourceCoverageKey: "PORTFOLIO:all",
        },
      ],
      flows: [],
    });

    expect(result).toMatchObject({
      status: "PARTIAL",
      rangeReturnRate: null,
      rangeFlowAdjustedChange: null,
      points: [
        { sourceEventAt: "2026-06-30T21:00:00Z", connectFromPrevious: false },
        { sourceEventAt: "2026-07-31T21:00:00Z", connectFromPrevious: true },
        { sourceEventAt: "2026-08-11T21:00:00Z", connectFromPrevious: false },
      ],
    });
  });
});
