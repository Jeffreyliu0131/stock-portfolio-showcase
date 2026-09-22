import { Decimal, compareRfc3339 } from "../../domain/index.ts";
import type {
  HistoricalExternalFlow,
  HistoricalNavObservation,
} from "../../domain/index.ts";
import type {
  HistoryNavSnapshotEvent,
  PortfolioHistoryEvent,
  PortfolioHistoryTrendInputs,
} from "./types.ts";

interface ScopeWindow {
  readonly firstDate: string;
}

function eventDate(value: string): string {
  return value.slice(0, 10);
}

function accountScopeWindows(
  values: readonly HistoryNavSnapshotEvent[],
): ReadonlyMap<string, ScopeWindow> {
  const result = new Map<string, ScopeWindow>();
  for (const value of values) {
    if (value.scopeKind !== "ACCOUNT") {
      continue;
    }
    const date = eventDate(value.occurredAt);
    const existing = result.get(value.sourceScopeHash);
    result.set(value.sourceScopeHash, {
      firstDate:
        existing === undefined || date < existing.firstDate
          ? date
          : existing.firstDate,
    });
  }
  return result;
}

function consolidateNav(
  events: readonly PortfolioHistoryEvent[],
): readonly HistoricalNavObservation[] {
  const nav = events
    .filter((event): event is HistoryNavSnapshotEvent => event.type === "NAV_SNAPSHOT")
    .toSorted((left, right) => compareRfc3339(left.occurredAt, right.occurredAt));
  const windows = accountScopeWindows(nav);
  const byDate = new Map<string, HistoryNavSnapshotEvent[]>();
  for (const value of nav) {
    const date = eventDate(value.occurredAt);
    const group = byDate.get(date) ?? [];
    group.push(value);
    byDate.set(date, group);
  }

  const result: HistoricalNavObservation[] = [];
  for (const [date, group] of [...byDate.entries()].toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const total = group
      .filter((value) => value.scopeKind === "PORTFOLIO_TOTAL")
      .at(-1);
    if (total !== undefined) {
      const requiredScopes = [...windows.entries()]
        .filter(([, window]) => date >= window.firstDate)
        .map(([scope]) => scope)
        .toSorted();
      result.push({
        observedAt: total.occurredAt,
        valueUsd: total.valueUsd,
        coverageComplete: total.coverage === "COMPLETE",
        sourceScopeCount: Math.max(1, requiredScopes.length),
        sourceCoverageKey: `PORTFOLIO:${requiredScopes.join("|") || "LOCAL"}`,
      });
      continue;
    }

    const requiredScopes = [...windows.entries()]
      .filter(([, window]) => date >= window.firstDate)
      .map(([scope]) => scope);
    const accountByScope = new Map(
      group
        .filter((value) => value.scopeKind === "ACCOUNT")
        .map((value) => [value.sourceScopeHash, value]),
    );
    if (accountByScope.size === 0) {
      continue;
    }
    let totalValue = new Decimal(0);
    let latestAt = group[0]?.occurredAt ?? `${date}T21:00:00Z`;
    let recordsComplete = true;
    for (const value of accountByScope.values()) {
      totalValue = totalValue.add(value.valueUsd);
      recordsComplete &&= value.coverage === "COMPLETE";
      if (compareRfc3339(value.occurredAt, latestAt) > 0) {
        latestAt = value.occurredAt;
      }
    }
    const hasAllRequired = requiredScopes.every((scope) => accountByScope.has(scope));
    const actualScopes = [...accountByScope.keys()].toSorted();
    const coverageComplete = hasAllRequired && recordsComplete;
    result.push({
      observedAt: latestAt,
      valueUsd: totalValue.toString(),
      coverageComplete,
      sourceScopeCount: Math.max(1, requiredScopes.length),
      sourceCoverageKey: coverageComplete
        ? `PORTFOLIO:${requiredScopes.toSorted().join("|")}`
        : `PARTIAL:${actualScopes.join("|")}`,
    });
  }
  return result;
}

export function createPortfolioHistoryTrendInputs(
  events: readonly PortfolioHistoryEvent[],
): PortfolioHistoryTrendInputs {
  const flows: HistoricalExternalFlow[] = events
    .filter((event) => event.type === "EXTERNAL_FLOW")
    .map((event) => ({
      occurredAt: event.occurredAt,
      amountUsd: event.amountUsd,
    }));
  return {
    observations: consolidateNav(events),
    flows,
    hasUnknownExternalFlow: false,
  };
}
