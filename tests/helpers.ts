import type {
  BuyEntry,
  CostInput,
  InstrumentKey,
  OpeningPositionEntry,
  PositionReconciliationEntry,
  SellEntry,
  ValidMarketQuote,
} from "../domain/index.ts";

export const AAPL: InstrumentKey = {
  listingMarket: "NASDAQ",
  symbol: "AAPL",
  currency: "USD",
};

export const MSFT: InstrumentKey = {
  listingMarket: "NASDAQ",
  symbol: "MSFT",
  currency: "USD",
};

interface EntryOptions {
  readonly id: string;
  readonly userId?: string;
  readonly brokerAccountId?: string;
  readonly instrument?: InstrumentKey;
  readonly effectiveAt?: string;
  readonly createdAt?: string;
  readonly supersedesEntryId?: string;
  readonly reason?: string;
}

function baseEntry(options: EntryOptions) {
  return {
    id: options.id,
    userId: options.userId ?? "user-1",
    brokerAccountId: options.brokerAccountId ?? "broker-a",
    instrument: options.instrument ?? AAPL,
    currency: (options.instrument ?? AAPL).currency,
    effectiveAt: options.effectiveAt ?? "2026-07-01T14:00:00Z",
    createdAt: options.createdAt ?? "2026-07-01T14:00:01Z",
    ...(options.supersedesEntryId === undefined
      ? {}
      : { supersedesEntryId: options.supersedesEntryId }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

export function openingEntry(
  options: EntryOptions & {
    readonly quantity: string;
    readonly costInput: CostInput;
  },
): OpeningPositionEntry {
  return {
    ...baseEntry(options),
    type: "OPENING_POSITION",
    quantity: options.quantity,
    costInput: options.costInput,
  };
}

export function buyEntry(
  options: EntryOptions & {
    readonly quantity: string;
    readonly unitPrice: string;
    readonly fee?: string;
  },
): BuyEntry {
  return {
    ...baseEntry(options),
    type: "BUY",
    quantity: options.quantity,
    unitPrice: options.unitPrice,
    ...(options.fee === undefined ? {} : { fee: options.fee }),
  };
}

export function sellEntry(
  options: EntryOptions & {
    readonly quantity: string;
    readonly unitPrice?: string;
    readonly fee?: string;
  },
): SellEntry {
  return {
    ...baseEntry(options),
    type: "SELL",
    quantity: options.quantity,
    ...(options.unitPrice === undefined
      ? {}
      : { unitPrice: options.unitPrice }),
    ...(options.fee === undefined ? {} : { fee: options.fee }),
  };
}

export function reconciliationEntry(
  options: EntryOptions & {
    readonly quantity: string;
    readonly costInput: CostInput;
    readonly reason: string;
  },
): PositionReconciliationEntry {
  return {
    ...baseEntry(options),
    type: "POSITION_RECONCILIATION",
    quantity: options.quantity,
    costInput: options.costInput,
    reason: options.reason,
  };
}

export function validQuote(
  overrides: Partial<ValidMarketQuote> = {},
): ValidMarketQuote {
  return {
    instrument: AAPL,
    provider: "fixture-provider",
    feed: "delayed_sip",
    price: "130",
    priceType: "LATEST_TRADE",
    sourceEventAt: "2026-07-29T14:45:00Z",
    fetchedAt: "2026-07-29T15:00:30Z",
    marketSession: "REGULAR",
    previousRegularClose: "125",
    ...overrides,
  };
}
