import type { LedgerEntry } from "../../domain/index.ts";

export type LedgerSyncStatus =
  | "LOCAL_PENDING"
  | "SYNCED"
  | "REJECTED_CONFLICT";

export interface SyncFailure {
  readonly code: string;
  readonly message: string;
}

export interface ReplicatedLedgerRecord {
  readonly entry: LedgerEntry;
  readonly idempotencyKey: string;
  readonly syncStatus: LedgerSyncStatus;
  readonly conflict: SyncFailure | null;
}

export interface LedgerOutboxItem {
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly attemptCount: number;
  readonly lastRetryableFailure: SyncFailure | null;
}

export interface RemoteLedgerRecord {
  readonly entry: LedgerEntry;
  readonly idempotencyKey: string;
}

export interface PullLedgerRequest {
  readonly userId: string;
  readonly cursor: string | null;
}

export interface PullLedgerPage {
  readonly records: readonly RemoteLedgerRecord[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface PushLedgerRecord {
  readonly entry: LedgerEntry;
  readonly idempotencyKey: string;
}

export interface PushLedgerRequest {
  readonly userId: string;
  readonly records: readonly PushLedgerRecord[];
}

interface PushLedgerResultBase {
  readonly entryId: string;
  readonly idempotencyKey: string;
}

export type PushLedgerResult =
  | (PushLedgerResultBase & {
      readonly status: "SYNCED";
    })
  | (PushLedgerResultBase & {
      readonly status: "REJECTED_CONFLICT";
      readonly failure: SyncFailure;
    })
  | (PushLedgerResultBase & {
      readonly status: "RETRYABLE_FAILURE";
      readonly failure: SyncFailure;
    });

export interface PushLedgerResponse {
  readonly results: readonly PushLedgerResult[];
}

export interface LedgerSyncTransport {
  pullLedger(request: PullLedgerRequest): Promise<PullLedgerPage>;
  pushLedger(request: PushLedgerRequest): Promise<PushLedgerResponse>;
}

export interface LocalLedgerStore {
  appendPending(
    entry: LedgerEntry,
    idempotencyKey: string,
  ): Promise<ReplicatedLedgerRecord>;
  listRecords(userId: string): Promise<readonly ReplicatedLedgerRecord[]>;
  listEconomicEntries(userId: string): Promise<readonly LedgerEntry[]>;
  listOutbox(userId: string): Promise<readonly LedgerOutboxItem[]>;
  getCursor(userId: string): Promise<string | null>;
  applyRemotePage(
    userId: string,
    records: readonly RemoteLedgerRecord[],
    nextCursor: string | null,
  ): Promise<void>;
  markPushAttempt(
    userId: string,
    entryIds: readonly string[],
  ): Promise<void>;
  markSynced(
    userId: string,
    entryId: string,
    idempotencyKey: string,
  ): Promise<void>;
  markConflict(
    userId: string,
    entryId: string,
    idempotencyKey: string,
    failure: SyncFailure,
  ): Promise<void>;
  markRetryableFailure(
    userId: string,
    entryId: string,
    idempotencyKey: string,
    failure: SyncFailure,
  ): Promise<void>;
  clearUser(userId: string): Promise<void>;
}

export interface LedgerSyncSummary {
  readonly pulledRecordCount: number;
  readonly attemptedPushCount: number;
  readonly syncedRecordCount: number;
  readonly conflictRecordCount: number;
  readonly retryableFailureCount: number;
  readonly remainingPendingCount: number;
}

export type LedgerSyncErrorCode =
  | "DUPLICATE_LEDGER_ENTRY"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INDEXED_DB_OPEN_FAILED"
  | "INDEXED_DB_TRANSACTION_FAILED"
  | "INDEXED_DB_UNAVAILABLE"
  | "INVALID_SYNC_IDENTIFIER"
  | "INVALID_SYNC_TRANSITION"
  | "MALFORMED_PUSH_RESPONSE"
  | "NON_ADVANCING_CURSOR"
  | "REMOTE_RECORD_MISMATCH"
  | "REMOTE_USER_MISMATCH"
  | "UNKNOWN_LOCAL_RECORD";

export class LedgerSyncError extends Error {
  readonly code: LedgerSyncErrorCode;
  readonly entryId: string | null;

  constructor(
    code: LedgerSyncErrorCode,
    message: string,
    entryId: string | null = null,
  ) {
    super(message);
    this.name = "LedgerSyncError";
    this.code = code;
    this.entryId = entryId;
  }
}
