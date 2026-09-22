import {
  applyBrokerTrade as applyTradeToBrokerPortfolio,
  createBrokerPortfolioBook,
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
  type ReplaceBrokerPortfolioOptions,
} from "../brokerage/types.ts";
import {
  cloneCashSnapshot,
  type CashSnapshot,
  type ReplaceCashSnapshotOptions,
} from "../cash/types.ts";
import {
  parsePositionBackupDocument,
  type PositionBackupDocument,
  type PositionBackupRestoreResult,
} from "../positions/position-backup.ts";
import {
  clonePositionBatch,
  clonePositionSnapshot,
  createPositionBatch,
  PositionRepositoryError,
  validateSavedAt,
  type PositionBatch,
  type PositionSnapshot,
  type ReplacePositionBatchOptions,
} from "../positions/types.ts";

export const CLOUD_PORTFOLIO_STATE_FORMAT_VERSION = 1;
export const MAX_CLOUD_PORTFOLIO_POSITIONS = 100;

export interface CloudStoredPosition {
  readonly key: string;
  readonly current: PositionSnapshot;
  readonly previous: PositionSnapshot | null;
  readonly nextRevision: number;
}

export interface CloudStoredCash {
  readonly current: CashSnapshot;
  readonly previous: CashSnapshot | null;
  readonly nextRevision: number;
}

export interface CloudStoredBrokerPortfolio {
  readonly current: BrokerPortfolioBook;
  readonly previous: BrokerPortfolioBook | null;
  readonly nextRevision: number;
}

export interface CloudPortfolioState {
  readonly formatVersion: typeof CLOUD_PORTFOLIO_STATE_FORMAT_VERSION;
  readonly positions: readonly CloudStoredPosition[];
  readonly cash: CloudStoredCash | null;
  readonly broker: CloudStoredBrokerPortfolio | null;
}

export interface CloudPortfolioStateView {
  readonly kind: "CLOUD_PORTFOLIO_STATE";
  readonly version: typeof CLOUD_PORTFOLIO_STATE_FORMAT_VERSION;
  readonly stateRevision: number;
  readonly snapshots: readonly PositionSnapshot[];
  readonly previousSnapshots: readonly PositionSnapshot[];
  readonly cash: CashSnapshot | null;
  readonly previousCash: CashSnapshot | null;
  readonly brokerBook: BrokerPortfolioBook | null;
  readonly previousBrokerBook: BrokerPortfolioBook | null;
}

export type CloudPortfolioMutation =
  | {
      readonly action: "REPLACE_BATCH" | "ADD_INPUTS";
      readonly batch: PositionBatch;
      readonly options: ReplacePositionBatchOptions;
    }
  | {
      readonly action: "DELETE_POSITION";
      readonly instrument: InstrumentKey;
      readonly options: ReplacePositionBatchOptions;
    }
  | {
      readonly action: "UNDO_POSITION";
      readonly instrument: InstrumentKey;
    }
  | {
      readonly action: "REPLACE_CASH";
      readonly account: IbkrUsdCashAccount;
      readonly options: ReplaceCashSnapshotOptions;
    }
  | {
      readonly action: "DELETE_CASH";
      readonly options: ReplaceCashSnapshotOptions;
    }
  | {
      readonly action: "RECONCILE_BROKER";
      readonly baseline: BrokerPortfolioBaselineInput;
      readonly options: ReplaceBrokerPortfolioOptions;
    }
  | {
      readonly action: "APPLY_BROKER_TRADE";
      readonly trade: ApplyBrokerTradeInput;
      readonly options: ApplyBrokerTradeOptions;
    }
  | {
      readonly action: "RESTORE_V2";
      readonly backup: PositionBackupDocument;
    }
  | {
      readonly action: "RESTORE_V3";
      readonly book: BrokerPortfolioBook;
    };

export interface CloudPortfolioMutationResult {
  readonly state: CloudPortfolioState;
  readonly changed: boolean;
  readonly restoreResult?: PositionBackupRestoreResult;
}

export function emptyCloudPortfolioState(): CloudPortfolioState {
  return {
    formatVersion: CLOUD_PORTFOLIO_STATE_FORMAT_VERSION,
    positions: [],
    cash: null,
    broker: null,
  };
}

function invalidPersisted(message: string): never {
  throw new PositionRepositoryError(
    "INVALID_PERSISTED_POSITION_DATA",
    message,
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidPersisted(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).toSorted();
  const expected = [...required].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalidPersisted(`${path} contains missing or unknown fields`);
  }
}

function nextRevision(
  value: unknown,
  currentRevision: number,
  path: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value !== currentRevision + 1
  ) {
    invalidPersisted(`${path} has an invalid next revision`);
  }
  return value;
}

function storedPosition(value: unknown, index: number): CloudStoredPosition {
  const path = `cloudState.positions[${index}]`;
  const candidate = record(value, path);
  exactKeys(candidate, ["key", "current", "previous", "nextRevision"], path);
  if (typeof candidate.key !== "string") {
    invalidPersisted(`${path}.key must be a string`);
  }
  const current = clonePositionSnapshot(candidate.current as PositionSnapshot);
  const previous =
    candidate.previous === null
      ? null
      : clonePositionSnapshot(candidate.previous as PositionSnapshot);
  const key = instrumentKeyId(current.batch.instrument);
  if (
    candidate.key !== key ||
    (previous !== null &&
      (instrumentKeyId(previous.batch.instrument) !== key ||
        previous.revision >= current.revision))
  ) {
    invalidPersisted(`${path} has an invalid snapshot chain`);
  }
  return {
    key,
    current,
    previous,
    nextRevision: nextRevision(
      candidate.nextRevision,
      current.revision,
      `${path}.nextRevision`,
    ),
  };
}

function storedCash(value: unknown): CloudStoredCash {
  const path = "cloudState.cash";
  const candidate = record(value, path);
  exactKeys(candidate, ["current", "previous", "nextRevision"], path);
  const current = cloneCashSnapshot(candidate.current as CashSnapshot);
  const previous =
    candidate.previous === null
      ? null
      : cloneCashSnapshot(candidate.previous as CashSnapshot);
  if (previous !== null && previous.revision >= current.revision) {
    invalidPersisted(`${path} has an invalid snapshot chain`);
  }
  return {
    current,
    previous,
    nextRevision: nextRevision(
      candidate.nextRevision,
      current.revision,
      `${path}.nextRevision`,
    ),
  };
}

function storedBroker(value: unknown): CloudStoredBrokerPortfolio {
  const path = "cloudState.broker";
  const candidate = record(value, path);
  exactKeys(candidate, ["current", "previous", "nextRevision"], path);
  const current = createBrokerPortfolioBook(
    candidate.current as BrokerPortfolioBook,
  );
  const previous =
    candidate.previous === null
      ? null
      : createBrokerPortfolioBook(candidate.previous as BrokerPortfolioBook);
  if (previous !== null && previous.revision >= current.revision) {
    invalidPersisted(`${path} has an invalid book chain`);
  }
  return {
    current,
    previous,
    nextRevision: nextRevision(
      candidate.nextRevision,
      current.revision,
      `${path}.nextRevision`,
    ),
  };
}

export function createCloudPortfolioState(value: unknown): CloudPortfolioState {
  const candidate = record(value, "cloudState");
  exactKeys(candidate, ["formatVersion", "positions", "cash", "broker"], "cloudState");
  if (candidate.formatVersion !== CLOUD_PORTFOLIO_STATE_FORMAT_VERSION) {
    invalidPersisted("cloudState has an unsupported format version");
  }
  if (!Array.isArray(candidate.positions)) {
    invalidPersisted("cloudState.positions must be an array");
  }
  if (candidate.positions.length > MAX_CLOUD_PORTFOLIO_POSITIONS) {
    invalidPersisted("cloudState contains too many positions");
  }
  const positions = candidate.positions.map(storedPosition);
  const keys = new Set<string>();
  for (const position of positions) {
    if (keys.has(position.key)) {
      invalidPersisted(`cloudState contains duplicate position ${position.key}`);
    }
    keys.add(position.key);
  }
  return {
    formatVersion: CLOUD_PORTFOLIO_STATE_FORMAT_VERSION,
    positions: positions.toSorted((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    ),
    cash: candidate.cash === null ? null : storedCash(candidate.cash),
    broker: candidate.broker === null ? null : storedBroker(candidate.broker),
  };
}

export function cloudPortfolioStateView(
  stateInput: CloudPortfolioState,
  stateRevision: number,
): CloudPortfolioStateView {
  if (!Number.isSafeInteger(stateRevision) || stateRevision < 0) {
    invalidPersisted("cloud state revision must be a non-negative safe integer");
  }
  const state = createCloudPortfolioState(stateInput);
  return {
    kind: "CLOUD_PORTFOLIO_STATE",
    version: CLOUD_PORTFOLIO_STATE_FORMAT_VERSION,
    stateRevision,
    snapshots: state.positions.map((entry) => entry.current),
    previousSnapshots: state.positions.flatMap((entry) =>
      entry.previous === null ? [] : [entry.previous],
    ),
    cash: state.cash?.current ?? null,
    previousCash: state.cash?.previous ?? null,
    brokerBook: state.broker?.current ?? null,
    previousBrokerBook: state.broker?.previous ?? null,
  };
}

function requireExpectedRevision(
  currentRevision: number | null,
  expectedRevision: number | null | undefined,
  code:
    | "POSITION_SNAPSHOT_CONFLICT"
    | "CASH_SNAPSHOT_CONFLICT"
    | "BROKER_PORTFOLIO_CONFLICT",
): void {
  if (expectedRevision === undefined) {
    return;
  }
  if (
    expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw new PositionRepositoryError(code, "expected revision is invalid");
  }
  if (expectedRevision !== currentRevision) {
    throw new PositionRepositoryError(
      code,
      "portfolio data changed after it was read",
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

function addInputs(
  existing: CloudStoredPosition | null,
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
  return createPositionBatch({
    instrument: existing.current.batch.instrument,
    ...(additions.displayName ?? existing.current.batch.displayName
      ? { displayName: additions.displayName ?? existing.current.batch.displayName }
      : {}),
    inputs: [...existing.current.batch.inputs, ...addedInputs],
  });
}

function withPosition(
  state: CloudPortfolioState,
  record: CloudStoredPosition,
): CloudPortfolioState {
  return createCloudPortfolioState({
    ...state,
    positions: [
      ...state.positions.filter((candidate) => candidate.key !== record.key),
      record,
    ],
  });
}

function targetIsEmpty(state: CloudPortfolioState): boolean {
  return state.positions.length === 0 && state.cash === null && state.broker === null;
}

export function applyCloudPortfolioMutation(
  stateInput: CloudPortfolioState,
  mutation: CloudPortfolioMutation,
  nowInput: string,
): CloudPortfolioMutationResult {
  const state = createCloudPortfolioState(stateInput);
  const now = validateSavedAt(nowInput, "cloudPortfolio.savedAt");

  if (mutation.action === "REPLACE_BATCH" || mutation.action === "ADD_INPUTS") {
    const batch = clonePositionBatch(createPositionBatch(mutation.batch));
    const key = instrumentKeyId(batch.instrument);
    const existing = state.positions.find((entry) => entry.key === key) ?? null;
    requireExpectedRevision(
      existing?.current.revision ?? null,
      mutation.options.expectedRevision,
      "POSITION_SNAPSHOT_CONFLICT",
    );
    const revision = existing?.nextRevision ?? 1;
    if (!Number.isSafeInteger(revision + 1)) {
      invalidPersisted("position revision limit has been reached");
    }
    const current: PositionSnapshot = {
      revision,
      savedAt: now,
      batch:
        mutation.action === "ADD_INPUTS"
          ? addInputs(existing, batch, revision)
          : batch,
    };
    return {
      state: withPosition(state, {
        key,
        current,
        previous: existing?.current ?? null,
        nextRevision: revision + 1,
      }),
      changed: true,
    };
  }

  if (mutation.action === "DELETE_POSITION") {
    const instrument = createInstrumentKey(mutation.instrument);
    const key = instrumentKeyId(instrument);
    const existing = state.positions.find((entry) => entry.key === key) ?? null;
    requireExpectedRevision(
      existing?.current.revision ?? null,
      mutation.options.expectedRevision,
      "POSITION_SNAPSHOT_CONFLICT",
    );
    if (existing === null) {
      return { state, changed: false };
    }
    return {
      state: createCloudPortfolioState({
        ...state,
        positions: state.positions.filter((entry) => entry.key !== key),
      }),
      changed: true,
    };
  }

  if (mutation.action === "UNDO_POSITION") {
    const key = instrumentKeyId(createInstrumentKey(mutation.instrument));
    const existing = state.positions.find((entry) => entry.key === key) ?? null;
    if (existing?.previous === null || existing === null) {
      return { state, changed: false };
    }
    const restored = clonePositionSnapshot(existing.previous);
    return {
      state: withPosition(state, {
        key,
        current: restored,
        previous: null,
        nextRevision: restored.revision + 1,
      }),
      changed: true,
    };
  }

  if (mutation.action === "REPLACE_CASH") {
    const account = createIbkrUsdCashAccount(mutation.account);
    const existing = state.cash;
    requireExpectedRevision(
      existing?.current.revision ?? null,
      mutation.options.expectedRevision,
      "CASH_SNAPSHOT_CONFLICT",
    );
    const revision = existing?.nextRevision ?? 1;
    const current: CashSnapshot = { revision, savedAt: now, account };
    return {
      state: createCloudPortfolioState({
        ...state,
        cash: {
          current,
          previous: existing?.current ?? null,
          nextRevision: revision + 1,
        },
      }),
      changed: true,
    };
  }

  if (mutation.action === "DELETE_CASH") {
    requireExpectedRevision(
      state.cash?.current.revision ?? null,
      mutation.options.expectedRevision,
      "CASH_SNAPSHOT_CONFLICT",
    );
    if (state.cash === null) {
      return { state, changed: false };
    }
    return {
      state: createCloudPortfolioState({ ...state, cash: null }),
      changed: true,
    };
  }

  if (mutation.action === "RECONCILE_BROKER") {
    requireExpectedRevision(
      state.broker?.current.revision ?? null,
      mutation.options.expectedRevision,
      "BROKER_PORTFOLIO_CONFLICT",
    );
    const current = reconcileBrokerPortfolio(
      state.broker?.current ?? null,
      mutation.baseline,
      now,
      mutation.options.eventId,
    );
    return {
      state: createCloudPortfolioState({
        ...state,
        broker: {
          current,
          previous: state.broker?.current ?? null,
          nextRevision: current.revision + 1,
        },
      }),
      changed: true,
    };
  }

  if (mutation.action === "APPLY_BROKER_TRADE") {
    if (state.broker === null) {
      throw new PositionRepositoryError(
        "BROKER_PORTFOLIO_NOT_CALIBRATED",
        "broker portfolio must be calibrated before recording trades",
      );
    }
    requireExpectedRevision(
      state.broker.current.revision,
      mutation.options.expectedRevision,
      "BROKER_PORTFOLIO_CONFLICT",
    );
    const current = applyTradeToBrokerPortfolio(
      state.broker.current,
      mutation.trade,
      now,
    );
    return {
      state: createCloudPortfolioState({
        ...state,
        broker: {
          current,
          previous: state.broker.current,
          nextRevision: current.revision + 1,
        },
      }),
      changed: true,
    };
  }

  if (mutation.action === "RESTORE_V2") {
    if (!targetIsEmpty(state)) {
      throw new PositionRepositoryError(
        "BACKUP_RESTORE_TARGET_NOT_EMPTY",
        "cloud restore requires the account portfolio to be empty",
      );
    }
    const backup = parsePositionBackupDocument(mutation.backup);
    const positions: CloudStoredPosition[] = backup.snapshots.map((source) => ({
      key: instrumentKeyId(source.batch.instrument),
      current: { ...source, revision: 1 },
      previous: null,
      nextRevision: 2,
    }));
    const cash: CloudStoredCash | null =
      backup.cash === null
        ? null
        : {
            current: { ...backup.cash, revision: 1 },
            previous: null,
            nextRevision: 2,
          };
    return {
      state: createCloudPortfolioState({
        formatVersion: CLOUD_PORTFOLIO_STATE_FORMAT_VERSION,
        positions,
        cash,
        broker: null,
      }),
      changed: positions.length > 0 || cash !== null,
      restoreResult: {
        positionCount: positions.length,
        cashRestored: cash !== null,
      },
    };
  }

  if (mutation.action !== "RESTORE_V3") {
    invalidPersisted("unsupported cloud portfolio mutation");
  }
  if (!targetIsEmpty(state)) {
    throw new PositionRepositoryError(
      "BACKUP_RESTORE_TARGET_NOT_EMPTY",
      "cloud restore requires the account portfolio to be empty",
    );
  }
  const source = createBrokerPortfolioBook(mutation.book);
  const current = createBrokerPortfolioBook({
    ...source,
    revision: 1,
    savedAt: now,
  });
  return {
    state: createCloudPortfolioState({
      formatVersion: CLOUD_PORTFOLIO_STATE_FORMAT_VERSION,
      positions: [],
      cash: null,
      broker: {
        current,
        previous: null,
        nextRevision: 2,
      },
    }),
    changed: true,
  };
}

export function cloneCloudPortfolioBook(
  book: BrokerPortfolioBook | null,
): BrokerPortfolioBook | null {
  return book === null ? null : cloneBrokerPortfolioBook(book);
}
