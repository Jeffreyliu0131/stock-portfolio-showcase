import {
  applyBrokerTrade as applyTradeToBrokerPortfolio,
  createBrokerPortfolioBook,
  DomainValidationError,
  createIbkrUsdCashAccount,
  createInstrumentKey,
  instrumentKeyId,
  reconcileBrokerPortfolio,
  type ApplyBrokerTradeInput,
  type BrokerPortfolioBaselineInput,
  type BrokerPortfolioBook,
  type IbkrUsdCashAccount,
  type InstrumentKey,
} from "../../domain/index.ts";
import {
  cloneBrokerPortfolioBook,
  type ApplyBrokerTradeOptions,
  type BrokerPortfolioRepository,
  type ReplaceBrokerPortfolioOptions,
} from "../brokerage/types.ts";
import {
  cloneCashSnapshot,
  validateCashSavedAt,
  type CashRepository,
  type CashSnapshot,
  type ReplaceCashSnapshotOptions,
} from "../cash/types.ts";
import {
  parsePositionBackupDocument,
  type PositionBackupDocument,
  type PositionBackupRestorer,
  type PositionBackupRestoreResult,
} from "./position-backup.ts";
import {
  PositionRepositoryError,
  clonePositionBatch,
  clonePositionDraft,
  clonePositionEntryDraft,
  clonePositionSnapshot,
  createPositionBatch,
  validateSavedAt,
  type PositionBatch,
  type PositionDraft,
  type PositionEntryDraft,
  type PositionRepository,
  type PositionSnapshot,
  type ReplacePositionBatchOptions,
} from "./types.ts";

export const INDEXED_DB_POSITION_SCHEMA_VERSION = 4;
export const DEFAULT_POSITION_DATABASE_NAME =
  "stock-portfolio-calculator-ledger";

export const POSITION_BATCH_STORE = "position_batches_v2";
export const POSITION_DRAFT_STORE = "position_drafts_v2";
export const POSITION_ENTRY_DRAFT_KEY =
  "__active_position_entry_draft__";
export const CASH_ACCOUNT_STORE = "cash_accounts_v3";
export const IBKR_USD_CASH_ACCOUNT_KEY = "IBKR:USD";
export const BROKER_PORTFOLIO_STORE = "broker_portfolio_v4";
export const BROKER_PORTFOLIO_KEY = "CURRENT";
export const LEGACY_BROKER_LEDGER_STORE =
  "legacy_broker_ledger_v1";

const LEGACY_LEDGER_SOURCE_STORE = "ledger_entries";

interface StoredPositionBatch {
  readonly key: string;
  readonly current: PositionSnapshot;
  readonly previous: PositionSnapshot | null;
  readonly nextRevision: number;
}

interface StoredPositionDraft {
  readonly key: string;
  readonly draft: PositionDraft;
}

interface StoredPositionEntryDraft {
  readonly key: typeof POSITION_ENTRY_DRAFT_KEY;
  readonly entryDraft: PositionEntryDraft;
}

interface StoredCashAccount {
  readonly key: typeof IBKR_USD_CASH_ACCOUNT_KEY;
  readonly current: CashSnapshot;
  readonly previous: CashSnapshot | null;
  readonly nextRevision: number;
}

interface StoredBrokerPortfolio {
  readonly key: typeof BROKER_PORTFOLIO_KEY;
  readonly current: BrokerPortfolioBook;
  readonly previous: BrokerPortfolioBook | null;
  readonly nextRevision: number;
}

interface StoredLegacyBrokerLedgerBackup {
  readonly backupId?: number;
  readonly sourceStore: typeof LEGACY_LEDGER_SOURCE_STORE;
  readonly sourceKey: IDBValidKey;
  readonly record: unknown;
}

type BatchWriteMode = "REPLACE" | "ADD_INPUTS";

export interface LegacyBrokerLedgerBackup {
  readonly sourceKey: IDBValidKey;
  readonly record: unknown;
}

export interface IndexedDbPositionRepositoryOptions {
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
          new PositionRepositoryError(
            "INDEXED_DB_TRANSACTION_FAILED",
            "IndexedDB request failed without an error",
          ),
      );
  });
}

function transactionCompletion(
  transaction: IDBTransaction,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new PositionRepositoryError(
            "INDEXED_DB_TRANSACTION_FAILED",
            "IndexedDB transaction was aborted",
          ),
      );
    transaction.onerror = () => {
      // The abort event reports the final transaction failure.
    };
  });
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already have completed or aborted.
  }
}

function preserveKnownError(error: unknown): never {
  if (
    error instanceof PositionRepositoryError ||
    error instanceof DomainValidationError
  ) {
    throw error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  throw new PositionRepositoryError(
    "INDEXED_DB_TRANSACTION_FAILED",
    `IndexedDB transaction failed: ${detail}`,
  );
}

function cloneLegacyValue(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      `legacy ledger backup could not be cloned: ${detail}`,
    );
  }
}

function validateStoredBatch(
  value: StoredPositionBatch,
): StoredPositionBatch {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.key !== "string"
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored position batch has an invalid shape",
    );
  }
  const current = clonePositionSnapshot(value.current);
  const previous =
    value.previous === null
      ? null
      : clonePositionSnapshot(value.previous);
  const expectedKey = instrumentKeyId(current.batch.instrument);
  if (value.key !== expectedKey) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored position batch key does not match its instrument",
    );
  }
  if (
    previous !== null &&
    instrumentKeyId(previous.batch.instrument) !== expectedKey
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "previous position snapshot has a different instrument",
    );
  }
  if (
    !Number.isSafeInteger(value.nextRevision) ||
    value.nextRevision <= current.revision ||
    (previous !== null && value.nextRevision <= previous.revision)
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored position batch has an invalid next revision",
    );
  }
  return {
    key: value.key,
    current,
    previous,
    nextRevision: value.nextRevision,
  };
}

function validateStoredDraft(
  value: StoredPositionDraft,
): StoredPositionDraft {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.key !== "string"
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored position draft has an invalid shape",
    );
  }
  const draft = clonePositionDraft(value.draft);
  if (value.key !== instrumentKeyId(draft.batch.instrument)) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored position draft key does not match its instrument",
    );
  }
  return { key: value.key, draft };
}

function validateStoredEntryDraft(
  value: StoredPositionEntryDraft,
): StoredPositionEntryDraft {
  if (
    typeof value !== "object" ||
    value === null ||
    value.key !== POSITION_ENTRY_DRAFT_KEY
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored position entry draft has an invalid shape",
    );
  }
  return {
    key: POSITION_ENTRY_DRAFT_KEY,
    entryDraft: clonePositionEntryDraft(value.entryDraft),
  };
}

function validateStoredCashAccount(
  value: StoredCashAccount,
): StoredCashAccount {
  if (
    typeof value !== "object" ||
    value === null ||
    value.key !== IBKR_USD_CASH_ACCOUNT_KEY
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored cash account has an invalid shape",
    );
  }
  const current = cloneCashSnapshot(value.current);
  const previous =
    value.previous === null ? null : cloneCashSnapshot(value.previous);
  if (
    !Number.isSafeInteger(value.nextRevision) ||
    value.nextRevision <= current.revision ||
    (previous !== null && value.nextRevision <= previous.revision)
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored cash account has an invalid next revision",
    );
  }
  return {
    key: IBKR_USD_CASH_ACCOUNT_KEY,
    current,
    previous,
    nextRevision: value.nextRevision,
  };
}

function validateStoredBrokerPortfolio(
  value: StoredBrokerPortfolio,
): StoredBrokerPortfolio {
  if (
    typeof value !== "object" ||
    value === null ||
    value.key !== BROKER_PORTFOLIO_KEY
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored broker portfolio has an invalid shape",
    );
  }
  const current = createBrokerPortfolioBook(value.current);
  const previous =
    value.previous === null ? null : createBrokerPortfolioBook(value.previous);
  if (
    !Number.isSafeInteger(value.nextRevision) ||
    value.nextRevision !== current.revision + 1 ||
    (previous !== null && previous.revision >= current.revision)
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "stored broker portfolio has an invalid revision chain",
    );
  }
  return {
    key: BROKER_PORTFOLIO_KEY,
    current,
    previous,
    nextRevision: value.nextRevision,
  };
}

function requireExpectedBrokerPortfolioRevision(
  existing: StoredBrokerPortfolio | null,
  expectedRevision: number | null | undefined,
): void {
  if (expectedRevision === undefined) {
    return;
  }
  if (
    expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw new PositionRepositoryError(
      "BROKER_PORTFOLIO_CONFLICT",
      "expected broker portfolio revision must be null or positive",
    );
  }
  if (
    (expectedRevision === null && existing !== null) ||
    (expectedRevision !== null &&
      existing?.current.revision !== expectedRevision)
  ) {
    throw new PositionRepositoryError(
      "BROKER_PORTFOLIO_CONFLICT",
      "broker portfolio changed after it was read",
    );
  }
}

function requireExpectedRevision(
  existing: StoredPositionBatch | null,
  options: ReplacePositionBatchOptions,
): void {
  if (options.expectedRevision === undefined) {
    return;
  }
  const expectedRevision = options.expectedRevision;
  if (
    expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1)
  ) {
    throw new PositionRepositoryError(
      "POSITION_SNAPSHOT_CONFLICT",
      "expectedRevision must be null or a positive safe integer",
    );
  }
  if (
    (expectedRevision === null && existing !== null) ||
    (expectedRevision !== null &&
      existing?.current.revision !== expectedRevision)
  ) {
    throw new PositionRepositoryError(
      "POSITION_SNAPSHOT_CONFLICT",
      "position snapshot changed after it was read",
    );
  }
}

function requireExpectedCashRevision(
  existing: StoredCashAccount | null,
  options: ReplaceCashSnapshotOptions,
): void {
  if (options.expectedRevision === undefined) {
    return;
  }
  const expectedRevision = options.expectedRevision;
  if (
    expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw new PositionRepositoryError(
      "CASH_SNAPSHOT_CONFLICT",
      "expectedRevision must be null or a positive safe integer",
    );
  }
  if (
    (expectedRevision === null && existing !== null) ||
    (expectedRevision !== null &&
      existing?.current.revision !== expectedRevision)
  ) {
    throw new PositionRepositoryError(
      "CASH_SNAPSHOT_CONFLICT",
      "cash snapshot changed after it was read",
    );
  }
}

function uniqueAddedInputId(
  usedIds: Set<string>,
  revision: number,
  index: number,
): string {
  const base = `position-input-r${revision}-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function addInputsToExistingBatch(
  existing: StoredPositionBatch | null,
  additions: PositionBatch,
  revision: number,
): PositionBatch {
  if (existing === null) {
    return additions;
  }

  const usedIds = new Set(
    existing.current.batch.inputs.map((input) => input.id),
  );
  const addedInputs = additions.inputs.map((input, index) => {
    if (!usedIds.has(input.id)) {
      usedIds.add(input.id);
      return input;
    }
    return {
      ...input,
      id: uniqueAddedInputId(usedIds, revision, index),
    };
  });
  const displayName =
    additions.displayName ??
    existing.current.batch.displayName;

  return createPositionBatch({
    instrument: existing.current.batch.instrument,
    ...(displayName === undefined ? {} : { displayName }),
    inputs: [
      ...existing.current.batch.inputs,
      ...addedInputs,
    ],
  });
}

export class IndexedDbPositionRepository
  implements
    PositionRepository,
    CashRepository,
    PositionBackupRestorer,
    BrokerPortfolioRepository
{
  private readonly indexedDbFactory: IDBFactory | undefined;
  private readonly databaseName: string;
  private readonly now: () => string;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbPositionRepositoryOptions = {}) {
    this.indexedDbFactory =
      options.indexedDB ??
      (typeof globalThis.indexedDB === "undefined"
        ? undefined
        : globalThis.indexedDB);
    this.databaseName =
      options.databaseName ?? DEFAULT_POSITION_DATABASE_NAME;
    this.now = options.now ?? (() => new Date().toISOString());
    if (
      this.databaseName.trim().length === 0 ||
      this.databaseName.trim() !== this.databaseName
    ) {
      throw new PositionRepositoryError(
        "INDEXED_DB_OPEN_FAILED",
        "databaseName must be a non-empty canonical identifier",
      );
    }
  }

  async listSnapshots(): Promise<readonly PositionSnapshot[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_BATCH_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = await requestResult(
        transaction.objectStore(POSITION_BATCH_STORE).getAll(),
      );
      await completion;
      return (stored as StoredPositionBatch[])
        .map((record) => validateStoredBatch(record).current)
        .toSorted((left, right) => {
          const leftKey = instrumentKeyId(left.batch.instrument);
          const rightKey = instrumentKeyId(right.batch.instrument);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        });
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getSnapshot(
    instrumentInput: InstrumentKey,
  ): Promise<PositionSnapshot | null> {
    const instrument = createInstrumentKey(instrumentInput);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_BATCH_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = await requestResult(
        transaction
          .objectStore(POSITION_BATCH_STORE)
          .get(instrumentKeyId(instrument)),
      );
      await completion;
      return stored === undefined
        ? null
        : clonePositionSnapshot(
            validateStoredBatch(stored as StoredPositionBatch).current,
          );
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getPreviousSnapshot(
    instrumentInput: InstrumentKey,
  ): Promise<PositionSnapshot | null> {
    const instrument = createInstrumentKey(instrumentInput);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_BATCH_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = await requestResult(
        transaction
          .objectStore(POSITION_BATCH_STORE)
          .get(instrumentKeyId(instrument)),
      );
      await completion;
      if (stored === undefined) {
        return null;
      }
      const previous = validateStoredBatch(
        stored as StoredPositionBatch,
      ).previous;
      return previous === null
        ? null
        : clonePositionSnapshot(previous);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getCashSnapshot(): Promise<CashSnapshot | null> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      CASH_ACCOUNT_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = await requestResult(
        transaction
          .objectStore(CASH_ACCOUNT_STORE)
          .get(IBKR_USD_CASH_ACCOUNT_KEY),
      );
      await completion;
      return stored === undefined
        ? null
        : cloneCashSnapshot(
            validateStoredCashAccount(stored as StoredCashAccount).current,
          );
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getPreviousCashSnapshot(): Promise<CashSnapshot | null> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      CASH_ACCOUNT_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = await requestResult(
        transaction
          .objectStore(CASH_ACCOUNT_STORE)
          .get(IBKR_USD_CASH_ACCOUNT_KEY),
      );
      await completion;
      if (stored === undefined) {
        return null;
      }
      const previous = validateStoredCashAccount(
        stored as StoredCashAccount,
      ).previous;
      return previous === null ? null : cloneCashSnapshot(previous);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async restoreCurrentBackup(
    backupInput: PositionBackupDocument,
  ): Promise<PositionBackupRestoreResult> {
    // Revalidate at the write boundary even when the caller already parsed
    // the file. TypeScript types do not make browser input trustworthy.
    const backup = parsePositionBackupDocument(backupInput);
    const positionRecords = backup.snapshots.map(
      (source): StoredPositionBatch => ({
        key: instrumentKeyId(source.batch.instrument),
        current: {
          ...source,
          revision: 1,
        },
        previous: null,
        nextRevision: 2,
      }),
    );
    const cashRecord: StoredCashAccount | null =
      backup.cash === null
        ? null
        : {
            key: IBKR_USD_CASH_ACCOUNT_KEY,
            current: {
              ...backup.cash,
              revision: 1,
            },
            previous: null,
            nextRevision: 2,
          };
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [POSITION_BATCH_STORE, CASH_ACCOUNT_STORE],
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const positionStore = transaction.objectStore(
        POSITION_BATCH_STORE,
      );
      const cashStore = transaction.objectStore(CASH_ACCOUNT_STORE);
      const [positionCount, cashCount] = await Promise.all([
        requestResult(positionStore.count()),
        requestResult(cashStore.count()),
      ]);
      if (positionCount !== 0 || cashCount !== 0) {
        throw new PositionRepositoryError(
          "BACKUP_RESTORE_TARGET_NOT_EMPTY",
          "backup restore requires both positions and cash to be empty",
        );
      }

      const writeRequests: IDBRequest<IDBValidKey>[] =
        positionRecords.map((record) => positionStore.add(record));
      if (cashRecord !== null) {
        writeRequests.push(cashStore.add(cashRecord));
      }
      await Promise.all(writeRequests.map((request) => requestResult(request)));
      await completion;
      return {
        positionCount: positionRecords.length,
        cashRestored: cashRecord !== null,
      };
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async replaceCashAccount(
    accountInput: IbkrUsdCashAccount,
    options: ReplaceCashSnapshotOptions = {},
  ): Promise<CashSnapshot> {
    const account = createIbkrUsdCashAccount(accountInput);
    const savedAt = validateCashSavedAt(
      this.now(),
      "cashSnapshot.savedAt",
    );
    const database = await this.openDatabase();
    const transaction = database.transaction(
      CASH_ACCOUNT_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(CASH_ACCOUNT_STORE);
      const existingValue = await requestResult(
        store.get(IBKR_USD_CASH_ACCOUNT_KEY),
      );
      const existing =
        existingValue === undefined
          ? null
          : validateStoredCashAccount(
              existingValue as StoredCashAccount,
            );
      requireExpectedCashRevision(existing, options);
      const revision = existing?.nextRevision ?? 1;
      const current: CashSnapshot = {
        revision,
        savedAt,
        account,
      };
      const nextRevision = revision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        throw new PositionRepositoryError(
          "INVALID_PERSISTED_POSITION_DATA",
          "cash snapshot revision limit has been reached",
        );
      }
      await requestResult(
        store.put({
          key: IBKR_USD_CASH_ACCOUNT_KEY,
          current,
          previous: existing?.current ?? null,
          nextRevision,
        } satisfies StoredCashAccount),
      );
      await completion;
      return cloneCashSnapshot(current);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async deleteCashSnapshot(
    options: ReplaceCashSnapshotOptions = {},
  ): Promise<boolean> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      CASH_ACCOUNT_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(CASH_ACCOUNT_STORE);
      const existingValue = await requestResult(
        store.get(IBKR_USD_CASH_ACCOUNT_KEY),
      );
      const existing =
        existingValue === undefined
          ? null
          : validateStoredCashAccount(
              existingValue as StoredCashAccount,
            );
      requireExpectedCashRevision(existing, options);
      if (existing === null) {
        await completion;
        return false;
      }
      await requestResult(store.delete(IBKR_USD_CASH_ACCOUNT_KEY));
      await completion;
      return true;
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getBrokerPortfolioBook(): Promise<BrokerPortfolioBook | null> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      BROKER_PORTFOLIO_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const value = await requestResult(
        transaction
          .objectStore(BROKER_PORTFOLIO_STORE)
          .get(BROKER_PORTFOLIO_KEY),
      );
      await completion;
      return value === undefined
        ? null
        : cloneBrokerPortfolioBook(
            validateStoredBrokerPortfolio(value as StoredBrokerPortfolio)
              .current,
          );
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getPreviousBrokerPortfolioBook(): Promise<BrokerPortfolioBook | null> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      BROKER_PORTFOLIO_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const value = await requestResult(
        transaction
          .objectStore(BROKER_PORTFOLIO_STORE)
          .get(BROKER_PORTFOLIO_KEY),
      );
      await completion;
      if (value === undefined) {
        return null;
      }
      const previous = validateStoredBrokerPortfolio(
        value as StoredBrokerPortfolio,
      ).previous;
      return previous === null ? null : cloneBrokerPortfolioBook(previous);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async replaceBrokerPortfolioBaseline(
    baseline: BrokerPortfolioBaselineInput,
    options: ReplaceBrokerPortfolioOptions,
  ): Promise<BrokerPortfolioBook> {
    const recordedAt = this.now();
    const database = await this.openDatabase();
    const transaction = database.transaction(
      BROKER_PORTFOLIO_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(BROKER_PORTFOLIO_STORE);
      const value = await requestResult(store.get(BROKER_PORTFOLIO_KEY));
      const existing =
        value === undefined
          ? null
          : validateStoredBrokerPortfolio(value as StoredBrokerPortfolio);
      requireExpectedBrokerPortfolioRevision(
        existing,
        options.expectedRevision,
      );
      const current = reconcileBrokerPortfolio(
        existing?.current ?? null,
        baseline,
        recordedAt,
        options.eventId,
      );
      await requestResult(
        store.put({
          key: BROKER_PORTFOLIO_KEY,
          current,
          previous: existing?.current ?? null,
          nextRevision: current.revision + 1,
        } satisfies StoredBrokerPortfolio),
      );
      await completion;
      return cloneBrokerPortfolioBook(current);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async applyBrokerTrade(
    trade: ApplyBrokerTradeInput,
    options: ApplyBrokerTradeOptions,
  ): Promise<BrokerPortfolioBook> {
    const recordedAt = this.now();
    const database = await this.openDatabase();
    const transaction = database.transaction(
      BROKER_PORTFOLIO_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(BROKER_PORTFOLIO_STORE);
      const value = await requestResult(store.get(BROKER_PORTFOLIO_KEY));
      if (value === undefined) {
        throw new PositionRepositoryError(
          "BROKER_PORTFOLIO_NOT_CALIBRATED",
          "broker portfolio must be calibrated before recording trades",
        );
      }
      const existing = validateStoredBrokerPortfolio(
        value as StoredBrokerPortfolio,
      );
      requireExpectedBrokerPortfolioRevision(
        existing,
        options.expectedRevision,
      );
      const current = applyTradeToBrokerPortfolio(
        existing.current,
        trade,
        recordedAt,
      );
      await requestResult(
        store.put({
          key: BROKER_PORTFOLIO_KEY,
          current,
          previous: existing.current,
          nextRevision: current.revision + 1,
        } satisfies StoredBrokerPortfolio),
      );
      await completion;
      return cloneBrokerPortfolioBook(current);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async restoreBrokerPortfolioBackup(
    bookInput: BrokerPortfolioBook,
  ): Promise<BrokerPortfolioBook> {
    const source = createBrokerPortfolioBook(bookInput);
    const current = createBrokerPortfolioBook({
      ...source,
      revision: 1,
      savedAt: this.now(),
    });
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [POSITION_BATCH_STORE, CASH_ACCOUNT_STORE, BROKER_PORTFOLIO_STORE],
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const positionStore = transaction.objectStore(POSITION_BATCH_STORE);
      const cashStore = transaction.objectStore(CASH_ACCOUNT_STORE);
      const brokerStore = transaction.objectStore(BROKER_PORTFOLIO_STORE);
      const [positionCount, cashCount, brokerCount] = await Promise.all([
        requestResult(positionStore.count()),
        requestResult(cashStore.count()),
        requestResult(brokerStore.count()),
      ]);
      if (positionCount !== 0 || cashCount !== 0 || brokerCount !== 0) {
        throw new PositionRepositoryError(
          "BACKUP_RESTORE_TARGET_NOT_EMPTY",
          "broker backup restore requires every current asset store to be empty",
        );
      }
      await requestResult(
        brokerStore.add({
          key: BROKER_PORTFOLIO_KEY,
          current,
          previous: null,
          nextRevision: 2,
        } satisfies StoredBrokerPortfolio),
      );
      await completion;
      return cloneBrokerPortfolioBook(current);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async replaceBatch(
    batchInput: PositionBatch,
    options: ReplacePositionBatchOptions = {},
  ): Promise<PositionSnapshot> {
    return this.writeBatch(batchInput, options, "REPLACE");
  }

  async addInputsToBatch(
    batchInput: PositionBatch,
    options: ReplacePositionBatchOptions = {},
  ): Promise<PositionSnapshot> {
    return this.writeBatch(batchInput, options, "ADD_INPUTS");
  }

  async deleteSnapshot(
    instrumentInput: InstrumentKey,
    options: ReplacePositionBatchOptions = {},
  ): Promise<boolean> {
    const instrument = createInstrumentKey(instrumentInput);
    const key = instrumentKeyId(instrument);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [POSITION_BATCH_STORE, POSITION_DRAFT_STORE],
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const batchStore = transaction.objectStore(
        POSITION_BATCH_STORE,
      );
      const existingValue = await requestResult(
        batchStore.get(key),
      );
      const existing =
        existingValue === undefined
          ? null
          : validateStoredBatch(
              existingValue as StoredPositionBatch,
            );
      requireExpectedRevision(existing, options);
      if (existing === null) {
        await completion;
        return false;
      }
      await Promise.all([
        requestResult(batchStore.delete(key)),
        requestResult(
          transaction
            .objectStore(POSITION_DRAFT_STORE)
            .delete(key),
        ),
      ]);
      await completion;
      return true;
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  private async writeBatch(
    batchInput: PositionBatch,
    options: ReplacePositionBatchOptions,
    mode: BatchWriteMode,
  ): Promise<PositionSnapshot> {
    const batch = clonePositionBatch(createPositionBatch(batchInput));
    const key = instrumentKeyId(batch.instrument);
    const savedAt = validateSavedAt(
      this.now(),
      "positionSnapshot.savedAt",
    );
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_BATCH_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(POSITION_BATCH_STORE);
      const existingValue = await requestResult(store.get(key));
      const existing =
        existingValue === undefined
          ? null
          : validateStoredBatch(
              existingValue as StoredPositionBatch,
            );
      requireExpectedRevision(existing, options);
      const revision = existing?.nextRevision ?? 1;
      const nextBatch =
        mode === "ADD_INPUTS"
          ? addInputsToExistingBatch(
              existing,
              batch,
              revision,
            )
          : batch;
      const current: PositionSnapshot = {
        revision,
        savedAt,
        batch: nextBatch,
      };
      const nextRevision = revision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        throw new PositionRepositoryError(
          "INVALID_PERSISTED_POSITION_DATA",
          "position snapshot revision limit has been reached",
        );
      }
      const stored: StoredPositionBatch = {
        key,
        current,
        previous: existing?.current ?? null,
        nextRevision,
      };
      await requestResult(store.put(stored));
      await completion;
      return clonePositionSnapshot(current);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async undoLatest(
    instrumentInput: InstrumentKey,
  ): Promise<PositionSnapshot | null> {
    const instrument = createInstrumentKey(instrumentInput);
    const key = instrumentKeyId(instrument);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_BATCH_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      const store = transaction.objectStore(POSITION_BATCH_STORE);
      const storedValue = await requestResult(store.get(key));
      if (storedValue === undefined) {
        await completion;
        return null;
      }
      const stored = validateStoredBatch(
        storedValue as StoredPositionBatch,
      );
      if (stored.previous === null) {
        await completion;
        return null;
      }
      const restored = clonePositionSnapshot(stored.previous);
      await requestResult(
        store.put({
          key,
          current: restored,
          previous: null,
          nextRevision: stored.nextRevision,
        } satisfies StoredPositionBatch),
      );
      await completion;
      return clonePositionSnapshot(restored);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getDraft(
    instrumentInput: InstrumentKey,
  ): Promise<PositionDraft | null> {
    const instrument = createInstrumentKey(instrumentInput);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_DRAFT_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = await requestResult(
        transaction
          .objectStore(POSITION_DRAFT_STORE)
          .get(instrumentKeyId(instrument)),
      );
      await completion;
      return stored === undefined
        ? null
        : clonePositionDraft(
            validateStoredDraft(stored as StoredPositionDraft).draft,
          );
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async saveDraft(batchInput: PositionBatch): Promise<PositionDraft> {
    const batch = clonePositionBatch(createPositionBatch(batchInput));
    const draft: PositionDraft = {
      savedAt: validateSavedAt(
        this.now(),
        "positionDraft.savedAt",
      ),
      batch,
    };
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_DRAFT_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      await requestResult(
        transaction.objectStore(POSITION_DRAFT_STORE).put({
          key: instrumentKeyId(batch.instrument),
          draft,
        } satisfies StoredPositionDraft),
      );
      await completion;
      return clonePositionDraft(draft);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async clearDraft(instrumentInput: InstrumentKey): Promise<void> {
    const instrument = createInstrumentKey(instrumentInput);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_DRAFT_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      await requestResult(
        transaction
          .objectStore(POSITION_DRAFT_STORE)
          .delete(instrumentKeyId(instrument)),
      );
      await completion;
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async getEntryDraft(): Promise<PositionEntryDraft | null> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_DRAFT_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = await requestResult(
        transaction
          .objectStore(POSITION_DRAFT_STORE)
          .get(POSITION_ENTRY_DRAFT_KEY),
      );
      await completion;
      return stored === undefined
        ? null
        : clonePositionEntryDraft(
            validateStoredEntryDraft(
              stored as StoredPositionEntryDraft,
            ).entryDraft,
          );
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async saveEntryDraft(
    draftInput: PositionEntryDraft,
  ): Promise<PositionEntryDraft> {
    const entryDraft = clonePositionEntryDraft(draftInput);
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_DRAFT_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      await requestResult(
        transaction.objectStore(POSITION_DRAFT_STORE).put({
          key: POSITION_ENTRY_DRAFT_KEY,
          entryDraft,
        } satisfies StoredPositionEntryDraft),
      );
      await completion;
      return clonePositionEntryDraft(entryDraft);
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async clearEntryDraft(): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      POSITION_DRAFT_STORE,
      "readwrite",
    );
    const completion = transactionCompletion(transaction);
    try {
      await requestResult(
        transaction
          .objectStore(POSITION_DRAFT_STORE)
          .delete(POSITION_ENTRY_DRAFT_KEY),
      );
      await completion;
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async listLegacyBrokerLedgerBackups(): Promise<
    readonly LegacyBrokerLedgerBackup[]
  > {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      LEGACY_BROKER_LEDGER_STORE,
      "readonly",
    );
    const completion = transactionCompletion(transaction);
    try {
      const stored = (await requestResult(
        transaction
          .objectStore(LEGACY_BROKER_LEDGER_STORE)
          .getAll(),
      )) as StoredLegacyBrokerLedgerBackup[];
      await completion;
      return stored.map((backup) => {
        if (
          backup.sourceStore !== LEGACY_LEDGER_SOURCE_STORE ||
          backup.sourceKey === undefined
        ) {
          throw new PositionRepositoryError(
            "INVALID_PERSISTED_POSITION_DATA",
            "legacy broker ledger backup has an invalid shape",
          );
        }
        return {
          sourceKey: cloneLegacyValue(
            backup.sourceKey,
          ) as IDBValidKey,
          record: cloneLegacyValue(backup.record),
        };
      });
    } catch (error) {
      abortQuietly(transaction);
      await completion.catch(() => undefined);
      preserveKnownError(error);
    }
  }

  async close(): Promise<void> {
    const databasePromise = this.databasePromise;
    this.databasePromise = undefined;
    const database = await databasePromise;
    database?.close();
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise !== undefined) {
      return this.databasePromise;
    }
    if (this.indexedDbFactory === undefined) {
      return Promise.reject(
        new PositionRepositoryError(
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
          INDEXED_DB_POSITION_SCHEMA_VERSION,
        );
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : String(error);
        reject(
          new PositionRepositoryError(
            "INDEXED_DB_OPEN_FAILED",
            `could not open IndexedDB: ${detail}`,
          ),
        );
        return;
      }

      request.onupgradeneeded = (event) => {
        const database = request.result;
        const transaction = request.transaction;
        if (transaction === null) {
          request.transaction?.abort();
          return;
        }
        if (!database.objectStoreNames.contains(POSITION_BATCH_STORE)) {
          database.createObjectStore(POSITION_BATCH_STORE, {
            keyPath: "key",
          });
        }
        if (!database.objectStoreNames.contains(POSITION_DRAFT_STORE)) {
          database.createObjectStore(POSITION_DRAFT_STORE, {
            keyPath: "key",
          });
        }
        if (!database.objectStoreNames.contains(CASH_ACCOUNT_STORE)) {
          database.createObjectStore(CASH_ACCOUNT_STORE, {
            keyPath: "key",
          });
        }
        if (!database.objectStoreNames.contains(BROKER_PORTFOLIO_STORE)) {
          database.createObjectStore(BROKER_PORTFOLIO_STORE, {
            keyPath: "key",
          });
        }
        if (
          !database.objectStoreNames.contains(
            LEGACY_BROKER_LEDGER_STORE,
          )
        ) {
          database.createObjectStore(LEGACY_BROKER_LEDGER_STORE, {
            keyPath: "backupId",
            autoIncrement: true,
          });
        }

        if (
          event.oldVersion > 0 &&
          event.oldVersion < 2 &&
          database.objectStoreNames.contains(
            LEGACY_LEDGER_SOURCE_STORE,
          )
        ) {
          const source = transaction.objectStore(
            LEGACY_LEDGER_SOURCE_STORE,
          );
          const legacy = transaction.objectStore(
            LEGACY_BROKER_LEDGER_STORE,
          );
          const cursorRequest = source.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor === null) {
              return;
            }
            legacy.add({
              sourceStore: LEGACY_LEDGER_SOURCE_STORE,
              sourceKey: cursor.primaryKey,
              record: cursor.value,
            } satisfies StoredLegacyBrokerLedgerBackup);
            cursor.continue();
          };
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
          new PositionRepositoryError(
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
          new PositionRepositoryError(
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
