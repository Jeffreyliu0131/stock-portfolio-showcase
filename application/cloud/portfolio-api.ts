import {
  createBrokerCashState,
  createBrokerPositionState,
  createBrokerPortfolioBook,
  createIbkrUsdCashAccount,
  createInstrumentKey,
  rfc3339ToEpochNanoseconds,
  type ApplyBrokerTradeInput,
  type BrokerPortfolioBaselineInput,
  type BrokerPortfolioBook,
  type InstrumentKey,
} from "../../domain/index.ts";
import {
  createBrokerPortfolioBackupDocument,
  parseBrokerPortfolioBackupDocument,
  type BrokerPortfolioBackupDocument,
} from "../brokerage/backup.ts";
import {
  cloneCashSnapshot,
  type CashSnapshot,
} from "../cash/types.ts";
import {
  parsePositionBackupDocument,
} from "../positions/position-backup.ts";
import {
  clonePositionSnapshot,
  createPositionBatch,
  type PositionBatch,
  type PositionSnapshot,
} from "../positions/types.ts";
import {
  CLOUD_PORTFOLIO_STATE_FORMAT_VERSION,
  type CloudPortfolioMutation,
  type CloudPortfolioStateView,
} from "./portfolio-state.ts";

export const CLOUD_PORTFOLIO_API_PATH = "/api/portfolio";
export const CLOUD_PORTFOLIO_REQUEST_MAX_BYTES = 1_048_576;

export interface CloudPortfolioMutationResponse {
  readonly kind: "CLOUD_PORTFOLIO_MUTATION_RESULT";
  readonly action: CloudPortfolioMutation["action"];
  readonly changed: boolean;
  readonly state: CloudPortfolioStateView;
}

export interface CloudPortfolioApiError {
  readonly kind: "CLOUD_PORTFOLIO_ERROR";
  readonly code:
    | "AUTHENTICATION_REQUIRED"
    | "CONFLICT"
    | "INVALID_REQUEST"
    | "NOT_CONFIGURED"
    | "RATE_LIMITED"
    | "UNAVAILABLE";
  readonly message: string;
}

type UnknownRecord = Record<string, unknown>;

function invalid(path: string): never {
  throw new Error(`invalid cloud portfolio payload: ${path}`);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function allowedKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid(`${path} contains missing or unknown fields`);
  }
}

function exactKeys(
  value: UnknownRecord,
  keys: readonly string[],
  path: string,
): void {
  allowedKeys(value, keys, [], path);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") {
    invalid(`${path} must be a string`);
  }
  return value;
}

function safeRevision(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    invalid(`${path} must be a positive safe integer`);
  }
  return value;
}

function expectedRevision(value: unknown, path: string): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return safeRevision(value, path);
}

function parseInstrument(value: unknown, path: string): InstrumentKey {
  const candidate = record(value, path);
  exactKeys(candidate, ["listingMarket", "symbol", "currency"], path);
  return createInstrumentKey({
    listingMarket: stringValue(candidate.listingMarket, `${path}.listingMarket`),
    symbol: stringValue(candidate.symbol, `${path}.symbol`),
    currency: stringValue(candidate.currency, `${path}.currency`),
  });
}

function validateBatchShape(value: unknown, path: string): PositionBatch {
  const batch = record(value, path);
  allowedKeys(batch, ["instrument", "inputs"], ["displayName"], path);
  parseInstrument(batch.instrument, `${path}.instrument`);
  if (!Array.isArray(batch.inputs)) {
    invalid(`${path}.inputs must be an array`);
  }
  batch.inputs.forEach((inputValue, index) => {
    const inputPath = `${path}.inputs[${index}]`;
    const input = record(inputValue, inputPath);
    exactKeys(input, ["id", "instrument", "quantity", "costInput"], inputPath);
    stringValue(input.id, `${inputPath}.id`);
    parseInstrument(input.instrument, `${inputPath}.instrument`);
    stringValue(input.quantity, `${inputPath}.quantity`);
    const cost = record(input.costInput, `${inputPath}.costInput`);
    exactKeys(cost, ["mode", "value"], `${inputPath}.costInput`);
    stringValue(cost.mode, `${inputPath}.costInput.mode`);
    stringValue(cost.value, `${inputPath}.costInput.value`);
  });
  if (batch.displayName !== undefined) {
    stringValue(batch.displayName, `${path}.displayName`);
  }
  return createPositionBatch(batch as unknown as PositionBatch);
}

function parsePositionOptions(value: unknown, path: string) {
  const options = record(value, path);
  allowedKeys(options, [], ["expectedRevision"], path);
  const revision = expectedRevision(options.expectedRevision, `${path}.expectedRevision`);
  return revision === undefined ? {} : { expectedRevision: revision };
}

function validateBrokerPosition(value: unknown, path: string) {
  const candidate = record(value, path);
  allowedKeys(
    candidate,
    ["broker", "instrument", "quantity", "totalOpenCost"],
    ["displayName"],
    path,
  );
  return createBrokerPositionState({
    broker: stringValue(candidate.broker, `${path}.broker`) as "IBKR" | "MOOMOO",
    instrument: parseInstrument(candidate.instrument, `${path}.instrument`),
    ...(candidate.displayName === undefined
      ? {}
      : { displayName: stringValue(candidate.displayName, `${path}.displayName`) }),
    quantity: stringValue(candidate.quantity, `${path}.quantity`),
    totalOpenCost: stringValue(candidate.totalOpenCost, `${path}.totalOpenCost`),
  });
}

function validateBrokerCash(value: unknown, path: string) {
  const candidate = record(value, path);
  allowedKeys(
    candidate,
    ["broker", "currency", "settledBalance", "pendingBalance"],
    ["pricingPlan", "netAssetValue", "navSource"],
    path,
  );
  return createBrokerCashState({
    broker: stringValue(candidate.broker, `${path}.broker`) as "IBKR" | "MOOMOO",
    currency: stringValue(candidate.currency, `${path}.currency`) as "USD",
    settledBalance: stringValue(
      candidate.settledBalance,
      `${path}.settledBalance`,
    ),
    pendingBalance: stringValue(
      candidate.pendingBalance,
      `${path}.pendingBalance`,
    ),
    ...(candidate.pricingPlan === undefined
      ? {}
      : {
          pricingPlan: stringValue(
            candidate.pricingPlan,
            `${path}.pricingPlan`,
          ) as "IBKR_PRO" | "IBKR_LITE",
        }),
    ...(candidate.netAssetValue === undefined
      ? {}
      : {
          netAssetValue: stringValue(
            candidate.netAssetValue,
            `${path}.netAssetValue`,
          ),
        }),
    ...(candidate.navSource === undefined
      ? {}
      : {
          navSource: stringValue(
            candidate.navSource,
            `${path}.navSource`,
          ) as "USER_ENTERED" | "CASH_BALANCE_FALLBACK",
        }),
  });
}

function rfc3339(value: unknown, path: string): string {
  const result = stringValue(value, path);
  rfc3339ToEpochNanoseconds(result, path);
  return result;
}

function parseBaseline(value: unknown, path: string): BrokerPortfolioBaselineInput {
  const baseline = record(value, path);
  allowedKeys(
    baseline,
    ["positions", "cashAccounts", "effectiveAt"],
    ["reason"],
    path,
  );
  if (!Array.isArray(baseline.positions) || !Array.isArray(baseline.cashAccounts)) {
    invalid(`${path} collections must be arrays`);
  }
  return {
    positions: baseline.positions.map((candidate, index) =>
      validateBrokerPosition(candidate, `${path}.positions[${index}]`),
    ),
    cashAccounts: baseline.cashAccounts.map((candidate, index) =>
      validateBrokerCash(candidate, `${path}.cashAccounts[${index}]`),
    ),
    effectiveAt: rfc3339(baseline.effectiveAt, `${path}.effectiveAt`),
    ...(baseline.reason === undefined
      ? {}
      : { reason: stringValue(baseline.reason, `${path}.reason`) }),
  };
}

function parseTrade(value: unknown, path: string): ApplyBrokerTradeInput {
  const trade = record(value, path);
  allowedKeys(
    trade,
    [
      "id",
      "side",
      "broker",
      "instrument",
      "quantity",
      "unitPrice",
      "cashStatus",
      "effectiveAt",
    ],
    ["displayName", "fee"],
    path,
  );
  return {
    id: stringValue(trade.id, `${path}.id`),
    side: stringValue(trade.side, `${path}.side`) as "BUY" | "SELL",
    broker: stringValue(trade.broker, `${path}.broker`) as "IBKR" | "MOOMOO",
    instrument: parseInstrument(trade.instrument, `${path}.instrument`),
    ...(trade.displayName === undefined
      ? {}
      : { displayName: stringValue(trade.displayName, `${path}.displayName`) }),
    quantity: stringValue(trade.quantity, `${path}.quantity`),
    unitPrice: stringValue(trade.unitPrice, `${path}.unitPrice`),
    ...(trade.fee === undefined
      ? {}
      : { fee: stringValue(trade.fee, `${path}.fee`) }),
    cashStatus: stringValue(
      trade.cashStatus,
      `${path}.cashStatus`,
    ) as "SETTLED" | "PENDING",
    effectiveAt: rfc3339(trade.effectiveAt, `${path}.effectiveAt`),
  };
}

export function parseCloudPortfolioMutation(value: unknown): CloudPortfolioMutation {
  const candidate = record(value, "request");
  const action = stringValue(candidate.action, "request.action");

  if (action === "REPLACE_BATCH" || action === "ADD_INPUTS") {
    exactKeys(candidate, ["action", "batch", "options"], "request");
    return {
      action,
      batch: validateBatchShape(candidate.batch, "request.batch"),
      options: parsePositionOptions(candidate.options, "request.options"),
    };
  }
  if (action === "DELETE_POSITION") {
    exactKeys(candidate, ["action", "instrument", "options"], "request");
    return {
      action,
      instrument: parseInstrument(candidate.instrument, "request.instrument"),
      options: parsePositionOptions(candidate.options, "request.options"),
    };
  }
  if (action === "UNDO_POSITION") {
    exactKeys(candidate, ["action", "instrument"], "request");
    return {
      action,
      instrument: parseInstrument(candidate.instrument, "request.instrument"),
    };
  }
  if (action === "REPLACE_CASH") {
    exactKeys(candidate, ["action", "account", "options"], "request");
    const account = record(candidate.account, "request.account");
    exactKeys(
      account,
      ["provider", "currency", "balance", "netAssetValue", "navSource", "pricingPlan"],
      "request.account",
    );
    return {
      action,
      account: createIbkrUsdCashAccount(
        account as unknown as Parameters<typeof createIbkrUsdCashAccount>[0],
      ),
      options: parsePositionOptions(candidate.options, "request.options"),
    };
  }
  if (action === "DELETE_CASH") {
    exactKeys(candidate, ["action", "options"], "request");
    return {
      action,
      options: parsePositionOptions(candidate.options, "request.options"),
    };
  }
  if (action === "RECONCILE_BROKER") {
    exactKeys(candidate, ["action", "baseline", "options"], "request");
    const options = record(candidate.options, "request.options");
    allowedKeys(options, ["eventId"], ["expectedRevision"], "request.options");
    const revision = expectedRevision(
      options.expectedRevision,
      "request.options.expectedRevision",
    );
    return {
      action,
      baseline: parseBaseline(candidate.baseline, "request.baseline"),
      options: {
        eventId: stringValue(options.eventId, "request.options.eventId"),
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      },
    };
  }
  if (action === "APPLY_BROKER_TRADE") {
    exactKeys(candidate, ["action", "trade", "options"], "request");
    const options = record(candidate.options, "request.options");
    exactKeys(options, ["expectedRevision"], "request.options");
    return {
      action,
      trade: parseTrade(candidate.trade, "request.trade"),
      options: {
        expectedRevision: safeRevision(
          options.expectedRevision,
          "request.options.expectedRevision",
        ),
      },
    };
  }
  if (action === "RESTORE_V2") {
    exactKeys(candidate, ["action", "backup"], "request");
    return {
      action,
      backup: parsePositionBackupDocument(candidate.backup),
    };
  }
  if (action === "RESTORE_V3") {
    exactKeys(candidate, ["action", "backup"], "request");
    return {
      action,
      book: parseBrokerPortfolioBackupDocument(candidate.backup).book,
    };
  }
  invalid("request.action is unsupported");
}

function parseSnapshotArray(value: unknown, path: string): readonly PositionSnapshot[] {
  if (!Array.isArray(value)) {
    invalid(`${path} must be an array`);
  }
  return value.map((snapshot) => clonePositionSnapshot(snapshot as PositionSnapshot));
}

export function parseCloudPortfolioStateView(value: unknown): CloudPortfolioStateView {
  const candidate = record(value, "state");
  exactKeys(
    candidate,
    [
      "kind",
      "version",
      "stateRevision",
      "snapshots",
      "previousSnapshots",
      "cash",
      "previousCash",
      "brokerBook",
      "previousBrokerBook",
    ],
    "state",
  );
  if (
    candidate.kind !== "CLOUD_PORTFOLIO_STATE" ||
    candidate.version !== CLOUD_PORTFOLIO_STATE_FORMAT_VERSION ||
    typeof candidate.stateRevision !== "number" ||
    !Number.isSafeInteger(candidate.stateRevision) ||
    candidate.stateRevision < 0
  ) {
    invalid("state identity or revision is invalid");
  }
  return {
    kind: "CLOUD_PORTFOLIO_STATE",
    version: CLOUD_PORTFOLIO_STATE_FORMAT_VERSION,
    stateRevision: candidate.stateRevision,
    snapshots: parseSnapshotArray(candidate.snapshots, "state.snapshots"),
    previousSnapshots: parseSnapshotArray(
      candidate.previousSnapshots,
      "state.previousSnapshots",
    ),
    cash:
      candidate.cash === null
        ? null
        : cloneCashSnapshot(candidate.cash as CashSnapshot),
    previousCash:
      candidate.previousCash === null
        ? null
        : cloneCashSnapshot(candidate.previousCash as CashSnapshot),
    brokerBook:
      candidate.brokerBook === null
        ? null
        : createBrokerPortfolioBook(candidate.brokerBook as BrokerPortfolioBook),
    previousBrokerBook:
      candidate.previousBrokerBook === null
        ? null
        : createBrokerPortfolioBook(
            candidate.previousBrokerBook as BrokerPortfolioBook,
          ),
  };
}

export function parseCloudPortfolioMutationResponse(
  value: unknown,
): CloudPortfolioMutationResponse {
  const candidate = record(value, "response");
  exactKeys(candidate, ["kind", "action", "changed", "state"], "response");
  if (
    candidate.kind !== "CLOUD_PORTFOLIO_MUTATION_RESULT" ||
    typeof candidate.action !== "string" ||
    ![
      "REPLACE_BATCH",
      "ADD_INPUTS",
      "DELETE_POSITION",
      "UNDO_POSITION",
      "REPLACE_CASH",
      "DELETE_CASH",
      "RECONCILE_BROKER",
      "APPLY_BROKER_TRADE",
      "RESTORE_V2",
      "RESTORE_V3",
    ].includes(candidate.action) ||
    typeof candidate.changed !== "boolean"
  ) {
    invalid("response metadata is invalid");
  }
  return {
    kind: "CLOUD_PORTFOLIO_MUTATION_RESULT",
    action: candidate.action as CloudPortfolioMutation["action"],
    changed: candidate.changed,
    state: parseCloudPortfolioStateView(candidate.state),
  };
}

export function brokerRestoreRequest(
  book: BrokerPortfolioBook,
  now: string,
): { readonly action: "RESTORE_V3"; readonly backup: BrokerPortfolioBackupDocument } {
  return {
    action: "RESTORE_V3",
    backup: createBrokerPortfolioBackupDocument(book, now),
  };
}
