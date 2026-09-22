import {
  createBrokerPortfolioBook,
  rfc3339ToEpochNanoseconds,
  type BrokerPortfolioBook,
} from "../../domain/index.ts";
import type { PositionBackupFile } from "../positions/position-backup.ts";

export const BROKER_PORTFOLIO_BACKUP_FORMAT =
  "stock-portfolio-calculator-broker-portfolio-backup";
export const BROKER_PORTFOLIO_BACKUP_VERSION = 3;

export interface BrokerPortfolioBackupDocument {
  readonly format: typeof BROKER_PORTFOLIO_BACKUP_FORMAT;
  readonly formatVersion: typeof BROKER_PORTFOLIO_BACKUP_VERSION;
  readonly exportedAt: string;
  readonly book: BrokerPortfolioBook;
}

export class BrokerPortfolioBackupValidationError extends Error {
  readonly code:
    | "INVALID_JSON"
    | "INVALID_BACKUP_FORMAT"
    | "UNSUPPORTED_BACKUP_VERSION"
    | "INVALID_BACKUP_CONTENT";

  constructor(
    code: BrokerPortfolioBackupValidationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "BrokerPortfolioBackupValidationError";
    this.code = code;
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      `${path} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function allowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      `${path} contains missing or unknown fields`,
    );
  }
}

function validateBookShape(value: unknown): void {
  const book = record(value, "brokerBackup.book");
  allowedKeys(
    book,
    ["revision", "savedAt", "positions", "cashAccounts", "events"],
    [],
    "brokerBackup.book",
  );
  if (
    !Array.isArray(book.positions) ||
    !Array.isArray(book.cashAccounts) ||
    !Array.isArray(book.events)
  ) {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      "broker book collections must be arrays",
    );
  }
  book.positions.forEach((candidate, index) => {
    const position = record(candidate, `brokerBackup.book.positions[${index}]`);
    allowedKeys(
      position,
      ["broker", "instrument", "quantity", "totalOpenCost"],
      ["displayName"],
      `brokerBackup.book.positions[${index}]`,
    );
    allowedKeys(
      record(position.instrument, `brokerBackup.book.positions[${index}].instrument`),
      ["listingMarket", "symbol", "currency"],
      [],
      `brokerBackup.book.positions[${index}].instrument`,
    );
  });
  book.cashAccounts.forEach((candidate, index) => {
    allowedKeys(
      record(candidate, `brokerBackup.book.cashAccounts[${index}]`),
      ["broker", "currency", "settledBalance", "pendingBalance"],
      ["pricingPlan", "netAssetValue", "navSource"],
      `brokerBackup.book.cashAccounts[${index}]`,
    );
  });
  book.events.forEach((candidate, index) => {
    const event = record(candidate, `brokerBackup.book.events[${index}]`);
    if (event.type === "RECONCILIATION") {
      allowedKeys(
        event,
        ["id", "type", "effectiveAt", "recordedAt", "reason"],
        [],
        `brokerBackup.book.events[${index}]`,
      );
      return;
    }
    allowedKeys(
      event,
      [
        "id",
        "type",
        "broker",
        "instrument",
        "quantity",
        "unitPrice",
        "fee",
        "cashStatus",
        "effectiveAt",
        "recordedAt",
      ],
      ["displayName"],
      `brokerBackup.book.events[${index}]`,
    );
    allowedKeys(
      record(event.instrument, `brokerBackup.book.events[${index}].instrument`),
      ["listingMarket", "symbol", "currency"],
      [],
      `brokerBackup.book.events[${index}].instrument`,
    );
  });
}

function exportedAt(value: unknown): string {
  if (typeof value !== "string") {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      "broker backup exportedAt must be a string",
    );
  }
  try {
    rfc3339ToEpochNanoseconds(value, "brokerBackup.exportedAt");
  } catch {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      "broker backup exportedAt must be RFC 3339",
    );
  }
  return value;
}

export function createBrokerPortfolioBackupDocument(
  book: BrokerPortfolioBook,
  timestamp: string,
): BrokerPortfolioBackupDocument {
  return {
    format: BROKER_PORTFOLIO_BACKUP_FORMAT,
    formatVersion: BROKER_PORTFOLIO_BACKUP_VERSION,
    exportedAt: exportedAt(timestamp),
    book: createBrokerPortfolioBook(book),
  };
}

export function parseBrokerPortfolioBackupDocument(
  value: unknown,
): BrokerPortfolioBackupDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      "broker backup must be an object",
    );
  }
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["format", "formatVersion", "exportedAt", "book"])) {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      "broker backup contains missing or unknown fields",
    );
  }
  if (record.format !== BROKER_PORTFOLIO_BACKUP_FORMAT) {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_FORMAT",
      "unsupported broker backup format",
    );
  }
  if (record.formatVersion !== BROKER_PORTFOLIO_BACKUP_VERSION) {
    throw new BrokerPortfolioBackupValidationError(
      "UNSUPPORTED_BACKUP_VERSION",
      "unsupported broker backup version",
    );
  }
  try {
    validateBookShape(record.book);
    return {
      format: BROKER_PORTFOLIO_BACKUP_FORMAT,
      formatVersion: BROKER_PORTFOLIO_BACKUP_VERSION,
      exportedAt: exportedAt(record.exportedAt),
      book: createBrokerPortfolioBook(record.book as BrokerPortfolioBook),
    };
  } catch (error) {
    if (error instanceof BrokerPortfolioBackupValidationError) throw error;
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_BACKUP_CONTENT",
      error instanceof Error ? error.message : "invalid broker book",
    );
  }
}

export function parseBrokerPortfolioBackupJson(
  json: string,
): BrokerPortfolioBackupDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new BrokerPortfolioBackupValidationError(
      "INVALID_JSON",
      "broker backup is not valid JSON",
    );
  }
  return parseBrokerPortfolioBackupDocument(parsed);
}

export function createBrokerPortfolioBackupFile(
  document: BrokerPortfolioBackupDocument,
): PositionBackupFile {
  const compactTime = document.exportedAt
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return {
    fileName: `stock-portfolio-broker-backup-${compactTime}.json`,
    mediaType: "application/json",
    contents: `${JSON.stringify(document, null, 2)}\n`,
  };
}
