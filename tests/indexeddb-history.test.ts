import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  IndexedDbPortfolioHistoryRepository,
  type HistoryImportCandidate,
  type PortfolioHistoryEvent,
} from "../application/history/index.ts";
import { IndexedDbPositionRepository } from "../application/positions/index.ts";
import { AAPL } from "./helpers.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SCOPE = "c".repeat(64);

function nav(valueUsd = "100", id = "nav:synthetic"): PortfolioHistoryEvent {
  return {
    id,
    type: "NAV_SNAPSHOT",
    source: "IBKR",
    sourceScopeHash: SCOPE,
    occurredAt: "2026-01-01T21:00:00Z",
    recordedAt: "2026-08-11T00:00:00Z",
    scopeKind: "ACCOUNT",
    valueUsd,
    sourceCurrency: "USD",
    sourceValue: valueUsd,
    fxRateToUsd: "1",
    coverage: "COMPLETE",
  };
}

function candidate(hash: string, event: PortfolioHistoryEvent): HistoryImportCandidate {
  return {
    document: {
      importId: hash,
      fileSha256: hash,
      broker: "IBKR",
      detectedFormat: "CSV",
      pageCount: null,
      importedAt: "2026-08-11T00:00:00Z",
      periodStart: event.occurredAt,
      periodEnd: event.occurredAt,
      eventCount: 1,
    },
    events: [event],
    issues: [],
  };
}

describe("independent portfolio history IndexedDB", () => {
  it("imports atomically and treats the same file as a no-op", async () => {
    const repository = new IndexedDbPortfolioHistoryRepository({
      indexedDB: new IDBFactory(),
      databaseName: "history-import-no-op",
      now: () => "2026-08-11T00:00:00Z",
    });

    await expect(repository.importCandidates([candidate(HASH_A, nav())])).resolves.toEqual({
      importedDocuments: 1,
      duplicateDocuments: 0,
      insertedEvents: 1,
      duplicateEvents: 0,
    });
    await expect(repository.importCandidates([candidate(HASH_A, nav())])).resolves.toEqual({
      importedDocuments: 0,
      duplicateDocuments: 1,
      insertedEvents: 0,
      duplicateEvents: 0,
    });
    expect(await repository.getSummary()).toMatchObject({ importCount: 1, navCount: 1 });
  });

  it("rolls back the entire new document when an event identity conflicts", async () => {
    const repository = new IndexedDbPortfolioHistoryRepository({
      indexedDB: new IDBFactory(),
      databaseName: "history-conflict-rollback",
    });
    await repository.importCandidates([candidate(HASH_A, nav("100"))]);

    await expect(
      repository.importCandidates([candidate(HASH_B, nav("101"))]),
    ).rejects.toMatchObject({
      code: "HISTORY_EVENT_CONFLICT",
    });
    expect(await repository.getSummary()).toMatchObject({ importCount: 1, navCount: 1 });
    expect((await repository.listEvents())[0]).toMatchObject({ valueUsd: "100" });
  });

  it("deduplicates the same overlapping NAV even when a later file was parsed later", async () => {
    const repository = new IndexedDbPortfolioHistoryRepository({
      indexedDB: new IDBFactory(),
      databaseName: "history-overlap-nav",
    });
    await repository.importCandidates([candidate(HASH_A, nav("100"))]);
    const repeated = {
      ...nav("100"),
      recordedAt: "2026-08-12T00:00:00Z",
    };

    await expect(repository.importCandidates([candidate(HASH_B, repeated)])).resolves.toEqual({
      importedDocuments: 1,
      duplicateDocuments: 0,
      insertedEvents: 0,
      duplicateEvents: 1,
    });
    expect(await repository.getSummary()).toMatchObject({ importCount: 2, navCount: 1 });
  });

  it("updates only today's local total observation and keeps one point per day", async () => {
    const repository = new IndexedDbPortfolioHistoryRepository({
      indexedDB: new IDBFactory(),
      databaseName: "history-local-nav-upsert",
      now: () => "2026-08-11T12:00:00Z",
    });
    await repository.putLocalPortfolioNav("100", "2026-08-11T10:00:00Z");
    await repository.putLocalPortfolioNav("105", "2026-08-11T11:00:00Z");

    expect(await repository.listEvents()).toEqual([
      expect.objectContaining({
        id: "local-nav:2026-08-11",
        occurredAt: "2026-08-11T11:00:00Z",
        valueUsd: "105",
        scopeKind: "PORTFOLIO_TOTAL",
      }),
    ]);
  });

  it("requires full contract identity for manual option trades", async () => {
    const repository = new IndexedDbPortfolioHistoryRepository({
      indexedDB: new IDBFactory(),
      databaseName: "history-option-identity",
    });
    const incompleteOption: PortfolioHistoryEvent = {
      id: "manual:synthetic-option",
      type: "TRADE",
      source: "MANUAL",
      sourceScopeHash: "MANUAL_PORTFOLIO",
      occurredAt: "2026-08-11T10:30:00Z",
      recordedAt: "2026-08-11T10:31:00Z",
      assetClass: "OPTION",
      side: "BUY",
      symbol: "GOOG",
      quantity: "1",
      price: "3.55",
      multiplier: "100",
      feesUsd: "1.03",
      currency: "USD",
    };

    await expect(repository.putManualEvent(incompleteOption)).rejects.toMatchObject({
      code: "INVALID_HISTORY_DATA",
    });
    expect(await repository.getSummary()).toMatchObject({ tradeCount: 0 });
  });

  it("rejects a batch with a blocking preview issue before opening a write", async () => {
    const repository = new IndexedDbPortfolioHistoryRepository({
      indexedDB: new IDBFactory(),
      databaseName: "history-blocked-preview",
    });
    const blocked = {
      ...candidate(HASH_A, nav()),
      issues: [
        {
          severity: "BLOCKING" as const,
          code: "UNKNOWN_CASH_CLASSIFICATION" as const,
          message: "synthetic unknown cash",
        },
      ],
    };
    await expect(repository.importCandidates([blocked])).rejects.toMatchObject({
      code: "HISTORY_IMPORT_BLOCKED",
    });
    expect(await repository.getSummary()).toEqual({
      importCount: 0,
      navCount: 0,
      externalFlowCount: 0,
      tradeCount: 0,
      firstEventAt: null,
      lastEventAt: null,
    });
  });

  it("never upgrades or rewrites the current-position database", async () => {
    const factory = new IDBFactory();
    const current = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: "current-v3-isolation-proof",
      now: () => "2026-08-11T00:00:00Z",
    });
    await current.replaceBatch({
      instrument: AAPL,
      displayName: "Synthetic Apple",
      inputs: [
        {
          id: "synthetic-input",
          instrument: AAPL,
          quantity: "2",
          costInput: { mode: "AVERAGE_COST", value: "100" },
        },
      ],
    });
    const before = await current.listSnapshots();

    const history = new IndexedDbPortfolioHistoryRepository({
      indexedDB: factory,
      databaseName: "separate-history-v1",
    });
    await history.importCandidates([candidate(HASH_A, nav())]);

    expect(await current.listSnapshots()).toEqual(before);
    expect(await history.getSummary()).toMatchObject({ importCount: 1, navCount: 1 });
  });
});
