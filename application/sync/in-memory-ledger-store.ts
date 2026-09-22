import {
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

function idempotencyIndexKey(
  userId: string,
  idempotencyKey: string,
): string {
  return JSON.stringify([userId, idempotencyKey]);
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

function sortedRecords(
  records: Iterable<ReplicatedLedgerRecord>,
): readonly ReplicatedLedgerRecord[] {
  return [...records].sort((left, right) =>
    left.entry.id < right.entry.id
      ? -1
      : left.entry.id > right.entry.id
        ? 1
        : 0,
  );
}

export class InMemoryLocalLedgerStore implements LocalLedgerStore {
  private readonly records = new Map<string, ReplicatedLedgerRecord>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly outbox = new Map<string, LedgerOutboxItem>();
  private readonly cursors = new Map<string, string | null>();

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
    const key = recordKey(userId, entryId);
    const existing = this.records.get(key);

    if (existing !== undefined) {
      if (
        existing.idempotencyKey === idempotencyKey &&
        sameEntry(existing.entry, entry)
      ) {
        return cloneRecord(existing);
      }
      throw new LedgerSyncError(
        "DUPLICATE_LEDGER_ENTRY",
        `entry ${entryId} already exists with different content or idempotency key`,
        entryId,
      );
    }

    const indexKey = idempotencyIndexKey(userId, idempotencyKey);
    const existingEntryId = this.idempotencyIndex.get(indexKey);
    if (existingEntryId !== undefined) {
      throw new LedgerSyncError(
        "IDEMPOTENCY_KEY_REUSED",
        `idempotency key is already assigned to entry ${existingEntryId}`,
        entryId,
      );
    }

    const currentEconomicEntries = this.economicEntriesForUser(userId);
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

    this.records.set(key, record);
    this.idempotencyIndex.set(indexKey, entryId);
    this.outbox.set(key, outboxItem);
    return cloneRecord(record);
  }

  async listRecords(
    userIdInput: string,
  ): Promise<readonly ReplicatedLedgerRecord[]> {
    const userId = requiredIdentifier(userIdInput, "userId");
    return sortedRecords(
      [...this.records.values()].filter(
        (record) => record.entry.userId === userId,
      ),
    ).map(cloneRecord);
  }

  async listEconomicEntries(
    userIdInput: string,
  ): Promise<readonly LedgerEntry[]> {
    const userId = requiredIdentifier(userIdInput, "userId");
    return this.economicEntriesForUser(userId).map(cloneLedgerEntry);
  }

  async listOutbox(
    userIdInput: string,
  ): Promise<readonly LedgerOutboxItem[]> {
    const userId = requiredIdentifier(userIdInput, "userId");
    const result: LedgerOutboxItem[] = [];
    for (const [key, item] of this.outbox) {
      const record = this.records.get(key);
      if (record?.entry.userId === userId) {
        result.push(cloneOutboxItem(item));
      }
    }
    return result;
  }

  async getCursor(userIdInput: string): Promise<string | null> {
    const userId = requiredIdentifier(userIdInput, "userId");
    return this.cursors.get(userId) ?? null;
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
    const stagedRecords = new Map(this.records);
    const stagedIndex = new Map(this.idempotencyIndex);
    const stagedOutbox = new Map(this.outbox);

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
      const indexKey = idempotencyIndexKey(userId, idempotencyKey);
      const existing = stagedRecords.get(key);

      if (existing !== undefined) {
        if (
          existing.idempotencyKey !== idempotencyKey ||
          !sameEntry(existing.entry, entry)
        ) {
          throw new LedgerSyncError(
            "REMOTE_RECORD_MISMATCH",
            `remote entry ${entryId} differs from the local record with the same ID`,
            entryId,
          );
        }
      } else {
        const indexedEntryId = stagedIndex.get(indexKey);
        if (indexedEntryId !== undefined && indexedEntryId !== entryId) {
          throw new LedgerSyncError(
            "IDEMPOTENCY_KEY_REUSED",
            `remote idempotency key is already assigned to entry ${indexedEntryId}`,
            entryId,
          );
        }
      }

      stagedRecords.set(key, {
        entry,
        idempotencyKey,
        syncStatus: "SYNCED",
        conflict: null,
      });
      stagedIndex.set(indexKey, entryId);
      stagedOutbox.delete(key);
    }

    calculateBrokerPositions(
      [...stagedRecords.values()]
        .filter(
          (record) =>
            record.entry.userId === userId &&
            record.syncStatus === "SYNCED",
        )
        .map((record) => record.entry),
    );

    this.replaceMap(this.records, stagedRecords);
    this.replaceMap(this.idempotencyIndex, stagedIndex);
    this.replaceMap(this.outbox, stagedOutbox);
    this.cursors.set(userId, nextCursor);
  }

  async markPushAttempt(
    userIdInput: string,
    entryIds: readonly string[],
  ): Promise<void> {
    const userId = requiredIdentifier(userIdInput, "userId");
    const items = entryIds.map((entryIdInput) => {
      const entryId = requiredIdentifier(entryIdInput, "entryId");
      const key = recordKey(userId, entryId);
      const record = this.records.get(key);
      const item = this.outbox.get(key);
      if (
        record?.syncStatus !== "LOCAL_PENDING" ||
        item === undefined
      ) {
        throw new LedgerSyncError(
          "INVALID_SYNC_TRANSITION",
          `entry ${entryId} is not pending in the outbox`,
          entryId,
        );
      }
      return { key, item };
    });

    for (const { key, item } of items) {
      this.outbox.set(key, {
        ...item,
        attemptCount: item.attemptCount + 1,
        lastRetryableFailure: null,
      });
    }
  }

  async markSynced(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
  ): Promise<void> {
    const { key, record } = this.getRecordForTransition(
      userIdInput,
      entryIdInput,
      idempotencyKeyInput,
    );
    if (record.syncStatus === "REJECTED_CONFLICT") {
      throw new LedgerSyncError(
        "INVALID_SYNC_TRANSITION",
        `conflicted entry ${record.entry.id} cannot be marked synced without a new server record`,
        record.entry.id,
      );
    }
    this.records.set(key, {
      ...record,
      syncStatus: "SYNCED",
      conflict: null,
    });
    this.outbox.delete(key);
  }

  async markConflict(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
    failureInput: SyncFailure,
  ): Promise<void> {
    const { key, record } = this.getRecordForTransition(
      userIdInput,
      entryIdInput,
      idempotencyKeyInput,
    );
    if (record.syncStatus === "SYNCED") {
      throw new LedgerSyncError(
        "INVALID_SYNC_TRANSITION",
        `synced entry ${record.entry.id} cannot be rejected`,
        record.entry.id,
      );
    }
    this.records.set(key, {
      ...record,
      syncStatus: "REJECTED_CONFLICT",
      conflict: validateFailure(failureInput),
    });
    this.outbox.delete(key);
  }

  async markRetryableFailure(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
    failureInput: SyncFailure,
  ): Promise<void> {
    const { key, record } = this.getRecordForTransition(
      userIdInput,
      entryIdInput,
      idempotencyKeyInput,
    );
    const item = this.outbox.get(key);
    if (record.syncStatus !== "LOCAL_PENDING" || item === undefined) {
      throw new LedgerSyncError(
        "INVALID_SYNC_TRANSITION",
        `entry ${record.entry.id} cannot retain a retryable failure`,
        record.entry.id,
      );
    }
    this.outbox.set(key, {
      ...item,
      lastRetryableFailure: validateFailure(failureInput),
    });
  }

  async clearUser(userIdInput: string): Promise<void> {
    const userId = requiredIdentifier(userIdInput, "userId");
    for (const [key, record] of [...this.records]) {
      if (record.entry.userId === userId) {
        this.records.delete(key);
        this.outbox.delete(key);
        this.idempotencyIndex.delete(
          idempotencyIndexKey(userId, record.idempotencyKey),
        );
      }
    }
    this.cursors.delete(userId);
  }

  private economicEntriesForUser(userId: string): LedgerEntry[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.entry.userId === userId &&
          record.syncStatus !== "REJECTED_CONFLICT",
      )
      .map((record) => record.entry);
  }

  private getRecordForTransition(
    userIdInput: string,
    entryIdInput: string,
    idempotencyKeyInput: string,
  ): { readonly key: string; readonly record: ReplicatedLedgerRecord } {
    const userId = requiredIdentifier(userIdInput, "userId");
    const entryId = requiredIdentifier(entryIdInput, "entryId");
    const idempotencyKey = requiredIdentifier(
      idempotencyKeyInput,
      "idempotencyKey",
    );
    const key = recordKey(userId, entryId);
    const record = this.records.get(key);
    if (record === undefined) {
      throw new LedgerSyncError(
        "UNKNOWN_LOCAL_RECORD",
        `entry ${entryId} does not exist locally`,
        entryId,
      );
    }
    if (record.idempotencyKey !== idempotencyKey) {
      throw new LedgerSyncError(
        "IDEMPOTENCY_KEY_REUSED",
        `entry ${entryId} has a different idempotency key`,
        entryId,
      );
    }
    return { key, record };
  }

  private replaceMap<Key, Value>(
    target: Map<Key, Value>,
    replacement: ReadonlyMap<Key, Value>,
  ): void {
    target.clear();
    for (const [key, value] of replacement) {
      target.set(key, value);
    }
  }
}
