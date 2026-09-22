import { describe, expect, it } from "vitest";

import { createPortfolioHistoryTrendInputs } from "../application/history/portfolio-history-series.ts";
import type { HistoryNavSnapshotEvent } from "../application/history/types.ts";

function accountNav(
  scope: string,
  date: string,
  valueUsd: string,
): HistoryNavSnapshotEvent {
  return {
    id: `nav:${scope.slice(0, 4)}:${date}`,
    type: "NAV_SNAPSHOT",
    source: "IBKR",
    sourceScopeHash: scope,
    occurredAt: `${date}T21:00:00Z`,
    recordedAt: "2026-08-11T00:00:00Z",
    scopeKind: "ACCOUNT",
    valueUsd,
    sourceCurrency: "USD",
    sourceValue: valueUsd,
    fxRateToUsd: "1",
    coverage: "COMPLETE",
  };
}

describe("whole-portfolio NAV consolidation", () => {
  it("sums every active broker scope only on dates with complete coverage", () => {
    const first = "a".repeat(64);
    const second = "b".repeat(64);
    const inputs = createPortfolioHistoryTrendInputs([
      accountNav(first, "2026-06-30", "100"),
      accountNav(first, "2026-07-31", "110"),
      accountNav(second, "2026-06-30", "200"),
      accountNav(second, "2026-07-31", "220"),
    ]);

    expect(inputs.observations).toEqual([
      {
        observedAt: "2026-06-30T21:00:00Z",
        valueUsd: "300",
        coverageComplete: true,
        sourceScopeCount: 2,
        sourceCoverageKey: `PORTFOLIO:${first}|${second}`,
      },
      {
        observedAt: "2026-07-31T21:00:00Z",
        valueUsd: "330",
        coverageComplete: true,
        sourceScopeCount: 2,
        sourceCoverageKey: `PORTFOLIO:${first}|${second}`,
      },
    ]);
  });

  it("marks an overlapping month partial when one active source is missing", () => {
    const first = "a".repeat(64);
    const second = "b".repeat(64);
    const inputs = createPortfolioHistoryTrendInputs([
      accountNav(first, "2026-05-31", "100"),
      accountNav(first, "2026-06-30", "110"),
      accountNav(first, "2026-07-31", "120"),
      accountNav(second, "2026-05-31", "200"),
      accountNav(second, "2026-07-31", "230"),
    ]);

    expect(inputs.observations[1]).toMatchObject({
      observedAt: "2026-06-30T21:00:00Z",
      valueUsd: "110",
      coverageComplete: false,
      sourceScopeCount: 2,
    });
  });

  it("keeps a known account in coverage after its latest imported month", () => {
    const first = "a".repeat(64);
    const second = "b".repeat(64);
    const inputs = createPortfolioHistoryTrendInputs([
      accountNav(first, "2026-06-30", "100"),
      accountNav(first, "2026-07-31", "110"),
      accountNav(second, "2026-06-30", "200"),
      accountNav(second, "2026-07-31", "220"),
      accountNav(first, "2026-08-31", "120"),
    ]);

    expect(inputs.observations.at(-1)).toMatchObject({
      observedAt: "2026-08-31T21:00:00Z",
      valueUsd: "120",
      coverageComplete: false,
      sourceScopeCount: 2,
    });
  });
});
