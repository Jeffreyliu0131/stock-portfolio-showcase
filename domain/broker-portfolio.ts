import {
  Decimal,
  canonicalDecimal,
  parseDecimal,
  parseNonNegativeInput,
  parsePositiveInput,
  type DecimalString,
} from "./decimal.ts";
import { failDomain, requireNonEmpty } from "./errors.ts";
import {
  createInstrumentKey,
  instrumentKeyId,
  sameInstrument,
  type InstrumentKey,
} from "./instrument.ts";
import { compareStableText } from "./order.ts";
import { rfc3339ToEpochNanoseconds } from "./time.ts";
import type { IbkrPricingPlan } from "./cash.ts";

export const BROKER_CODES = ["IBKR", "MOOMOO"] as const;

export type BrokerCode = (typeof BROKER_CODES)[number];
export type TradeSide = "BUY" | "SELL";
export type CashSettlementStatus = "SETTLED" | "PENDING";

export interface BrokerPositionState {
  readonly broker: BrokerCode;
  readonly instrument: InstrumentKey;
  readonly displayName?: string;
  readonly quantity: DecimalString;
  readonly totalOpenCost: DecimalString;
}

export interface BrokerCashState {
  readonly broker: BrokerCode;
  readonly currency: "USD";
  /** Signed book balance that has settled at the broker. */
  readonly settledBalance: DecimalString;
  /** Signed net cash receivable/payable that has not settled yet. */
  readonly pendingBalance: DecimalString;
  readonly pricingPlan?: IbkrPricingPlan;
  readonly netAssetValue?: DecimalString;
  readonly navSource?: "USER_ENTERED" | "CASH_BALANCE_FALLBACK";
}

export interface BrokerTradeEvent {
  readonly id: string;
  readonly type: TradeSide;
  readonly broker: BrokerCode;
  readonly instrument: InstrumentKey;
  readonly displayName?: string;
  readonly quantity: DecimalString;
  readonly unitPrice: DecimalString;
  readonly fee: DecimalString;
  readonly cashStatus: CashSettlementStatus;
  readonly effectiveAt: string;
  readonly recordedAt: string;
}

export interface BrokerReconciliationEvent {
  readonly id: string;
  readonly type: "RECONCILIATION";
  readonly effectiveAt: string;
  readonly recordedAt: string;
  readonly reason: string;
}

export type BrokerPortfolioEvent =
  | BrokerTradeEvent
  | BrokerReconciliationEvent;

export interface BrokerPortfolioBook {
  readonly revision: number;
  readonly savedAt: string;
  readonly positions: readonly BrokerPositionState[];
  readonly cashAccounts: readonly BrokerCashState[];
  readonly events: readonly BrokerPortfolioEvent[];
}

export interface BrokerPortfolioBaselineInput {
  readonly positions: readonly BrokerPositionState[];
  readonly cashAccounts: readonly BrokerCashState[];
  readonly effectiveAt: string;
  readonly reason?: string;
}

export interface ApplyBrokerTradeInput {
  readonly id: string;
  readonly side: TradeSide;
  readonly broker: BrokerCode;
  readonly instrument: InstrumentKey;
  readonly displayName?: string;
  readonly quantity: DecimalString;
  readonly unitPrice: DecimalString;
  readonly fee?: DecimalString;
  readonly cashStatus: CashSettlementStatus;
  readonly effectiveAt: string;
}

function broker(value: unknown, field: string): BrokerCode {
  if (value !== "IBKR" && value !== "MOOMOO") {
    failDomain({
      code: "INVALID_ENTRY",
      field,
      message: `${field} must be IBKR or MOOMOO`,
    });
  }
  return value;
}

function settlementStatus(
  value: unknown,
  field: string,
): CashSettlementStatus {
  if (value !== "SETTLED" && value !== "PENDING") {
    failDomain({
      code: "INVALID_ENTRY",
      field,
      message: `${field} must be SETTLED or PENDING`,
    });
  }
  return value;
}

function signedMoney(value: DecimalString, field: string) {
  return parseDecimal(value, { field, maxFractionalDigits: 8 });
}

function canonicalTime(value: string, field: string): string {
  rfc3339ToEpochNanoseconds(value, field);
  return value;
}

function optionalDisplayName(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    failDomain({
      code: "INVALID_IDENTIFIER",
      field: "brokerPosition.displayName",
      message: "broker position displayName must contain 1 to 200 characters",
    });
  }
  return normalized;
}

export function brokerPositionKey(position: {
  readonly broker: BrokerCode;
  readonly instrument: InstrumentKey;
}): string {
  return `${position.broker}:${instrumentKeyId(position.instrument)}`;
}

export function createBrokerPositionState(
  input: BrokerPositionState,
): BrokerPositionState {
  const normalizedBroker = broker(input.broker, "brokerPosition.broker");
  const instrument = createInstrumentKey(input.instrument);
  const quantity = parsePositiveInput(
    input.quantity,
    "brokerPosition.quantity",
  );
  const totalOpenCost = parseNonNegativeInput(
    input.totalOpenCost,
    "brokerPosition.totalOpenCost",
  );
  const displayName = optionalDisplayName(input.displayName);
  return {
    broker: normalizedBroker,
    instrument,
    ...(displayName === undefined ? {} : { displayName }),
    quantity: canonicalDecimal(quantity),
    totalOpenCost: canonicalDecimal(totalOpenCost),
  };
}

export function createBrokerCashState(
  input: BrokerCashState,
): BrokerCashState {
  const normalizedBroker = broker(input.broker, "brokerCash.broker");
  if (input.currency !== "USD") {
    failDomain({
      code: "INVALID_CURRENCY",
      field: "brokerCash.currency",
      message: "broker cash currency must be USD",
    });
  }
  const settledBalance = signedMoney(
    input.settledBalance,
    "brokerCash.settledBalance",
  );
  const pendingBalance = signedMoney(
    input.pendingBalance,
    "brokerCash.pendingBalance",
  );

  if (normalizedBroker === "MOOMOO") {
    if (
      input.pricingPlan !== undefined ||
      input.netAssetValue !== undefined ||
      input.navSource !== undefined
    ) {
      failDomain({
        code: "INVALID_ENTRY",
        field: "brokerCash",
        message: "moomoo cash must not contain IBKR interest fields",
      });
    }
    return {
      broker: "MOOMOO",
      currency: "USD",
      settledBalance: canonicalDecimal(settledBalance),
      pendingBalance: canonicalDecimal(pendingBalance),
    };
  }

  const hasAnyInterestField =
    input.pricingPlan !== undefined ||
    input.netAssetValue !== undefined ||
    input.navSource !== undefined;
  if (!hasAnyInterestField) {
    return {
      broker: "IBKR",
      currency: "USD",
      settledBalance: canonicalDecimal(settledBalance),
      pendingBalance: canonicalDecimal(pendingBalance),
    };
  }
  if (
    (input.pricingPlan !== "IBKR_PRO" &&
      input.pricingPlan !== "IBKR_LITE") ||
    input.netAssetValue === undefined ||
    (input.navSource !== "USER_ENTERED" &&
      input.navSource !== "CASH_BALANCE_FALLBACK")
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerCash",
      message: "IBKR interest fields must be supplied together",
    });
  }
  const netAssetValue = parseNonNegativeInput(
    input.netAssetValue,
    "brokerCash.netAssetValue",
  );
  if (input.navSource === "USER_ENTERED" && netAssetValue.lte(0)) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerCash.netAssetValue",
      message: "user-entered IBKR NAV must be greater than zero",
    });
  }
  if (
    input.navSource === "CASH_BALANCE_FALLBACK" &&
    !netAssetValue.eq(Decimal.max(settledBalance, 0))
  ) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerCash.netAssetValue",
      message:
        "fallback NAV must equal the non-negative settled IBKR cash balance",
    });
  }
  return {
    broker: "IBKR",
    currency: "USD",
    settledBalance: canonicalDecimal(settledBalance),
    pendingBalance: canonicalDecimal(pendingBalance),
    pricingPlan: input.pricingPlan,
    netAssetValue: canonicalDecimal(netAssetValue),
    navSource: input.navSource,
  };
}

function sortPositions(
  positions: readonly BrokerPositionState[],
): readonly BrokerPositionState[] {
  return [...positions].toSorted((left, right) =>
    compareStableText(brokerPositionKey(left), brokerPositionKey(right)),
  );
}

function sortCash(
  accounts: readonly BrokerCashState[],
): readonly BrokerCashState[] {
  return [...accounts].toSorted((left, right) =>
    compareStableText(left.broker, right.broker),
  );
}

function validateRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerPortfolio.revision",
      message: "broker portfolio revision must be a positive safe integer",
    });
  }
  return revision;
}

function cloneEvent(event: BrokerPortfolioEvent): BrokerPortfolioEvent {
  if (event.type === "RECONCILIATION") {
    return {
      id: requireNonEmpty(event.id, "brokerEvent.id"),
      type: "RECONCILIATION",
      effectiveAt: canonicalTime(
        event.effectiveAt,
        "brokerEvent.effectiveAt",
      ),
      recordedAt: canonicalTime(event.recordedAt, "brokerEvent.recordedAt"),
      reason: requireNonEmpty(event.reason, "brokerEvent.reason"),
    };
  }
  if (event.type !== "BUY" && event.type !== "SELL") {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerEvent.type",
      message: "broker event type must be RECONCILIATION, BUY, or SELL",
    });
  }
  const instrument = createInstrumentKey(event.instrument);
  const quantity = parsePositiveInput(event.quantity, "brokerTrade.quantity");
  const unitPrice = parsePositiveInput(event.unitPrice, "brokerTrade.unitPrice");
  const fee = parseNonNegativeInput(event.fee, "brokerTrade.fee", "INVALID_FEE");
  const displayName = optionalDisplayName(event.displayName);
  return {
    id: requireNonEmpty(event.id, "brokerEvent.id"),
    type: event.type,
    broker: broker(event.broker, "brokerTrade.broker"),
    instrument,
    ...(displayName === undefined ? {} : { displayName }),
    quantity: canonicalDecimal(quantity),
    unitPrice: canonicalDecimal(unitPrice),
    fee: canonicalDecimal(fee),
    cashStatus: settlementStatus(
      event.cashStatus,
      "brokerTrade.cashStatus",
    ),
    effectiveAt: canonicalTime(event.effectiveAt, "brokerTrade.effectiveAt"),
    recordedAt: canonicalTime(event.recordedAt, "brokerTrade.recordedAt"),
  };
}

export function createBrokerPortfolioBook(
  input: BrokerPortfolioBook,
): BrokerPortfolioBook {
  const positions = input.positions.map(createBrokerPositionState);
  const positionKeys = new Set<string>();
  for (const position of positions) {
    const key = brokerPositionKey(position);
    if (positionKeys.has(key)) {
      failDomain({
        code: "DUPLICATE_ENTRY_ID",
        field: "brokerPortfolio.positions",
        message: `duplicate broker position: ${key}`,
      });
    }
    positionKeys.add(key);
  }

  const cashAccounts = input.cashAccounts.map(createBrokerCashState);
  const cashBrokers = new Set<BrokerCode>();
  for (const account of cashAccounts) {
    if (cashBrokers.has(account.broker)) {
      failDomain({
        code: "DUPLICATE_ENTRY_ID",
        field: "brokerPortfolio.cashAccounts",
        message: `duplicate broker cash account: ${account.broker}`,
      });
    }
    cashBrokers.add(account.broker);
  }
  for (const required of BROKER_CODES) {
    if (!cashBrokers.has(required)) {
      failDomain({
        code: "INVALID_ENTRY",
        field: "brokerPortfolio.cashAccounts",
        message: `broker portfolio must contain ${required} USD cash`,
      });
    }
  }

  const events = input.events.map(cloneEvent);
  const eventIds = new Set<string>();
  for (const event of events) {
    if (eventIds.has(event.id)) {
      failDomain({
        code: "DUPLICATE_ENTRY_ID",
        field: "brokerPortfolio.events",
        entryId: event.id,
        message: `duplicate broker portfolio event: ${event.id}`,
      });
    }
    eventIds.add(event.id);
  }

  return {
    revision: validateRevision(input.revision),
    savedAt: canonicalTime(input.savedAt, "brokerPortfolio.savedAt"),
    positions: sortPositions(positions),
    cashAccounts: sortCash(cashAccounts),
    events,
  };
}

export function reconcileBrokerPortfolio(
  current: BrokerPortfolioBook | null,
  baseline: BrokerPortfolioBaselineInput,
  recordedAt: string,
  eventId: string,
): BrokerPortfolioBook {
  const positions = baseline.positions.map(createBrokerPositionState);
  const cashAccounts = baseline.cashAccounts.map(createBrokerCashState);
  const nextRevision = current === null ? 1 : current.revision + 1;
  if (!Number.isSafeInteger(nextRevision)) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerPortfolio.revision",
      message: "broker portfolio revision limit has been reached",
    });
  }
  const event: BrokerReconciliationEvent = {
    id: requireNonEmpty(eventId, "brokerEvent.id"),
    type: "RECONCILIATION",
    effectiveAt: canonicalTime(
      baseline.effectiveAt,
      "brokerReconciliation.effectiveAt",
    ),
    recordedAt: canonicalTime(recordedAt, "brokerReconciliation.recordedAt"),
    reason:
      baseline.reason === undefined
        ? current === null
          ? "建立双券商当前基线"
          : "按券商当前值校准"
        : requireNonEmpty(baseline.reason, "brokerReconciliation.reason"),
  };
  return createBrokerPortfolioBook({
    revision: nextRevision,
    savedAt: recordedAt,
    positions,
    cashAccounts,
    events: [...(current?.events ?? []), event],
  });
}

export function applyBrokerTrade(
  currentInput: BrokerPortfolioBook,
  tradeInput: ApplyBrokerTradeInput,
  recordedAt: string,
): BrokerPortfolioBook {
  const current = createBrokerPortfolioBook(currentInput);
  if (current.events.some((event) => event.id === tradeInput.id)) {
    failDomain({
      code: "DUPLICATE_ENTRY_ID",
      field: "brokerTrade.id",
      entryId: tradeInput.id,
      message: `duplicate broker trade id: ${tradeInput.id}`,
    });
  }
  const normalizedBroker = broker(tradeInput.broker, "brokerTrade.broker");
  const instrument = createInstrumentKey(tradeInput.instrument);
  const quantity = parsePositiveInput(tradeInput.quantity, "brokerTrade.quantity");
  const unitPrice = parsePositiveInput(tradeInput.unitPrice, "brokerTrade.unitPrice");
  const fee = parseNonNegativeInput(
    tradeInput.fee ?? "0",
    "brokerTrade.fee",
    "INVALID_FEE",
  );
  const cashStatus = settlementStatus(
    tradeInput.cashStatus,
    "brokerTrade.cashStatus",
  );
  canonicalTime(tradeInput.effectiveAt, "brokerTrade.effectiveAt");
  canonicalTime(recordedAt, "brokerTrade.recordedAt");
  const displayName = optionalDisplayName(tradeInput.displayName);
  const key = `${normalizedBroker}:${instrumentKeyId(instrument)}`;
  const positions = current.positions.map((position) => ({ ...position }));
  const positionIndex = positions.findIndex(
    (position) => brokerPositionKey(position) === key,
  );
  const gross = quantity.mul(unitPrice);
  let cashDelta;

  if (tradeInput.side === "BUY") {
    cashDelta = gross.add(fee).negated();
    if (positionIndex === -1) {
      positions.push({
        broker: normalizedBroker,
        instrument,
        ...(displayName === undefined ? {} : { displayName }),
        quantity: canonicalDecimal(quantity),
        totalOpenCost: canonicalDecimal(gross.add(fee)),
      });
    } else {
      const existing = positions[positionIndex]!;
      positions[positionIndex] = {
        ...existing,
        ...(displayName === undefined ? {} : { displayName }),
        quantity: canonicalDecimal(new Decimal(existing.quantity).add(quantity)),
        totalOpenCost: canonicalDecimal(
          new Decimal(existing.totalOpenCost).add(gross).add(fee),
        ),
      };
    }
  } else if (tradeInput.side === "SELL") {
    if (positionIndex === -1) {
      failDomain({
        code: "NEGATIVE_POSITION",
        field: "brokerTrade.quantity",
        message: `${normalizedBroker} does not hold ${instrument.symbol}`,
      });
    }
    const existing = positions[positionIndex]!;
    const existingQuantity = new Decimal(existing.quantity);
    if (quantity.gt(existingQuantity)) {
      failDomain({
        code: "NEGATIVE_POSITION",
        field: "brokerTrade.quantity",
        message: `sell quantity exceeds ${normalizedBroker} available quantity`,
      });
    }
    cashDelta = gross.sub(fee);
    const remainingQuantity = existingQuantity.sub(quantity);
    if (remainingQuantity.isZero()) {
      positions.splice(positionIndex, 1);
    } else {
      const remainingCost = new Decimal(existing.totalOpenCost)
        .mul(remainingQuantity)
        .div(existingQuantity);
      positions[positionIndex] = {
        ...existing,
        quantity: canonicalDecimal(remainingQuantity),
        totalOpenCost: canonicalDecimal(remainingCost),
      };
    }
  } else {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerTrade.side",
      message: "broker trade side must be BUY or SELL",
    });
  }

  const cashAccounts = current.cashAccounts.map((account) => ({ ...account }));
  const cashIndex = cashAccounts.findIndex(
    (account) => account.broker === normalizedBroker,
  );
  if (cashIndex === -1) {
    failDomain({
      code: "INVALID_ENTRY",
      field: "brokerTrade.broker",
      message: `cash account is missing for ${normalizedBroker}`,
    });
  }
  const cash = cashAccounts[cashIndex]!;
  const nextSettled =
    cashStatus === "SETTLED"
      ? new Decimal(cash.settledBalance).add(cashDelta)
      : new Decimal(cash.settledBalance);
  cashAccounts[cashIndex] = {
    ...cash,
    ...(cashStatus === "SETTLED"
      ? { settledBalance: canonicalDecimal(nextSettled) }
      : {
          pendingBalance: canonicalDecimal(
            new Decimal(cash.pendingBalance).add(cashDelta),
          ),
        }),
    ...(cash.navSource === "CASH_BALANCE_FALLBACK"
      ? { netAssetValue: canonicalDecimal(Decimal.max(nextSettled, 0)) }
      : {}),
  };

  const event: BrokerTradeEvent = {
    id: requireNonEmpty(tradeInput.id, "brokerTrade.id"),
    type: tradeInput.side,
    broker: normalizedBroker,
    instrument,
    ...(displayName === undefined ? {} : { displayName }),
    quantity: canonicalDecimal(quantity),
    unitPrice: canonicalDecimal(unitPrice),
    fee: canonicalDecimal(fee),
    cashStatus,
    effectiveAt: tradeInput.effectiveAt,
    recordedAt,
  };
  return createBrokerPortfolioBook({
    revision: current.revision + 1,
    savedAt: recordedAt,
    positions,
    cashAccounts,
    events: [...current.events, event],
  });
}

export function brokerCashBookBalance(account: BrokerCashState): DecimalString {
  const normalized = createBrokerCashState(account);
  return canonicalDecimal(
    new Decimal(normalized.settledBalance).add(normalized.pendingBalance),
  );
}

export function totalBrokerCashBalance(
  book: BrokerPortfolioBook,
): DecimalString {
  const validated = createBrokerPortfolioBook(book);
  return canonicalDecimal(
    validated.cashAccounts.reduce(
      (total, account) => total.add(brokerCashBookBalance(account)),
      new Decimal(0),
    ),
  );
}

export function brokerPositionFor(
  book: BrokerPortfolioBook,
  brokerCode: BrokerCode,
  instrument: InstrumentKey,
): BrokerPositionState | null {
  const validated = createBrokerPortfolioBook(book);
  const key = `${brokerCode}:${instrumentKeyId(instrument)}`;
  return (
    validated.positions.find((position) => brokerPositionKey(position) === key) ??
    null
  );
}

export function sameBrokerInstrument(
  left: BrokerPositionState,
  right: BrokerPositionState,
): boolean {
  return left.broker === right.broker && sameInstrument(left.instrument, right.instrument);
}
