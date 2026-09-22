import {
  DomainValidationError,
  calculateBrokerPositions,
  type LedgerEntry,
} from "../../domain/index.ts";
import type {
  LedgerOutboxItem,
  LocalLedgerStore,
  RemoteLedgerRecord,
  ReplicatedLedgerRecord,
  SyncFailure,
} from "./types.ts";
import { LedgerSyncError } from "./types.ts";

export const INDEXED_DB_LEDGER_SCHEMA_VERSION = 1;
export const DEFAULT_LEDGER_DATABASE_NAME =
  "stock-portfolio-calculator-ledger";

const RECORD_STORE = "ledger_entries";
const OUTBOX_STORE = "sync_outbox";
const SYNC_STATE_STORE = "sync_state";
const RECORDS_BY_USER = "by_user";
const RECORDS_BY_USER_IDEMPOTENCY = "by_user_idempotency";
const OUTBOX_BY_USER = "by_user";

interface StoredLedgerRecord {
  readonly key: string;
  readonly userId: string;
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly record: ReplicatedLedgerRecord;
}

interface StoredOutboxItem {
  readonly key: string;
  readonly userId: string;
  readonly entryId: string;
  readonly enqueueSequence: number;
  readonly item: LedgerOutboxItem;
}

interface StoredSyncState {
  readonly userId: string;
  readonly cursor: string | null;
}

export interface IndexedDbLocalLedgerStoreOptions {
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized !== value) {
    throw new LedgerSyncError(
      "INVALID_SYNC_IDENTIFIER",
      `${field} must be a non-empty canonical identifier`,
    );
  }
  return normalized;
}

function recordKey(userId: string, entryId: string): string {
  return JSON.stringify([userId, entryId]);
}

function cloneLedgerEntry(entry: LedgerEntry): LedgerEntry {
  switch (entry.type) {
    case "OPENING_POSITION":
    case "POSITION_RECONCILIATION":
      return {
        ...entry,
        instrument: { ...entry.instrument },
        costInput: { ...entry.costInput },
      };
    case "BUY":
    case "SELL":
      return {
        ...entry,
        instrument: { ...entry.instrument },
      };
  }
}

function cloneFailure(failure: SyncFailure | null): SyncFailure | null {
  return failure === null ? null : { ...failure };
}

function cloneRecord(
  record: ReplicatedLedgerRecord,
): ReplicatedLedgerRecord {
  return {
    entry: cloneLedgerEntry(record.entry),
    idempotencyKey: record.idempotencyKey,
    syncStatus: record.syncStatus,
    conflict: cloneFailure(record.conflict),
  };
}

function cloneOutboxItem(item: LedgerOutboxItem): LedgerOutboxItem {
  return {
    entryId: item.entryId,
    idempotencyKey: item.idempotencyKey,
    attemptCount: item.attemptCount,
    lastRetryableFailure: cloneFailure(item.lastRetryableFailure),
  };
}

function stableSerialize(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const fields = Object.keys(objectValue)
      .filter((key) => objectValue[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`,
      );
    return `{${fields.join(",")}}`;
  }
  throw new LedgerSyncError(
    "REMOTE_RECORD_MISMATCH",
    "ledger entry contains a value that cannot be compared",
  );
}

function sameEntry(left: LedgerEntry, right: LedgerEntry): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function validateFailure(failure: SyncFailure): SyncFailure {
  return {
    code: requiredIdentifier(failure.code, "failure.code"),
    message: requiredIdentifier(failure.message, "failure.message"),
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new LedgerSyncError(
            "INDEXED_DB_TRANSACTION_FAILED",
            "IndexedDB request failed without an error",
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
          new LedgerSyncError(
            "INDEXED_DB_TRANSACTION_FAILED",
            "IndexedDB transaction was aborted",
          ),
      );
    transaction.onerror = () => {
      // The abort event carries the final transaction failure.
    };
  });
}

function preserveKnownError(error: unknown): never {
  if (
    error instanceof LedgerSyncError ||
    error instanceof DomainValidationError
  ) {
    throw error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  throw new LedgerSyncError(
    "INDEXED_DB_TRANSACTION_FAILED",
    `IndexedDB transaction failed: ${detail}`,
  );
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already have completed or aborted.
  }
}

function sortedStoredRecords(
  records: readonly StoredLedgerRecord[],
): readonly StoredLedgerRecord[] {
  return records.toSorted((left, right) =>
    left.entryId < right.entryId
      ? -1
      : left.entryId > right.entryId
        ? 1
        : 0,
  );
}

function sortedStoredOutbox(
  items: readonly StoredOutboxItem[],
): readonly StoredOutboxItem[] {
  return items.toSorted((left, right) => {
    const leftSequence = validEnqueueSequence(left.enqueueSequence);
    const rightSequence = validEnqueueSequence(right.enqueueSequence);
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    return left.entryId < right.entryId
      ? -1
      : left.entryId > right.entryId
        ? 1
        : 0;
  });
}

function validEnqueueSequence(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export class IndexedDbLocalLedgerStore implements LocalLedgerStore {
  private readonly indexedDbFactory: IDBFactory | undefined;
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbLocalLedgerStoreOptions = {}) {
    this.indexedDbFactory =
      options.indexedDB ??
      (typeof globalThis.indexedDB === "undefined"
        ? undefined
        : globalThis.indexedDB);
    this.databaseName =
      options.databaseName ?? DEFAULT_LEDGER_DATABASE_NAME;
    if (this.databaseName.trim().length === 0) {
      throw new LedgerSyncError(
        "INVALID_SYNC_IDENTIFIER",
        "databaseName must not be empty",
      );
    }
  }

  async appendPending(
    entryInput: LedgerEntry,
    idempotencyKeyInput: string,
  ): Promise<ReplicatedLedgerRecord> {
    const entry = cloneLedgerEntry(entryInput);
    const userId = requiredIdentifier(entry.userId, "entry.userId");
    const entryId = requiredIdentifier(entry.id, "entry.id");
    const idempotencyKey = requiredIdentifier(
      idempotencyKeyInput,
      "idempotencyKey",
    );

    return this.withTransaction(
      [RECORD_STORE, OUTBOX_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(RECORD_STORE);
        const outboxStore = transaction.objectStore(OUTBOX_STORE);
        const storedRecords = await this.recordsForUser(
          recordStore,
          userId,
        );
        const storedOutbox = await this.outboxForUser(
          outboxStore,
          userId,
        );
        const key = recordKey(userId, entryId);
        const existing = storedRecords.find(
          (stored) => stored.key === key,
        );

        if (existing !== undefined) {
          if (
            existing.idempotencyKey === idempotencyKey &&
            sameEntry(existing.record.entry, entry)
          ) {
            return cloneRecord(existing.record);
          }
          throw new LedgerSyncError(
            "DUPLICATE_LEDGER_ENTRY",
            `entry ${entryId} already exists with different content or idempotency key`,
            entryId,
          );
        }

        const idempotencyOwner = storedRecords.find(
          (stored) => stored.idempotencyKey === idempotencyKey,
        );
        if (idempotencyOwner !== undefined) {
          throw new LedgerSyncError(
            "IDEMPOTENCY_KEY_REUSED",
            `idempotency key is already assigned to entry ${idempotencyOwner.entryId}`,
            entryId,
          );
        }

        const currentEconomicEntries = storedRecords
          .filter(
            (stored) =>
              stored.record.syncStatus !== "REJECTED_CONFLICT",
          )
          .map((stored) => stored.record.entry);
        calculateBrokerPositions([...currentEconomicEntries, entry]);

        const record: ReplicatedLedgerRecord = {
          entry,
          idempotencyKey,
          syncStatus: "LOCAL_PENDING",
          conflict: null,
        };
        const outboxItem: LedgerOutboxItem = {
          entryId,
          idempotencyKey,
          attemptCount: 0,
          lastRetryableFailure: null,
        };
        const enqueueSequence =
          storedOutbox.reduce(
            (highest, stored) =>
              Math.max(
                highest,
                validEnqueueSequence(stored.enqueueSequence),
              ),
            0,
          ) + 1;
        await requestResult(
          recordStore.add({
            key,
            userId,
            entryId,
            idempotencyKey,
            record,
          } satisfies StoredLedgerRecord),
        );
        await requestResult(
          outboxStore.add({
            key,
            userId,
            entryId,
            enqueueSequence,
            item: outboxItem,
          } satisfies StoredOutboxItem),
        );
        return cloneRecord(record);
      },
    );
  }

  async listRecords(
    userIdInput: string,
  ): Promise<readonly ReplicatedLedgerRecord[]> {
    const userId = requiredIdentifier(userIdInput, "userId");
    return this.withTransaction(
      [RECORD_STORE],
      "readonly",
      async (transaction) =>
        sortedStoredRecords(
          await this.recordsForUser(
            transaction.objectStore(RECORD_STORE),
            userId,
          ),
        ).map((stored) => cloneRecord(stored.record)),
    );
  }

  async listEconomicEntries(
    userIdInput: string,
  ): Promise<readonly LedgerEntry[]> {
    const records = await this.listRecords(userIdInput);
    return records
      .filter((record) => record.syncStatus !== "REJECTED_CONFLICT")
      .map((record) => cloneLedgerEntry(record.entry));
  }

  async listOutbox(
    userIdInput: string,
  ): Promise<readonly LedgerOutboxItem[]> {
    const userId = requiredIdentifier(userIdInput, "userId");
    return this.withTransaction(
      [OUTBOX_STORE],
      "readonly",
      async (transaction) =>
        sortedStoredOutbox(
          await this.outboxForUser(
            transaction.objectStore(OUTBOX_STORE),
            userId,
          ),
        ).map((stored) => cloneOutboxItem(stored.item)),
    );
  }

  async getCursor(userIdInput: string): Promise<string | null> {
    const userId = requiredIdentifier(userIdInput, "userId");
    return this.withTransaction(
      [SYNC_STATE_STORE],
      "readonly",
      async (transaction) => {
        const state = (await requestResult(
          transaction.objectStore(SYNC_STATE_STORE).get(userId),
        )) as StoredSyncState | undefined;
        return state?.cursor ?? null;
      },
    );
  }

  async applyRemotePage(
    userIdInput: string,
    remoteRecords: readonly RemoteLedgerRecord[],
    nextCursorInput: string | null,
  ): Promise<void> {
    const userId = requiredIdentifier(userIdInput, "userId");
    const nextCursor =
      nextCursorInput === null
        ? null
        : requiredIdentifier(nextCursorInput, "nextCursor");

    await this.withTransaction(
      [RECORD_STORE, OUTBOX_STORE, SYNC_STATE_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(RECORD_STORE);
        const outboxStore = transaction.objectStore(OUTBOX_STORE);
        const syncStateStore = transaction.objectStore(SYNC_STATE_STORE);
        const storedRecords = await this.recordsForUser(
          recordStore,
          userId,
        );
        const stagedRecords = new Map(
          storedRecords.map((stored) => [stored.key, stored]),
        );
        const idempotencyIndex = new Map(
          storedRecords.map((stored) => [
            stored.idempotencyKey,
            stored.entryId,
          ]),
        );
        const changedKeys = new Set<string>();

        for (const remoteInput of remoteRecords) {
          const entry = cloneLedgerEntry(remoteInput.entry);
          const entryId = requiredIdentifier(entry.id, "entry.id");
          if (entry.userId !== userId) {
            throw new LedgerSyncError(
              "REMOTE_USER_MISMATCH",
              `remote entry ${entryId} does not belong to the requested user`,
              entryId,
            );
          }
          const idempotencyKey = requiredIdentifier(
            remoteInput.idempotencyKey,
            "idempotencyKey",
          );
          const key = recordKey(userId, entryId);
          const existing = stagedRecords.get(key);

          if (existing !== undefined) {
            if (
              existing.idempotencyKey !== idempotencyKey ||
              !sameEntry(existing.record.entry, entry)
            ) {
              throw new LedgerSyncError(
                "REMOTE_RECORD_MISMATCH",
                `remote entry ${entryId} differs from the local record with the same ID`,
                entryId,
              );
            }
          } else {
            const indexedEntryId = idempotencyIndex.get(idempotencyKey);
            if (
              indexedEntryId !== undefined &&
              indexedEntryId !== entryId
            ) {
              throw new LedgerSyncError(
                "IDEMPOTENCY_KEY_REUSED",
                `remote idempotency key is already assigned to entry ${indexedEntryId}`,
                entryId,
              );
            }
          }

          const record: ReplicatedLedgerRecord = {
            entry,
            idempotencyKey,
            syncStatus: "SYNCED",
            conflict: null,
          };
          stagedRecords.set(key, {
            key,
            userId,
            entryId,
            idempotencyKey,
            record,
          });
          idempotencyIndex.set(idempotencyKey, entryId);
          changedKeys.add(key);
        }

        calculateBrokerPositions(
          [...stagedRecords.values()]
            .filter(
              (stored) => stored.record.syncStatus === "SYNCED",
            )
            .map((stored) => stored.record.entry),
        );

        for (const key of changedKeys) {
          const stored = stagedRecords.get(key);
          if (stored === undefined) {
            throw new LedgerSyncError(
              "INDEXED_DB_TRANSACTION_FAILED",
              `staged record ${key} disappeared before commit`,
            );
          }
          await requestResult(recordStore.put(stored));
          await requestResult(outboxStore.delete(key));
        }
        await requestResult(
          syncStateStore.put({
            userId,
            cursor: nextCursor,
          } satisfies StoredSyncState),
        );
      },
    );
  }

  async markPushAttempt(
    userIdInput: string,
    entryIds: readonly string[],
  ): Promise<void> {
    const userId = requiredIdentifier(userIdInput, "userId");
    await this.withTransaction(
      [RECORD_STORE, OUTBOX_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(RECORD_STORE);
        const outboxStore = transaction.objectStore(OUTBOX_STORE);
        const staged: StoredOutboxItem[] = [];

        for (const entryIdInput of entryIds) {
          const entryId = requiredIdentifier(entryIdInput, "entryId");
          const key = recordKey(userId, entryId);
          const storedRecord = (await requestResult(
            recordStore.get(key),
          )) as StoredLedgerRecord | undefined;
          const storedOutbox = (await requestResult(
            outboxStore.get(key),
          )) as StoredOutboxItem | undefined;
          if (
            storedRecord?.record.syncStatus !== "LOCAL_PENDING" ||
            storedOutbox === undefined
          ) {
            throw new LedgerSyncError(
              "INVALID_SYNC_TRANSITION",
              `entry ${entryId} is not pending in the outbox`,
              entryId,
            );
          }
          staged.push({
            ...storedOutbox,
            item: {
              ...storedOutbox.item,
              attemptCount: storedOutbox.item.attemptCount + 1,
              lastRetryableFailure: null,
            },
          });
        }

        for (const item of staged) {
          await requestResult(outboxStore.put(item));
        }
      },
    );
  }

  async markSynced(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
  ): Promise<void> {
    await this.withRecordTransition(
      userIdInput,
      entryIdInput,
      idempotencyKeyInput,
      async ({ recordStore, outboxStore, stored }) => {
        if (stored.record.syncStatus === "REJECTED_CONFLICT") {
          throw new LedgerSyncError(
            "INVALID_SYNC_TRANSITION",
            `conflicted entry ${stored.entryId} cannot be marked synced without a new server record`,
            stored.entryId,
          );
        }
        await requestResult(
          recordStore.put({
            ...stored,
            record: {
              ...stored.record,
              syncStatus: "SYNCED",
              conflict: null,
            },
          } satisfies StoredLedgerRecord),
        );
        await requestResult(outboxStore.delete(stored.key));
      },
    );
  }

  async markConflict(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
    failureInput: SyncFailure,
  ): Promise<void> {
    const failure = validateFailure(failureInput);
    await this.withRecordTransition(
      userIdInput,
      entryIdInput,
      idempotencyKeyInput,
      async ({ recordStore, outboxStore, stored }) => {
        if (stored.record.syncStatus === "SYNCED") {
          throw new LedgerSyncError(
            "INVALID_SYNC_TRANSITION",
            `synced entry ${stored.entryId} cannot be rejected`,
            stored.entryId,
          );
        }
        await requestResult(
          recordStore.put({
            ...stored,
            record: {
              ...stored.record,
              syncStatus: "REJECTED_CONFLICT",
              conflict: failure,
            },
          } satisfies StoredLedgerRecord),
        );
        await requestResult(outboxStore.delete(stored.key));
      },
    );
  }

  async markRetryableFailure(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
    failureInput: SyncFailure,
  ): Promise<void> {
    const failure = validateFailure(failureInput);
    await this.withRecordTransition(
      userIdInput,
      entryIdInput,
      idempotencyKeyInput,
      async ({ outboxStore, stored }) => {
        const storedOutbox = (await requestResult(
          outboxStore.get(stored.key),
        )) as StoredOutboxItem | undefined;
        if (
          stored.record.syncStatus !== "LOCAL_PENDING" ||
          storedOutbox === undefined
        ) {
          throw new LedgerSyncError(
            "INVALID_SYNC_TRANSITION",
            `entry ${stored.entryId} cannot retain a retryable failure`,
            stored.entryId,
          );
        }
        await requestResult(
          outboxStore.put({
            ...storedOutbox,
            item: {
              ...storedOutbox.item,
              lastRetryableFailure: failure,
            },
          } satisfies StoredOutboxItem),
        );
      },
    );
  }

  async clearUser(userIdInput: string): Promise<void> {
    const userId = requiredIdentifier(userIdInput, "userId");
    await this.withTransaction(
      [RECORD_STORE, OUTBOX_STORE, SYNC_STATE_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(RECORD_STORE);
        const outboxStore = transaction.objectStore(OUTBOX_STORE);
        const records = await this.recordsForUser(recordStore, userId);
        const outbox = await this.outboxForUser(outboxStore, userId);

        for (const stored of records) {
          await requestResult(recordStore.delete(stored.key));
        }
        for (const stored of outbox) {
          await requestResult(outboxStore.delete(stored.key));
        }
        await requestResult(
          transaction.objectStore(SYNC_STATE_STORE).delete(userId),
        );
      },
    );
  }

  async close(): Promise<void> {
    const databasePromise = this.databasePromise;
    this.databasePromise = undefined;
    if (databasePromise === undefined) {
      return;
    }
    const database = await databasePromise;
    database.close();
  }

  private async withRecordTransition(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
    operation: (context: {
      readonly recordStore: IDBObjectStore;
      readonly outboxStore: IDBObjectStore;
      readonly stored: StoredLedgerRecord;
    }) => Promise<void>,
  ): Promise<void> {
    const userId = requiredIdentifier(userIdInput, "userId");
    const entryId = requiredIdentifier(entryIdInput, "entryId");
    const idempotencyKey = requiredIdentifier(
      idempotencyKeyInput,
      "idempotencyKey",
    );
    await this.withTransaction(
      [RECORD_STORE, OUTBOX_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(RECORD_STORE);
        const outboxStore = transaction.objectStore(OUTBOX_STORE);
        const key = recordKey(userId, entryId);
        const stored = (await requestResult(
          recordStore.get(key),
        )) as StoredLedgerRecord | undefined;
        if (stored === undefined) {
          throw new LedgerSyncError(
            "UNKNOWN_LOCAL_RECORD",
            `entry ${entryId} does not exist locally`,
            entryId,
          );
        }
        if (stored.idempotencyKey !== idempotencyKey) {
          throw new LedgerSyncError(
            "IDEMPOTENCY_KEY_REUSED",
            `entry ${entryId} has a different idempotency key`,
            entryId,
          );
        }
        await operation({ recordStore, outboxStore, stored });
      },
    );
  }

  private async recordsForUser(
    recordStore: IDBObjectStore,
    userId: string,
  ): Promise<readonly StoredLedgerRecord[]> {
    return (await requestResult(
      recordStore.index(RECORDS_BY_USER).getAll(userId),
    )) as StoredLedgerRecord[];
  }

  private async outboxForUser(
    outboxStore: IDBObjectStore,
    userId: string,
  ): Promise<readonly StoredOutboxItem[]> {
    return (await requestResult(
      outboxStore.index(OUTBOX_BY_USER).getAll(userId),
    )) as StoredOutboxItem[];
  }

  private async withTransaction<Result>(
    storeNames: readonly string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<Result>,
  ): Promise<Result> {
    const databasePromise = this.openDatabase();
    const database = await databasePromise;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeNames, mode);
    } catch (error) {
      database.close();
      if (this.databasePromise === databasePromise) {
        this.databasePromise = undefined;
      }
      preserveKnownError(error);
    }
    const completion = transactionCompletion(transaction);
    try {
      const result = await operation(transaction);
      await completion;
      return result;
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise !== undefined) {
      return this.databasePromise;
    }
    if (this.indexedDbFactory === undefined) {
      return Promise.reject(
        new LedgerSyncError(
          "INDEXED_DB_UNAVAILABLE",
          "IndexedDB is not available in this runtime",
        ),
      );
    }

    const openingPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let request: IDBOpenDBRequest;
      try {
        request = this.indexedDbFactory!.open(
          this.databaseName,
          INDEXED_DB_LEDGER_SCHEMA_VERSION,
        );
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : String(error);
        reject(
          new LedgerSyncError(
            "INDEXED_DB_OPEN_FAILED",
            `could not open IndexedDB: ${detail}`,
          ),
        );
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          const store = database.createObjectStore(RECORD_STORE, {
            keyPath: "key",
          });
          store.createIndex(RECORDS_BY_USER, "userId");
          store.createIndex(
            RECORDS_BY_USER_IDEMPOTENCY,
            ["userId", "idempotencyKey"],
            { unique: true },
          );
        }
        if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = database.createObjectStore(OUTBOX_STORE, {
            keyPath: "key",
          });
          store.createIndex(OUTBOX_BY_USER, "userId");
        }
        if (!database.objectStoreNames.contains(SYNC_STATE_STORE)) {
          database.createObjectStore(SYNC_STATE_STORE, {
            keyPath: "userId",
          });
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          if (this.databasePromise === openingPromise) {
            this.databasePromise = undefined;
          }
        };
        resolve(database);
      };
      request.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new LedgerSyncError(
            "INDEXED_DB_OPEN_FAILED",
            `could not open IndexedDB: ${
              request.error?.message ?? "unknown error"
            }`,
          ),
        );
      };
      request.onblocked = () => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new LedgerSyncError(
            "INDEXED_DB_OPEN_FAILED",
            "could not open IndexedDB because an older connection blocked the schema",
          ),
        );
      };
    });
    this.databasePromise = openingPromise;
    void openingPromise.catch(() => {
      if (this.databasePromise === openingPromise) {
        this.databasePromise = undefined;
      }
    });
    return openingPromise;
  }
}
