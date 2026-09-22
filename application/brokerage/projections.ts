import {
  Decimal,
  canonicalDecimal,
  instrumentKeyId,
  type BrokerPortfolioBook,
} from "../../domain/index.ts";
import type {
  PortfolioCashAccountSource,
  PortfolioCashSource,
} from "../cash/portfolio-cash.ts";
import type { CashSnapshot } from "../cash/types.ts";
import type { PositionSnapshot } from "../positions/types.ts";

export function projectBrokerPortfolioSnapshots(
  book: BrokerPortfolioBook,
): readonly PositionSnapshot[] {
  const grouped = new Map<
    string,
    {
      instrument: BrokerPortfolioBook["positions"][number]["instrument"];
      displayName?: string;
      inputs: PositionSnapshot["batch"]["inputs"][number][];
    }
  >();
  for (const position of book.positions) {
    const key = instrumentKeyId(position.instrument);
    const current = grouped.get(key) ?? {
      instrument: position.instrument,
      ...(position.displayName === undefined
        ? {}
        : { displayName: position.displayName }),
      inputs: [],
    };
    current.inputs.push({
      id: `broker-${position.broker.toLowerCase()}`,
      instrument: position.instrument,
      quantity: position.quantity,
      costInput: {
        mode: "TOTAL_OPEN_COST",
        value: position.totalOpenCost,
      },
    });
    if (current.displayName === undefined && position.displayName !== undefined) {
      current.displayName = position.displayName;
    }
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map(
      (entry): PositionSnapshot => ({
        revision: book.revision,
        savedAt: book.savedAt,
        batch: {
          instrument: entry.instrument,
          ...(entry.displayName === undefined
            ? {}
            : { displayName: entry.displayName }),
          inputs: entry.inputs,
        },
      }),
    )
    .toSorted((left, right) =>
      instrumentKeyId(left.batch.instrument).localeCompare(
        instrumentKeyId(right.batch.instrument),
      ),
    );
}

export function projectBrokerPortfolioCash(
  book: BrokerPortfolioBook,
): PortfolioCashSource {
  const accounts: PortfolioCashAccountSource[] = book.cashAccounts.map(
    (account) => {
      const balance = canonicalDecimal(
        new Decimal(account.settledBalance).add(account.pendingBalance),
      );
      let ibkrSnapshot: CashSnapshot | null = null;
      if (
        account.broker === "IBKR" &&
        new Decimal(account.settledBalance).gt(0) &&
        account.pricingPlan !== undefined &&
        account.netAssetValue !== undefined &&
        new Decimal(account.netAssetValue).gt(0) &&
        account.navSource !== undefined
      ) {
        ibkrSnapshot = {
          revision: book.revision,
          savedAt: book.savedAt,
          account: {
            provider: "IBKR",
            currency: "USD",
            balance: account.settledBalance,
            netAssetValue: account.netAssetValue,
            navSource: account.navSource,
            pricingPlan: account.pricingPlan,
          },
        };
      }
      return {
        broker: account.broker,
        settledBalance: account.settledBalance,
        pendingBalance: account.pendingBalance,
        balance,
        ibkrSnapshot,
      };
    },
  );
  return {
    mode: "BROKER",
    totalBalance: canonicalDecimal(
      accounts.reduce(
        (total, account) => total.add(account.balance),
        new Decimal(0),
      ),
    ),
    accounts,
    ibkrInterest: null,
  };
}
