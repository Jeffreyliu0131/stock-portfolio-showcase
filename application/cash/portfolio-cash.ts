import {
  Decimal,
  canonicalDecimal,
  estimateIbkrUsdCashInterest,
  type BrokerCode,
  type DecimalString,
  type IbkrUsdCashInterestEstimate,
} from "../../domain/index.ts";
import type { CashSnapshot } from "./types.ts";

export interface PortfolioCashAccountSource {
  readonly broker: BrokerCode;
  readonly settledBalance: DecimalString;
  readonly pendingBalance: DecimalString;
  readonly balance: DecimalString;
  readonly ibkrSnapshot: CashSnapshot | null;
}

export interface PortfolioCashSource {
  readonly mode: "LEGACY" | "BROKER";
  readonly totalBalance: DecimalString;
  readonly accounts: readonly PortfolioCashAccountSource[];
  readonly ibkrInterest: {
    readonly snapshot: CashSnapshot;
    readonly estimate: IbkrUsdCashInterestEstimate;
  } | null;
}

export type PortfolioCashInput = CashSnapshot | PortfolioCashSource | null;

function isPortfolioCashSource(value: PortfolioCashInput): value is PortfolioCashSource {
  return value !== null && "totalBalance" in value && "accounts" in value;
}

export function portfolioCashSourceFromLegacy(
  snapshot: CashSnapshot | null,
): PortfolioCashSource | null {
  if (snapshot === null) {
    return null;
  }
  return {
    mode: "LEGACY",
    totalBalance: snapshot.account.balance,
    accounts: [
      {
        broker: "IBKR",
        settledBalance: snapshot.account.balance,
        pendingBalance: "0",
        balance: snapshot.account.balance,
        ibkrSnapshot: snapshot,
      },
    ],
    ibkrInterest: {
      snapshot,
      estimate: estimateIbkrUsdCashInterest(snapshot.account),
    },
  };
}

export function normalizePortfolioCashInput(
  input: PortfolioCashInput,
): PortfolioCashSource | null {
  if (input === null) {
    return null;
  }
  if (!isPortfolioCashSource(input)) {
    return portfolioCashSourceFromLegacy(input);
  }
  const accounts = input.accounts.map((account) => ({
    ...account,
    balance: canonicalDecimal(
      new Decimal(account.settledBalance).add(account.pendingBalance),
    ),
  }));
  const totalBalance = canonicalDecimal(
    accounts.reduce(
      (total, account) => total.add(account.balance),
      new Decimal(0),
    ),
  );
  const ibkr = accounts.find((account) => account.broker === "IBKR") ?? null;
  const ibkrInterest =
    ibkr?.ibkrSnapshot === null || ibkr?.ibkrSnapshot === undefined
      ? null
      : {
          snapshot: ibkr.ibkrSnapshot,
          estimate: estimateIbkrUsdCashInterest(ibkr.ibkrSnapshot.account),
        };
  return {
    mode: input.mode,
    totalBalance,
    accounts,
    ibkrInterest,
  };
}
