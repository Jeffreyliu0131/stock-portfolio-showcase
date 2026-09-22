import {
  canonicalDecimal,
  parseDecimal,
  parsePositiveInput,
  rfc3339ToEpochNanoseconds,
  type DecimalString,
  type HistoricalExternalFlow,
  type HistoricalNavObservation,
} from "../../domain/index.ts";

export type HistoryBroker = "IBKR" | "MOOMOO" | "MANUAL" | "LOCAL";
export type HistoryAssetClass = "STOCK" | "ETF" | "OPTION" | "UNKNOWN";
export type HistoryTradeSide = "BUY" | "SELL";
export type HistoryEventType =
  | "NAV_SNAPSHOT"
  | "EXTERNAL_FLOW"
  | "TRADE"
  | "POSITION_SNAPSHOT";

export interface HistoryEventBase {
  readonly id: string;
  readonly type: HistoryEventType;
  readonly source: HistoryBroker;
  readonly sourceScopeHash: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
}

export interface HistoryNavSnapshotEvent extends HistoryEventBase {
  readonly type: "NAV_SNAPSHOT";
  readonly scopeKind: "ACCOUNT" | "PORTFOLIO_TOTAL";
  readonly valueUsd: DecimalString;
  readonly sourceCurrency: "USD" | "HKD" | "CNH";
  readonly sourceValue: DecimalString;
  readonly fxRateToUsd: DecimalString;
  readonly coverage: "COMPLETE" | "PARTIAL";
}

export interface HistoryExternalFlowEvent extends HistoryEventBase {
  readonly type: "EXTERNAL_FLOW";
  readonly amountUsd: DecimalString;
  readonly direction: "DEPOSIT" | "WITHDRAWAL";
  readonly classification:
    | "EXTERNAL_DEPOSIT"
    | "EXTERNAL_WITHDRAWAL";
}

export interface HistoryTradeEvent extends HistoryEventBase {
  readonly type: "TRADE";
  readonly assetClass: HistoryAssetClass;
  readonly side: HistoryTradeSide;
  readonly symbol: string;
  readonly quantity: DecimalString;
  readonly price: DecimalString;
  readonly multiplier: DecimalString;
  readonly feesUsd: DecimalString;
  readonly currency: "USD" | "HKD" | "CNH";
  readonly externalId?: string;
  readonly option?: {
    readonly expiration: string;
    readonly strike: DecimalString;
    readonly right: "CALL" | "PUT";
  };
}

export interface HistoryPositionSnapshotEvent extends HistoryEventBase {
  readonly type: "POSITION_SNAPSHOT";
  readonly assetClass: HistoryAssetClass;
  readonly symbol: string;
  readonly quantity: DecimalString;
  readonly price: DecimalString;
  readonly valueUsd: DecimalString;
}

export type PortfolioHistoryEvent =
  | HistoryNavSnapshotEvent
  | HistoryExternalFlowEvent
  | HistoryTradeEvent
  | HistoryPositionSnapshotEvent;

export type HistoryImportIssueCode =
  | "UNSUPPORTED_FILE"
  | "SCANNED_PDF"
  | "CURRENT_SNAPSHOT_ONLY"
  | "UNKNOWN_BROKER"
  | "UNKNOWN_LAYOUT"
  | "MISSING_NAV"
  | "UNKNOWN_CASH_CLASSIFICATION"
  | "DUPLICATE_FILE"
  | "CONFLICTING_EVENT"
  | "INCOMPLETE_DOCUMENT"
  | "NO_IMPORTABLE_RECORDS"
  | "FILE_LIMIT_EXCEEDED";

export interface HistoryImportIssue {
  readonly severity: "INFO" | "WARNING" | "BLOCKING";
  readonly code: HistoryImportIssueCode;
  readonly message: string;
}

export interface HistoryImportDocument {
  readonly importId: string;
  readonly fileSha256: string;
  readonly broker: Exclude<HistoryBroker, "MANUAL" | "LOCAL">;
  readonly detectedFormat: "CSV" | "PDF_TEXT" | "TEXT";
  readonly pageCount: number | null;
  readonly importedAt: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly eventCount: number;
}

export interface HistoryImportCandidate {
  readonly document: HistoryImportDocument;
  readonly events: readonly PortfolioHistoryEvent[];
  readonly issues: readonly HistoryImportIssue[];
}

export interface HistoryImportBatchResult {
  readonly importedDocuments: number;
  readonly duplicateDocuments: number;
  readonly insertedEvents: number;
  readonly duplicateEvents: number;
}

export interface PortfolioHistorySummary {
  readonly importCount: number;
  readonly navCount: number;
  readonly externalFlowCount: number;
  readonly tradeCount: number;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
}

export interface PortfolioHistoryTrendInputs {
  readonly observations: readonly HistoricalNavObservation[];
  readonly flows: readonly HistoricalExternalFlow[];
  readonly hasUnknownExternalFlow: boolean;
}

export interface PortfolioHistoryRepository {
  listEvents(): Promise<readonly PortfolioHistoryEvent[]>;
  listImports(): Promise<readonly HistoryImportDocument[]>;
  importCandidates(
    candidates: readonly HistoryImportCandidate[],
  ): Promise<HistoryImportBatchResult>;
  putManualEvent(event: PortfolioHistoryEvent): Promise<void>;
  putLocalPortfolioNav(valueUsd: DecimalString, observedAt: string): Promise<void>;
  getSummary(): Promise<PortfolioHistorySummary>;
}

export type PortfolioHistoryRepositoryErrorCode =
  | "HISTORY_INDEXED_DB_UNAVAILABLE"
  | "HISTORY_INDEXED_DB_OPEN_FAILED"
  | "HISTORY_TRANSACTION_FAILED"
  | "HISTORY_IMPORT_BLOCKED"
  | "HISTORY_EVENT_CONFLICT"
  | "INVALID_HISTORY_DATA";

export class PortfolioHistoryRepositoryError extends Error {
  readonly code: PortfolioHistoryRepositoryErrorCode;

  constructor(code: PortfolioHistoryRepositoryErrorCode, message: string) {
    super(message);
    this.name = "PortfolioHistoryRepositoryError";
    this.code = code;
  }
}

const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9:._-]{1,320}$/;
const SYMBOL = /^[A-Z0-9.\- ]{1,80}$/;

function assertTimestamp(value: string, field: string): string {
  rfc3339ToEpochNanoseconds(value, field);
  return value;
}

function assertIsoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      `${field} is invalid`,
    );
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      `${field} is invalid`,
    );
  }
  return value;
}

function assertSafeId(value: string, field: string): string {
  if (!SAFE_ID.test(value)) {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      `${field} is invalid`,
    );
  }
  return value;
}

function assertScopeHash(value: string): string {
  if (!HASH.test(value) && value !== "LOCAL_PORTFOLIO_TOTAL" && value !== "MANUAL_PORTFOLIO") {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      "history source scope hash is invalid",
    );
  }
  return value;
}

function base<T extends PortfolioHistoryEvent>(value: T): HistoryEventBase {
  return {
    id: assertSafeId(value.id, "historyEvent.id"),
    type: value.type,
    source: value.source,
    sourceScopeHash: assertScopeHash(value.sourceScopeHash),
    occurredAt: assertTimestamp(value.occurredAt, "historyEvent.occurredAt"),
    recordedAt: assertTimestamp(value.recordedAt, "historyEvent.recordedAt"),
  };
}

function symbol(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!SYMBOL.test(normalized)) {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      "history instrument symbol is invalid",
    );
  }
  return normalized;
}

export function clonePortfolioHistoryEvent(
  value: PortfolioHistoryEvent,
): PortfolioHistoryEvent {
  const common = base(value);
  if (value.type === "NAV_SNAPSHOT") {
    const valueUsd = parsePositiveInput(value.valueUsd, "historyNav.valueUsd");
    const sourceValue = parsePositiveInput(value.sourceValue, "historyNav.sourceValue");
    const fxRateToUsd = parsePositiveInput(value.fxRateToUsd, "historyNav.fxRateToUsd");
    return {
      ...common,
      type: "NAV_SNAPSHOT",
      scopeKind: value.scopeKind,
      valueUsd: canonicalDecimal(valueUsd),
      sourceCurrency: value.sourceCurrency,
      sourceValue: canonicalDecimal(sourceValue),
      fxRateToUsd: canonicalDecimal(fxRateToUsd),
      coverage: value.coverage,
    };
  }
  if (value.type === "EXTERNAL_FLOW") {
    const amount = parseDecimal(value.amountUsd, {
      field: "historyFlow.amountUsd",
      maxFractionalDigits: 8,
    });
    if (amount.isZero()) {
      throw new PortfolioHistoryRepositoryError(
        "INVALID_HISTORY_DATA",
        "history external flow must not be zero",
      );
    }
    if (
      (value.direction === "DEPOSIT" && amount.isNegative()) ||
      (value.direction === "WITHDRAWAL" && amount.isPositive())
    ) {
      throw new PortfolioHistoryRepositoryError(
        "INVALID_HISTORY_DATA",
        "history external flow sign does not match its direction",
      );
    }
    return {
      ...common,
      type: "EXTERNAL_FLOW",
      amountUsd: canonicalDecimal(amount),
      direction: value.direction,
      classification: value.classification,
    };
  }
  if (value.type === "TRADE") {
    const quantity = parsePositiveInput(value.quantity, "historyTrade.quantity");
    const price = parseDecimal(value.price, {
      field: "historyTrade.price",
      maxFractionalDigits: 8,
    });
    const multiplier = parsePositiveInput(value.multiplier, "historyTrade.multiplier");
    const fees = parseDecimal(value.feesUsd, {
      field: "historyTrade.feesUsd",
      maxFractionalDigits: 8,
    });
    if (price.isNegative() || fees.isNegative()) {
      throw new PortfolioHistoryRepositoryError(
        "INVALID_HISTORY_DATA",
        "history trade price and fees must be non-negative",
      );
    }
    if (value.assetClass === "OPTION" && value.option === undefined) {
      throw new PortfolioHistoryRepositoryError(
        "INVALID_HISTORY_DATA",
        "history option trade requires an option identity",
      );
    }
    if (value.assetClass !== "OPTION" && value.option !== undefined) {
      throw new PortfolioHistoryRepositoryError(
        "INVALID_HISTORY_DATA",
        "non-option history trade cannot include an option identity",
      );
    }
    return {
      ...common,
      type: "TRADE",
      assetClass: value.assetClass,
      side: value.side,
      symbol: symbol(value.symbol),
      quantity: canonicalDecimal(quantity),
      price: canonicalDecimal(price),
      multiplier: canonicalDecimal(multiplier),
      feesUsd: canonicalDecimal(fees),
      currency: value.currency,
      ...(value.externalId === undefined
        ? {}
        : { externalId: assertSafeId(value.externalId, "historyTrade.externalId") }),
      ...(value.option === undefined
        ? {}
        : {
            option: {
              expiration: assertIsoDate(
                value.option.expiration,
                "historyTrade.option.expiration",
              ),
              strike: canonicalDecimal(
                parsePositiveInput(value.option.strike, "historyTrade.option.strike"),
              ),
              right: value.option.right,
            },
          }),
    };
  }
  const quantity = parseDecimal(value.quantity, {
    field: "historyPosition.quantity",
    maxFractionalDigits: 8,
  });
  return {
    ...common,
    type: "POSITION_SNAPSHOT",
    assetClass: value.assetClass,
    symbol: symbol(value.symbol),
    quantity: canonicalDecimal(quantity),
    price: canonicalDecimal(parsePositiveInput(value.price, "historyPosition.price")),
    valueUsd: canonicalDecimal(
      parseDecimal(value.valueUsd, {
        field: "historyPosition.valueUsd",
        maxFractionalDigits: 8,
      }),
    ),
  };
}

export function cloneHistoryImportDocument(
  value: HistoryImportDocument,
): HistoryImportDocument {
  if (!HASH.test(value.fileSha256) || value.importId !== value.fileSha256) {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      "history import fingerprint is invalid",
    );
  }
  if (!Number.isSafeInteger(value.eventCount) || value.eventCount < 0) {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      "history import event count is invalid",
    );
  }
  if (value.pageCount !== null && (!Number.isSafeInteger(value.pageCount) || value.pageCount < 1)) {
    throw new PortfolioHistoryRepositoryError(
      "INVALID_HISTORY_DATA",
      "history import page count is invalid",
    );
  }
  return {
    ...value,
    importedAt: assertTimestamp(value.importedAt, "historyImport.importedAt"),
    periodStart:
      value.periodStart === null
        ? null
        : assertTimestamp(value.periodStart, "historyImport.periodStart"),
    periodEnd:
      value.periodEnd === null
        ? null
        : assertTimestamp(value.periodEnd, "historyImport.periodEnd"),
  };
}
