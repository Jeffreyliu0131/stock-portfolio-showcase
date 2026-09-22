import {
  compareRfc3339,
  type DecimalString,
} from "../../domain/index.ts";
import {
  PortfolioHistoryRepositoryError,
  cloneHistoryImportDocument,
  clonePortfolioHistoryEvent,
  type HistoryImportBatchResult,
  type HistoryImportCandidate,
  type HistoryImportDocument,
  type PortfolioHistoryEvent,
  type PortfolioHistoryRepository,
  type PortfolioHistorySummary,
} from "./types.ts";

export const PORTFOLIO_HISTORY_DATABASE_NAME =
  "stock-portfolio-calculator-history";
export const PORTFOLIO_HISTORY_SCHEMA_VERSION = 1;
export const HISTORY_IMPORT_STORE = "history_imports_v1";
export const HISTORY_EVENT_STORE = "history_events_v1";
export const HISTORY_META_STORE = "history_meta_v1";
export const HISTORY_BUILD_STORE = "history_builds_v1";
export const HISTORY_POINT_STORE = "history_points_v1";

export interface IndexedDbPortfolioHistoryRepositoryOptions {
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
  readonly now?: () => string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new PortfolioHistoryRepositoryError(
            "HISTORY_TRANSACTION_FAILED",
            "history IndexedDB request failed",
          ),
      );
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new PortfolioHistoryRepositoryError(
            "HISTORY_TRANSACTION_FAILED",
            "history IndexedDB transaction aborted",
          ),
      );
    transaction.onerror = () => {
      // The abort event owns the final failure.
    };
  });
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // It may already be complete.
  }
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameHistoryEvent(
  left: PortfolioHistoryEvent,
  right: PortfolioHistoryEvent,
): boolean {
  return sameRecord(
    { ...left, recordedAt: "" },
    { ...right, recordedAt: "" },
  );
}

export class IndexedDbPortfolioHistoryRepository
  implements PortfolioHistoryRepository
{
  readonly #indexedDB: IDBFactory | undefined;
  readonly #databaseName: string;
  readonly #now: () => string;

  constructor(options: IndexedDbPortfolioHistoryRepositoryOptions = {}) {
    this.#indexedDB = options.indexedDB ?? globalThis.indexedDB;
    this.#databaseName = options.databaseName ?? PORTFOLIO_HISTORY_DATABASE_NAME;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async #open(): Promise<IDBDatabase> {
    if (this.#indexedDB === undefined) {
      throw new PortfolioHistoryRepositoryError(
        "HISTORY_INDEXED_DB_UNAVAILABLE",
        "history IndexedDB is unavailable",
      );
    }
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.#indexedDB?.open(
        this.#databaseName,
        PORTFOLIO_HISTORY_SCHEMA_VERSION,
      );
      if (request === undefined) {
        reject(
          new PortfolioHistoryRepositoryError(
            "HISTORY_INDEXED_DB_UNAVAILABLE",
            "history IndexedDB is unavailable",
          ),
        );
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(HISTORY_IMPORT_STORE)) {
          database.createObjectStore(HISTORY_IMPORT_STORE, { keyPath: "importId" });
        }
        if (!database.objectStoreNames.contains(HISTORY_EVENT_STORE)) {
          const events = database.createObjectStore(HISTORY_EVENT_STORE, { keyPath: "id" });
          events.createIndex("occurredAt", "occurredAt", { unique: false });
          events.createIndex("type", "type", { unique: false });
        }
        if (!database.objectStoreNames.contains(HISTORY_META_STORE)) {
          database.createObjectStore(HISTORY_META_STORE, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(HISTORY_BUILD_STORE)) {
          database.createObjectStore(HISTORY_BUILD_STORE, { keyPath: "buildId" });
        }
        if (!database.objectStoreNames.contains(HISTORY_POINT_STORE)) {
          database.createObjectStore(HISTORY_POINT_STORE, { keyPath: "pointId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new PortfolioHistoryRepositoryError(
            "HISTORY_INDEXED_DB_OPEN_FAILED",
            request.error?.message ?? "history IndexedDB could not be opened",
          ),
        );
      request.onblocked = () =>
        reject(
          new PortfolioHistoryRepositoryError(
            "HISTORY_INDEXED_DB_OPEN_FAILED",
            "history IndexedDB upgrade is blocked by another tab",
          ),
        );
    });
  }

  async listEvents(): Promise<readonly PortfolioHistoryEvent[]> {
    const database = await this.#open();
    try {
      const transaction = database.transaction(HISTORY_EVENT_STORE, "readonly");
      const values = await requestResult<PortfolioHistoryEvent[]>(
        transaction.objectStore(HISTORY_EVENT_STORE).getAll(),
      );
      await transactionCompletion(transaction);
      return values
        .map(clonePortfolioHistoryEvent)
        .toSorted((left, right) => compareRfc3339(left.occurredAt, right.occurredAt));
    } finally {
      database.close();
    }
  }

  async listImports(): Promise<readonly HistoryImportDocument[]> {
    const database = await this.#open();
    try {
      const transaction = database.transaction(HISTORY_IMPORT_STORE, "readonly");
      const values = await requestResult<HistoryImportDocument[]>(
        transaction.objectStore(HISTORY_IMPORT_STORE).getAll(),
      );
      await transactionCompletion(transaction);
      return values.map(cloneHistoryImportDocument);
    } finally {
      database.close();
    }
  }

  async importCandidates(
    candidates: readonly HistoryImportCandidate[],
  ): Promise<HistoryImportBatchResult> {
    if (
      candidates.length === 0 ||
      candidates.some((candidate) =>
        candidate.issues.some((issue) => issue.severity === "BLOCKING"),
      )
    ) {
      throw new PortfolioHistoryRepositoryError(
        "HISTORY_IMPORT_BLOCKED",
        "history import contains a blocking issue",
      );
    }
    const database = await this.#open();
    const transaction = database.transaction(
      [HISTORY_IMPORT_STORE, HISTORY_EVENT_STORE, HISTORY_META_STORE],
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const imports = transaction.objectStore(HISTORY_IMPORT_STORE);
      const events = transaction.objectStore(HISTORY_EVENT_STORE);
      let importedDocuments = 0;
      let duplicateDocuments = 0;
      let insertedEvents = 0;
      let duplicateEvents = 0;

      for (const candidate of candidates) {
        const document = cloneHistoryImportDocument(candidate.document);
        const existingDocument = await requestResult<HistoryImportDocument | undefined>(
          imports.get(document.importId),
        );
        if (existingDocument !== undefined) {
          duplicateDocuments += 1;
          continue;
        }
        for (const rawEvent of candidate.events) {
          const event = clonePortfolioHistoryEvent(rawEvent);
          const existing = await requestResult<PortfolioHistoryEvent | undefined>(
            events.get(event.id),
          );
          if (existing === undefined) {
            events.add(event);
            insertedEvents += 1;
          } else if (sameHistoryEvent(clonePortfolioHistoryEvent(existing), event)) {
            duplicateEvents += 1;
          } else {
            throw new PortfolioHistoryRepositoryError(
              "HISTORY_EVENT_CONFLICT",
              `history event conflicts with an existing record: ${event.id}`,
            );
          }
        }
        imports.add(document);
        importedDocuments += 1;
      }
      transaction.objectStore(HISTORY_META_STORE).put({
        key: "lastMutationAt",
        value: this.#now(),
      });
      await completion;
      return {
        importedDocuments,
        duplicateDocuments,
        insertedEvents,
        duplicateEvents,
      };
    } catch (error) {
      abortQuietly(transaction);
      try {
        await completion;
      } catch {
        // Preserve the actionable error below.
      }
      if (error instanceof PortfolioHistoryRepositoryError) {
        throw error;
      }
      throw new PortfolioHistoryRepositoryError(
        "HISTORY_TRANSACTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      database.close();
    }
  }

  async putManualEvent(event: PortfolioHistoryEvent): Promise<void> {
    const value = clonePortfolioHistoryEvent(event);
    const database = await this.#open();
    const transaction = database.transaction(HISTORY_EVENT_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(HISTORY_EVENT_STORE);
      const existing = await requestResult<PortfolioHistoryEvent | undefined>(store.get(value.id));
      if (
        existing !== undefined &&
        !sameHistoryEvent(clonePortfolioHistoryEvent(existing), value)
      ) {
        throw new PortfolioHistoryRepositoryError(
          "HISTORY_EVENT_CONFLICT",
          "manual history event id already exists",
        );
      }
      if (existing === undefined) {
        store.add(value);
      }
      await completion;
    } catch (error) {
      abortQuietly(transaction);
      try {
        await completion;
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  async putLocalPortfolioNav(
    valueUsd: DecimalString,
    observedAt: string,
  ): Promise<void> {
    const day = observedAt.slice(0, 10);
    const value = clonePortfolioHistoryEvent({
      id: `local-nav:${day}`,
      type: "NAV_SNAPSHOT",
      source: "LOCAL",
      sourceScopeHash: "LOCAL_PORTFOLIO_TOTAL",
      occurredAt: observedAt,
      recordedAt: this.#now(),
      scopeKind: "PORTFOLIO_TOTAL",
      valueUsd,
      sourceCurrency: "USD",
      sourceValue: valueUsd,
      fxRateToUsd: "1",
      coverage: "COMPLETE",
    });
    const database = await this.#open();
    const transaction = database.transaction(HISTORY_EVENT_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(HISTORY_EVENT_STORE);
      const existing = await requestResult<PortfolioHistoryEvent | undefined>(
        store.get(value.id),
      );
      if (existing !== undefined && existing.source !== "LOCAL") {
        throw new PortfolioHistoryRepositoryError(
          "HISTORY_EVENT_CONFLICT",
          "local NAV id conflicts with a non-local event",
        );
      }
      store.put(value);
      await completion;
    } catch (error) {
      abortQuietly(transaction);
      try {
        await completion;
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  async getSummary(): Promise<PortfolioHistorySummary> {
    const [imports, events] = await Promise.all([this.listImports(), this.listEvents()]);
    return {
      importCount: imports.length,
      navCount: events.filter((event) => event.type === "NAV_SNAPSHOT").length,
      externalFlowCount: events.filter((event) => event.type === "EXTERNAL_FLOW").length,
      tradeCount: events.filter((event) => event.type === "TRADE").length,
      firstEventAt: events[0]?.occurredAt ?? null,
      lastEventAt: events.at(-1)?.occurredAt ?? null,
    };
  }
}
