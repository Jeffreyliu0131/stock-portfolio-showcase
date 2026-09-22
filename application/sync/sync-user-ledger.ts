import {
  DomainValidationError,
  calculateBrokerPositions,
  type LedgerEntry,
} from "../../domain/index.ts";
import type {
  LedgerOutboxItem,
  LedgerSyncSummary,
  LedgerSyncTransport,
  LocalLedgerStore,
  PushLedgerResponse,
  PushLedgerResult,
  RemoteLedgerRecord,
  ReplicatedLedgerRecord,
  SyncFailure,
} from "./types.ts";
import { LedgerSyncError } from "./types.ts";

const TRANSPORT_FAILURE: SyncFailure = {
  code: "SYNC_TRANSPORT_FAILURE",
  message: "cloud sync could not be completed; retry is safe",
};

const INCOMPLETE_RESPONSE: SyncFailure = {
  code: "INCOMPLETE_PUSH_RESPONSE",
  message: "cloud sync did not return a result for this record; retry is safe",
};

function canonicalUserId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized !== value) {
    throw new LedgerSyncError(
      "INVALID_SYNC_IDENTIFIER",
      "userId must be a non-empty canonical identifier",
    );
  }
  return normalized;
}

function resultKey(entryId: string, idempotencyKey: string): string {
  return JSON.stringify([entryId, idempotencyKey]);
}

async function pullAllRemotePages(
  userId: string,
  store: LocalLedgerStore,
  transport: LedgerSyncTransport,
): Promise<number> {
  let cursor = await store.getCursor(userId);
  let pulledRecordCount = 0;
  const seenCursors = new Set<string | null>([cursor]);
  const pulledRecords: RemoteLedgerRecord[] = [];

  while (true) {
    const page = await transport.pullLedger({ userId, cursor });
    if (page.hasMore && seenCursors.has(page.nextCursor)) {
      throw new LedgerSyncError(
        "NON_ADVANCING_CURSOR",
        "cloud pull reported more data with a repeated cursor",
      );
    }
    pulledRecords.push(...page.records);
    pulledRecordCount += page.records.length;
    cursor = page.nextCursor;
    if (!page.hasMore) {
      await store.applyRemotePage(userId, pulledRecords, cursor);
      return pulledRecordCount;
    }
    seenCursors.add(cursor);
  }
}

async function rejectPendingEntriesInvalidatedByRemote(
  userId: string,
  store: LocalLedgerStore,
): Promise<number> {
  const records = await store.listRecords(userId);
  const outbox = await store.listOutbox(userId);
  const recordsById = new Map(
    records.map((record) => [record.entry.id, record]),
  );
  const acceptedEntries: LedgerEntry[] = records
    .filter((record) => record.syncStatus === "SYNCED")
    .map((record) => record.entry);

  calculateBrokerPositions(acceptedEntries);
  let conflictCount = 0;

  for (const item of outbox) {
    const record = recordsById.get(item.entryId);
    if (record?.syncStatus !== "LOCAL_PENDING") {
      throw new LedgerSyncError(
        "UNKNOWN_LOCAL_RECORD",
        `outbox entry ${item.entryId} has no pending local record`,
        item.entryId,
      );
    }

    try {
      calculateBrokerPositions([...acceptedEntries, record.entry]);
      acceptedEntries.push(record.entry);
    } catch (error) {
      if (!(error instanceof DomainValidationError)) {
        throw error;
      }
      const issue = error.issues[0];
      await store.markConflict(
        userId,
        item.entryId,
        item.idempotencyKey,
        {
          code: issue?.code ?? "REMOTE_STATE_CONFLICT",
          message:
            issue?.message ??
            "the record conflicts with newer cloud ledger state",
        },
      );
      conflictCount += 1;
    }
  }

  return conflictCount;
}

function validatePushResults(
  outbox: readonly LedgerOutboxItem[],
  results: readonly PushLedgerResult[],
): ReadonlyMap<string, PushLedgerResult> {
  const requested = new Set(
    outbox.map((item) => resultKey(item.entryId, item.idempotencyKey)),
  );
  const validated = new Map<string, PushLedgerResult>();

  for (const result of results) {
    const key = resultKey(result.entryId, result.idempotencyKey);
    if (!requested.has(key) || validated.has(key)) {
      throw new LedgerSyncError(
        "MALFORMED_PUSH_RESPONSE",
        `cloud returned an unexpected or duplicate result for entry ${result.entryId}`,
        result.entryId,
      );
    }
    validated.set(key, result);
  }
  return validated;
}

async function retainRetryableFailure(
  userId: string,
  store: LocalLedgerStore,
  outbox: readonly LedgerOutboxItem[],
  failure: SyncFailure,
): Promise<void> {
  for (const item of outbox) {
    await store.markRetryableFailure(
      userId,
      item.entryId,
      item.idempotencyKey,
      failure,
    );
  }
}

function recordsForPush(
  outbox: readonly LedgerOutboxItem[],
  records: readonly ReplicatedLedgerRecord[],
) {
  const recordsById = new Map(
    records.map((record) => [record.entry.id, record]),
  );
  return outbox.map((item) => {
    const record = recordsById.get(item.entryId);
    if (record?.syncStatus !== "LOCAL_PENDING") {
      throw new LedgerSyncError(
        "UNKNOWN_LOCAL_RECORD",
        `outbox entry ${item.entryId} has no pending local record`,
        item.entryId,
      );
    }
    return {
      entry: record.entry,
      idempotencyKey: item.idempotencyKey,
    };
  });
}

export async function syncUserLedger(
  userIdInput: string,
  store: LocalLedgerStore,
  transport: LedgerSyncTransport,
): Promise<LedgerSyncSummary> {
  const userId = canonicalUserId(userIdInput);
  const pulledRecordCount = await pullAllRemotePages(
    userId,
    store,
    transport,
  );
  let conflictRecordCount =
    await rejectPendingEntriesInvalidatedByRemote(userId, store);

  const outbox = await store.listOutbox(userId);
  if (outbox.length === 0) {
    return {
      pulledRecordCount,
      attemptedPushCount: 0,
      syncedRecordCount: 0,
      conflictRecordCount,
      retryableFailureCount: 0,
      remainingPendingCount: 0,
    };
  }

  const records = await store.listRecords(userId);
  const pushRecords = recordsForPush(outbox, records);
  await store.markPushAttempt(
    userId,
    outbox.map((item) => item.entryId),
  );

  let response: PushLedgerResponse;
  try {
    response = await transport.pushLedger({
      userId,
      records: pushRecords,
    });
  } catch (error) {
    await retainRetryableFailure(
      userId,
      store,
      outbox,
      TRANSPORT_FAILURE,
    );
    throw error;
  }

  let resultsByKey: ReadonlyMap<string, PushLedgerResult>;
  try {
    resultsByKey = validatePushResults(outbox, response.results);
  } catch (error) {
    await retainRetryableFailure(
      userId,
      store,
      outbox,
      INCOMPLETE_RESPONSE,
    );
    throw error;
  }

  let syncedRecordCount = 0;
  let retryableFailureCount = 0;
  for (const item of outbox) {
    const result = resultsByKey.get(
      resultKey(item.entryId, item.idempotencyKey),
    );
    if (result === undefined) {
      await store.markRetryableFailure(
        userId,
        item.entryId,
        item.idempotencyKey,
        INCOMPLETE_RESPONSE,
      );
      retryableFailureCount += 1;
      continue;
    }

    switch (result.status) {
      case "SYNCED":
        await store.markSynced(
          userId,
          result.entryId,
          result.idempotencyKey,
        );
        syncedRecordCount += 1;
        break;
      case "REJECTED_CONFLICT":
        await store.markConflict(
          userId,
          result.entryId,
          result.idempotencyKey,
          result.failure,
        );
        conflictRecordCount += 1;
        break;
      case "RETRYABLE_FAILURE":
        await store.markRetryableFailure(
          userId,
          result.entryId,
          result.idempotencyKey,
          result.failure,
        );
        retryableFailureCount += 1;
        break;
    }
  }

  return {
    pulledRecordCount,
    attemptedPushCount: outbox.length,
    syncedRecordCount,
    conflictRecordCount,
    retryableFailureCount,
    remainingPendingCount: (await store.listOutbox(userId)).length,
  };
}
