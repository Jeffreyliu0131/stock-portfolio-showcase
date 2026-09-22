import type { DecimalString } from "../decimal.ts";
import type { InstrumentKey } from "../instrument.ts";

export type LedgerEntryType =
  | "OPENING_POSITION"
  | "BUY"
  | "SELL"
  | "POSITION_RECONCILIATION";

export type CostInput =
  | {
      readonly mode: "TOTAL_COST";
      readonly value: DecimalString;
    }
  | {
      readonly mode: "AVERAGE_COST";
      readonly value: DecimalString;
    };

export interface LedgerEntryBase {
  readonly id: string;
  readonly userId: string;
  readonly brokerAccountId: string;
  readonly instrument: InstrumentKey;
  readonly currency: string;
  readonly effectiveAt: string;
  readonly createdAt: string;
  readonly originalTimezone?: string;
  readonly supersedesEntryId?: string;
  readonly reason?: string;
}

export interface OpeningPositionEntry extends LedgerEntryBase {
  readonly type: "OPENING_POSITION";
  readonly quantity: DecimalString;
  readonly costInput: CostInput;
}

export interface BuyEntry extends LedgerEntryBase {
  readonly type: "BUY";
  readonly quantity: DecimalString;
  readonly unitPrice: DecimalString;
  readonly fee?: DecimalString;
}

export interface SellEntry extends LedgerEntryBase {
  readonly type: "SELL";
  readonly quantity: DecimalString;
  readonly unitPrice?: DecimalString;
  readonly fee?: DecimalString;
}

export interface PositionReconciliationEntry extends LedgerEntryBase {
  readonly type: "POSITION_RECONCILIATION";
  readonly quantity: DecimalString;
  readonly costInput: CostInput;
  readonly reason: string;
}

export type LedgerEntry =
  | OpeningPositionEntry
  | BuyEntry
  | SellEntry
  | PositionReconciliationEntry;

export interface OpenPositionState {
  readonly quantity: DecimalString;
  readonly openCost: DecimalString;
}

export interface BrokerPosition extends OpenPositionState {
  readonly userId: string;
  readonly brokerAccountId: string;
  readonly instrument: InstrumentKey;
  readonly averageCost: DecimalString | null;
  readonly appliedEntryIds: readonly string[];
  readonly calculationVersion: string;
}
