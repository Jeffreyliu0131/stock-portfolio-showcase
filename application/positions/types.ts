import {
  DomainValidationError,
  aggregatePositionInputs,
  createInstrumentKey,
  createPositionInput,
  instrumentKeyId,
  rfc3339ToEpochNanoseconds,
  sameInstrument,
  type InstrumentKey,
  type PositionInput,
  type UnifiedPosition,
} from "../../domain/index.ts";

export interface PositionBatch {
  readonly instrument: InstrumentKey;
  readonly displayName?: string;
  readonly inputs: readonly PositionInput[];
}

export interface PositionSnapshot {
  readonly revision: number;
  readonly savedAt: string;
  readonly batch: PositionBatch;
}

export interface PositionDraft {
  readonly savedAt: string;
  readonly batch: PositionBatch;
}

export interface PositionEntryDraftRow {
  readonly id: string;
  readonly quantity: string;
  readonly costValue: string;
  readonly costMode?: string;
}

export interface PositionEntryDraft {
  readonly symbol: string;
  readonly displayName: string;
  readonly listingMarket: string;
  readonly currency: string;
  readonly costMode: string;
  readonly rows: readonly PositionEntryDraftRow[];
}

export const POSITION_ENTRY_DRAFT_LIMITS = {
  symbol: 32,
  displayName: 200,
  listingMarket: 64,
  currency: 3,
  costMode: 32,
  rows: 100,
  rowId: 100,
  quantity: 128,
  costValue: 128,
} as const;

export interface PositionRepository {
  listSnapshots(): Promise<readonly PositionSnapshot[]>;
  getSnapshot(
    instrument: InstrumentKey,
  ): Promise<PositionSnapshot | null>;
  getPreviousSnapshot(
    instrument: InstrumentKey,
  ): Promise<PositionSnapshot | null>;
  replaceBatch(
    batch: PositionBatch,
    options?: ReplacePositionBatchOptions,
  ): Promise<PositionSnapshot>;
  addInputsToBatch(
    batch: PositionBatch,
    options?: ReplacePositionBatchOptions,
  ): Promise<PositionSnapshot>;
  deleteSnapshot(
    instrument: InstrumentKey,
    options?: ReplacePositionBatchOptions,
  ): Promise<boolean>;
  undoLatest(
    instrument: InstrumentKey,
  ): Promise<PositionSnapshot | null>;
  getDraft(instrument: InstrumentKey): Promise<PositionDraft | null>;
  saveDraft(batch: PositionBatch): Promise<PositionDraft>;
  clearDraft(instrument: InstrumentKey): Promise<void>;
  getEntryDraft(): Promise<PositionEntryDraft | null>;
  saveEntryDraft(
    draft: PositionEntryDraft,
  ): Promise<PositionEntryDraft>;
  clearEntryDraft(): Promise<void>;
}

export interface ReplacePositionBatchOptions {
  readonly expectedRevision?: number | null;
}

export type PositionRepositoryErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "BACKUP_RESTORE_TARGET_NOT_EMPTY"
  | "BROKER_PORTFOLIO_CONFLICT"
  | "BROKER_PORTFOLIO_NOT_CALIBRATED"
  | "CASH_SNAPSHOT_CONFLICT"
  | "CLOUD_PORTFOLIO_CONFLICT"
  | "CLOUD_PORTFOLIO_UNAVAILABLE"
  | "INDEXED_DB_OPEN_FAILED"
  | "INDEXED_DB_TRANSACTION_FAILED"
  | "INDEXED_DB_UNAVAILABLE"
  | "INVALID_PERSISTED_POSITION_DATA"
  | "POSITION_SNAPSHOT_CONFLICT";

export class PositionRepositoryError extends Error {
  readonly code: PositionRepositoryErrorCode;

  constructor(code: PositionRepositoryErrorCode, message: string) {
    super(message);
    this.name = "PositionRepositoryError";
    this.code = code;
  }
}

export function createPositionBatch(batch: PositionBatch): PositionBatch {
  if (
    typeof batch !== "object" ||
    batch === null ||
    !Array.isArray(batch.inputs)
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "position batch has an invalid shape",
    );
  }
  const instrument = createInstrumentKey(batch.instrument);
  const displayName =
    batch.displayName === undefined ? undefined : batch.displayName.trim();
  if (displayName !== undefined && displayName.length === 0) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "position batch displayName must not be empty when provided",
    );
  }
  if (
    displayName !== undefined &&
    displayName.length > POSITION_ENTRY_DRAFT_LIMITS.displayName
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      `position batch displayName must contain at most ${POSITION_ENTRY_DRAFT_LIMITS.displayName} characters`,
    );
  }
  if (batch.inputs.length === 0) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "a position batch must contain at least one input",
    );
  }

  const inputIds = new Set<string>();
  const inputs = batch.inputs.map((inputValue) => {
    const input = createPositionInput(inputValue);
    if (!sameInstrument(instrument, input.instrument)) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        "every input in a position batch must match the batch instrument",
      );
    }
    if (inputIds.has(input.id)) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        `duplicate position input id in batch: ${input.id}`,
      );
    }
    inputIds.add(input.id);
    return input;
  });

  return {
    instrument,
    ...(displayName === undefined ? {} : { displayName }),
    inputs,
  };
}

export function clonePositionBatch(batch: PositionBatch): PositionBatch {
  const validated = createPositionBatch(batch);
  return {
    instrument: { ...validated.instrument },
    ...(validated.displayName === undefined
      ? {}
      : { displayName: validated.displayName }),
    inputs: validated.inputs.map((input) => ({
      id: input.id,
      instrument: { ...input.instrument },
      quantity: input.quantity,
      costInput: { ...input.costInput },
    })),
  };
}

export function clonePositionSnapshot(
  snapshot: PositionSnapshot,
): PositionSnapshot {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "position snapshot revision must be a positive safe integer",
    );
  }
  validateSavedAt(snapshot.savedAt, "positionSnapshot.savedAt");
  return {
    revision: snapshot.revision,
    savedAt: snapshot.savedAt,
    batch: clonePositionBatch(snapshot.batch),
  };
}

export function clonePositionDraft(draft: PositionDraft): PositionDraft {
  if (typeof draft !== "object" || draft === null) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "position draft has an invalid shape",
    );
  }
  validateSavedAt(draft.savedAt, "positionDraft.savedAt");
  return {
    savedAt: draft.savedAt,
    batch: clonePositionBatch(draft.batch),
  };
}

function boundedDraftText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      `${field} must be a string`,
    );
  }
  if (value.length > maxLength) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      `${field} must contain at most ${maxLength} characters`,
    );
  }
  return value;
}

export function clonePositionEntryDraft(
  draft: PositionEntryDraft,
): PositionEntryDraft {
  if (
    typeof draft !== "object" ||
    draft === null ||
    !Array.isArray(draft.rows)
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "position entry draft has an invalid shape",
    );
  }
  if (draft.rows.length > POSITION_ENTRY_DRAFT_LIMITS.rows) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      `position entry draft supports at most ${POSITION_ENTRY_DRAFT_LIMITS.rows} rows`,
    );
  }
  const rowIds = new Set<string>();
  return {
    symbol: boundedDraftText(
      draft.symbol,
      "positionEntryDraft.symbol",
      POSITION_ENTRY_DRAFT_LIMITS.symbol,
    ),
    displayName: boundedDraftText(
      draft.displayName,
      "positionEntryDraft.displayName",
      POSITION_ENTRY_DRAFT_LIMITS.displayName,
    ),
    listingMarket: boundedDraftText(
      draft.listingMarket,
      "positionEntryDraft.listingMarket",
      POSITION_ENTRY_DRAFT_LIMITS.listingMarket,
    ),
    currency: boundedDraftText(
      draft.currency,
      "positionEntryDraft.currency",
      POSITION_ENTRY_DRAFT_LIMITS.currency,
    ),
    costMode: boundedDraftText(
      draft.costMode,
      "positionEntryDraft.costMode",
      POSITION_ENTRY_DRAFT_LIMITS.costMode,
    ),
    rows: draft.rows.map((row, index) => {
      if (typeof row !== "object" || row === null) {
        throw new PositionRepositoryError(
          "INVALID_PERSISTED_POSITION_DATA",
          `positionEntryDraft.rows[${index}] has an invalid shape`,
        );
      }
      const id = boundedDraftText(
        row.id,
        `positionEntryDraft.rows[${index}].id`,
        POSITION_ENTRY_DRAFT_LIMITS.rowId,
      );
      if (
        id.length === 0 ||
        id.trim() !== id ||
        rowIds.has(id)
      ) {
        throw new PositionRepositoryError(
          "INVALID_PERSISTED_POSITION_DATA",
          `positionEntryDraft.rows[${index}].id must be unique and canonical`,
        );
      }
      rowIds.add(id);
      const costMode =
        row.costMode === undefined
          ? undefined
          : boundedDraftText(
              row.costMode,
              `positionEntryDraft.rows[${index}].costMode`,
              POSITION_ENTRY_DRAFT_LIMITS.costMode,
            );
      return {
        id,
        quantity: boundedDraftText(
          row.quantity,
          `positionEntryDraft.rows[${index}].quantity`,
          POSITION_ENTRY_DRAFT_LIMITS.quantity,
        ),
        costValue: boundedDraftText(
          row.costValue,
          `positionEntryDraft.rows[${index}].costValue`,
          POSITION_ENTRY_DRAFT_LIMITS.costValue,
        ),
        ...(costMode === undefined ? {} : { costMode }),
      };
    }),
  };
}

export function positionBatchKey(batch: PositionBatch): string {
  return instrumentKeyId(createPositionBatch(batch).instrument);
}

export function validateSavedAt(value: string, field: string): string {
  try {
    rfc3339ToEpochNanoseconds(value, field);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        error.message,
      );
    }
    throw error;
  }
  return value;
}

export async function loadUnifiedPositions(
  repository: PositionRepository,
): Promise<readonly UnifiedPosition[]> {
  const snapshots = await repository.listSnapshots();
  return aggregatePositionInputs(
    snapshots.flatMap((snapshot) => snapshot.batch.inputs),
  );
}
