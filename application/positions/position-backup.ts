import {
  Decimal,
  aggregatePositionInputs,
  canonicalDecimal,
  instrumentKeyId,
  type InstrumentKey,
  type PositionInput,
} from "../../domain/index.ts";
import { resolveSupportedInstrument } from "../instruments/supported-instruments.ts";
import {
  cloneCashSnapshot,
  type CashSnapshot,
} from "../cash/types.ts";
import {
  clonePositionSnapshot,
  validateSavedAt,
  type PositionSnapshot,
} from "./types.ts";

export const POSITION_BACKUP_FORMAT =
  "stock-portfolio-calculator-position-backup";
export const POSITION_BACKUP_FORMAT_VERSION = 2;

export interface PositionBackupDocument {
  readonly format: typeof POSITION_BACKUP_FORMAT;
  readonly formatVersion: typeof POSITION_BACKUP_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly snapshots: readonly PositionSnapshot[];
  readonly cash: CashSnapshot | null;
}

export interface PositionBackupFile {
  readonly fileName: string;
  readonly mediaType: "application/json";
  readonly contents: string;
}

export type PositionBackupValidationErrorCode =
  | "DUPLICATE_INSTRUMENT"
  | "INVALID_BACKUP_CONTENT"
  | "INVALID_BACKUP_FORMAT"
  | "INVALID_JSON"
  | "UNSUPPORTED_BACKUP_VERSION";

export class PositionBackupValidationError extends Error {
  readonly code: PositionBackupValidationErrorCode;

  constructor(
    code: PositionBackupValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PositionBackupValidationError";
    this.code = code;
  }
}

export interface PositionBackupPositionPreview {
  readonly instrument: InstrumentKey;
  readonly displayName?: string;
  readonly revision: number;
  readonly savedAt: string;
  readonly inputCount: number;
  readonly quantity: string;
  readonly openCost: string;
  readonly averageCost: string;
}

export interface PositionBackupCurrencyPreview {
  readonly currency: string;
  readonly stockOpenCost: string;
  readonly cashBalance: string | null;
  readonly recordedPrincipal: string;
}

export interface PositionBackupPreview {
  readonly exportedAt: string;
  readonly positionCount: number;
  readonly inputCount: number;
  readonly positions: readonly PositionBackupPositionPreview[];
  readonly cash: CashSnapshot | null;
  readonly currencyTotals: readonly PositionBackupCurrencyPreview[];
}

export interface PositionBackupRestoreResult {
  readonly positionCount: number;
  readonly cashRestored: boolean;
}

export interface PositionBackupRestorer {
  restoreCurrentBackup(
    backup: PositionBackupDocument,
  ): Promise<PositionBackupRestoreResult>;
}

type UnknownRecord = Record<string, unknown>;

function invalidContent(message: string): never {
  throw new PositionBackupValidationError(
    "INVALID_BACKUP_CONTENT",
    message,
  );
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalidContent(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalidContent(`${path} must be a plain object`);
  }
  return value as UnknownRecord;
}

function requireExactKeys(
  value: UnknownRecord,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      invalidContent(`${path} contains an unknown field: ${String(key)}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      invalidContent(`${path} is missing required field: ${key}`);
    }
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    invalidContent(`${path} must be a string`);
  }
  return value;
}

function requirePositiveRevision(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >= Number.MAX_SAFE_INTEGER
  ) {
    invalidContent(
      `${path} must be a positive safe integer below the revision limit`,
    );
  }
  return value;
}

function parseInstrument(value: unknown, path: string): InstrumentKey {
  const record = requireRecord(value, path);
  requireExactKeys(record, path, [
    "listingMarket",
    "symbol",
    "currency",
  ]);
  const resolved = resolveSupportedInstrument({
    listingMarket: requireString(
      record.listingMarket,
      `${path}.listingMarket`,
    ),
    symbol: requireString(record.symbol, `${path}.symbol`),
    currency: requireString(record.currency, `${path}.currency`),
  });
  if (!resolved.ok) {
    invalidContent(`${path} is not a supported US-listed USD instrument`);
  }
  return resolved.instrument;
}

function parsePositionSnapshot(
  value: unknown,
  path: string,
): PositionSnapshot {
  const snapshot = requireRecord(value, path);
  requireExactKeys(snapshot, path, ["revision", "savedAt", "batch"]);
  const batch = requireRecord(snapshot.batch, `${path}.batch`);
  requireExactKeys(
    batch,
    `${path}.batch`,
    ["instrument", "inputs"],
    ["displayName"],
  );
  const instrument = parseInstrument(
    batch.instrument,
    `${path}.batch.instrument`,
  );
  if (!Array.isArray(batch.inputs)) {
    invalidContent(`${path}.batch.inputs must be an array`);
  }
  const inputs = batch.inputs.map((inputValue, index): PositionInput => {
    const inputPath = `${path}.batch.inputs[${index}]`;
    const input = requireRecord(inputValue, inputPath);
    requireExactKeys(input, inputPath, [
      "id",
      "instrument",
      "quantity",
      "costInput",
    ]);
    const costPath = `${inputPath}.costInput`;
    const costInput = requireRecord(input.costInput, costPath);
    requireExactKeys(costInput, costPath, ["mode", "value"]);
    const mode = requireString(costInput.mode, `${costPath}.mode`);
    if (mode !== "AVERAGE_COST" && mode !== "TOTAL_OPEN_COST") {
      invalidContent(
        `${costPath}.mode must be AVERAGE_COST or TOTAL_OPEN_COST`,
      );
    }
    return {
      id: requireString(input.id, `${inputPath}.id`),
      instrument: parseInstrument(
        input.instrument,
        `${inputPath}.instrument`,
      ),
      quantity: requireString(
        input.quantity,
        `${inputPath}.quantity`,
      ),
      costInput: {
        mode,
        value: requireString(costInput.value, `${costPath}.value`),
      },
    };
  });
  const displayName = Object.hasOwn(batch, "displayName")
    ? requireString(batch.displayName, `${path}.batch.displayName`)
    : undefined;

  return clonePositionSnapshot({
    revision: requirePositiveRevision(
      snapshot.revision,
      `${path}.revision`,
    ),
    savedAt: requireString(snapshot.savedAt, `${path}.savedAt`),
    batch: {
      instrument,
      ...(displayName === undefined ? {} : { displayName }),
      inputs,
    },
  });
}

function parseCashSnapshot(value: unknown, path: string): CashSnapshot {
  const snapshot = requireRecord(value, path);
  requireExactKeys(snapshot, path, ["revision", "savedAt", "account"]);
  const account = requireRecord(snapshot.account, `${path}.account`);
  requireExactKeys(account, `${path}.account`, [
    "provider",
    "currency",
    "balance",
    "netAssetValue",
    "navSource",
    "pricingPlan",
  ]);
  return cloneCashSnapshot({
    revision: requirePositiveRevision(
      snapshot.revision,
      `${path}.revision`,
    ),
    savedAt: requireString(snapshot.savedAt, `${path}.savedAt`),
    account: {
      provider: requireString(
        account.provider,
        `${path}.account.provider`,
      ) as "IBKR",
      currency: requireString(
        account.currency,
        `${path}.account.currency`,
      ) as "USD",
      balance: requireString(
        account.balance,
        `${path}.account.balance`,
      ),
      netAssetValue: requireString(
        account.netAssetValue,
        `${path}.account.netAssetValue`,
      ),
      navSource: requireString(
        account.navSource,
        `${path}.account.navSource`,
      ) as "USER_ENTERED" | "CASH_BALANCE_FALLBACK",
      pricingPlan: requireString(
        account.pricingPlan,
        `${path}.account.pricingPlan`,
      ) as "IBKR_PRO" | "IBKR_LITE",
    },
  });
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function registerRestorableSnapshotIdentity(
  snapshot: PositionSnapshot,
  keys: Set<string>,
  symbols: Set<string>,
  path: string,
): void {
  const resolved = resolveSupportedInstrument(snapshot.batch.instrument);
  if (!resolved.ok) {
    invalidContent(
      `${path}.batch.instrument is not a supported US-listed USD instrument`,
    );
  }

  const key = instrumentKeyId(resolved.instrument);
  if (keys.has(key)) {
    throw new PositionBackupValidationError(
      "DUPLICATE_INSTRUMENT",
      `position backup contains duplicate current snapshot: ${key}`,
    );
  }
  if (symbols.has(resolved.instrument.symbol)) {
    throw new PositionBackupValidationError(
      "DUPLICATE_INSTRUMENT",
      `position backup contains the same symbol under multiple instruments: ${resolved.instrument.symbol}`,
    );
  }
  keys.add(key);
  symbols.add(resolved.instrument.symbol);
}

/**
 * Strictly validates an already decoded JSON value as the current v2
 * backup contract. Unknown fields are rejected so previous versions,
 * drafts, caches, or other internal state cannot become restore input.
 */
export function parsePositionBackupDocument(
  input: unknown,
): PositionBackupDocument {
  try {
    const document = requireRecord(input, "positionBackup");
    requireExactKeys(document, "positionBackup", [
      "format",
      "formatVersion",
      "exportedAt",
      "snapshots",
      "cash",
    ]);
    if (document.format !== POSITION_BACKUP_FORMAT) {
      throw new PositionBackupValidationError(
        "INVALID_BACKUP_FORMAT",
        "position backup format is not recognized",
      );
    }
    if (document.formatVersion !== POSITION_BACKUP_FORMAT_VERSION) {
      throw new PositionBackupValidationError(
        "UNSUPPORTED_BACKUP_VERSION",
        `position backup version must be ${POSITION_BACKUP_FORMAT_VERSION}`,
      );
    }
    if (!Array.isArray(document.snapshots)) {
      invalidContent("positionBackup.snapshots must be an array");
    }
    const keys = new Set<string>();
    const symbols = new Set<string>();
    const snapshots = document.snapshots.map((value, index) => {
      const snapshot = parsePositionSnapshot(
        value,
        `positionBackup.snapshots[${index}]`,
      );
      registerRestorableSnapshotIdentity(
        snapshot,
        keys,
        symbols,
        `positionBackup.snapshots[${index}]`,
      );
      return snapshot;
    });
    const cash =
      document.cash === null
        ? null
        : parseCashSnapshot(document.cash, "positionBackup.cash");
    return createPositionBackupDocument(
      snapshots,
      requireString(document.exportedAt, "positionBackup.exportedAt"),
      cash,
    );
  } catch (error) {
    if (error instanceof PositionBackupValidationError) {
      throw error;
    }
    throw new PositionBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      `position backup content is invalid: ${errorDetail(error)}`,
    );
  }
}

export function parsePositionBackupJson(
  contents: string,
): PositionBackupDocument {
  let input: unknown;
  try {
    input = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new PositionBackupValidationError(
      "INVALID_JSON",
      `position backup is not valid JSON: ${errorDetail(error)}`,
    );
  }
  return parsePositionBackupDocument(input);
}

export function createPositionBackupPreview(
  backupInput: PositionBackupDocument,
): PositionBackupPreview {
  const backup = parsePositionBackupDocument(backupInput);
  const openCostByCurrency = new Map<string, InstanceType<typeof Decimal>>();
  let inputCount = 0;
  const positions = backup.snapshots.map(
    (snapshot): PositionBackupPositionPreview => {
      const [position] = aggregatePositionInputs(snapshot.batch.inputs);
      if (position === undefined) {
        invalidContent("position backup snapshot has no position inputs");
      }
      inputCount += snapshot.batch.inputs.length;
      const currency = position.instrument.currency;
      openCostByCurrency.set(
        currency,
        (openCostByCurrency.get(currency) ?? new Decimal(0)).add(
          position.openCost,
        ),
      );
      return {
        instrument: { ...position.instrument },
        ...(snapshot.batch.displayName === undefined
          ? {}
          : { displayName: snapshot.batch.displayName }),
        revision: snapshot.revision,
        savedAt: snapshot.savedAt,
        inputCount: snapshot.batch.inputs.length,
        quantity: position.quantity,
        openCost: position.openCost,
        averageCost: position.averageCost,
      };
    },
  );

  const currencies = new Set(openCostByCurrency.keys());
  if (backup.cash !== null) {
    currencies.add(backup.cash.account.currency);
  }
  const currencyTotals = [...currencies]
    .toSorted()
    .map((currency): PositionBackupCurrencyPreview => {
      const stockOpenCost =
        openCostByCurrency.get(currency) ?? new Decimal(0);
      const cashBalance =
        backup.cash?.account.currency === currency
          ? backup.cash.account.balance
          : null;
      return {
        currency,
        stockOpenCost: canonicalDecimal(stockOpenCost),
        cashBalance,
        recordedPrincipal: canonicalDecimal(
          cashBalance === null
            ? stockOpenCost
            : stockOpenCost.add(cashBalance),
        ),
      };
    });

  return {
    exportedAt: backup.exportedAt,
    positionCount: positions.length,
    inputCount,
    positions,
    cash: backup.cash === null ? null : cloneCashSnapshot(backup.cash),
    currencyTotals,
  };
}

export function createPositionBackupDocument(
  snapshotInputs: readonly PositionSnapshot[],
  exportedAtInput: string = new Date().toISOString(),
  cashInput: CashSnapshot | null = null,
): PositionBackupDocument {
  const exportedAt = validateSavedAt(
    exportedAtInput,
    "positionBackup.exportedAt",
  );
  const keys = new Set<string>();
  const symbols = new Set<string>();
  const snapshots = snapshotInputs
    .map((snapshot) => clonePositionSnapshot(snapshot))
    .toSorted((left, right) => {
      const leftKey = instrumentKeyId(left.batch.instrument);
      const rightKey = instrumentKeyId(right.batch.instrument);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  for (const [index, snapshot] of snapshots.entries()) {
    registerRestorableSnapshotIdentity(
      snapshot,
      keys,
      symbols,
      `positionBackup.snapshots[${index}]`,
    );
  }

  return {
    format: POSITION_BACKUP_FORMAT,
    formatVersion: POSITION_BACKUP_FORMAT_VERSION,
    exportedAt,
    snapshots,
    cash: cashInput === null ? null : cloneCashSnapshot(cashInput),
  };
}

function backupTimestampForFileName(exportedAt: string): string {
  return new Date(exportedAt)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
}

export function createPositionBackupFile(
  backup: PositionBackupDocument,
): PositionBackupFile {
  return {
    fileName: `stock-portfolio-backup-${backupTimestampForFileName(
      backup.exportedAt,
    )}.json`,
    mediaType: "application/json",
    contents: `${JSON.stringify(backup, null, 2)}\n`,
  };
}
