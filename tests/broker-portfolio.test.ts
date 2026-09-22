import { describe, expect, it } from "vitest";

import {
  applyBrokerTrade,
  brokerCashBookBalance,
  brokerPositionFor,
  reconcileBrokerPortfolio,
  totalBrokerCashBalance,
  type BrokerPortfolioBook,
  type InstrumentKey,
} from "../domain/index.ts";

const BOXX: InstrumentKey = {
  listingMarket: "NYSE_ARCA",
  symbol: "BOXX",
  currency: "USD",
};

const AAPL: InstrumentKey = {
  listingMarket: "NASDAQ",
  symbol: "AAPL",
  currency: "USD",
};

const SGOV: InstrumentKey = {
  listingMarket: "NYSE_ARCA",
  symbol: "SGOV",
  currency: "USD",
};

function baseline(): BrokerPortfolioBook {
  return reconcileBrokerPortfolio(
    null,
    {
      positions: [
        {
          broker: "IBKR",
          instrument: BOXX,
          displayName: "Alpha Architect 1-3 Month Box ETF",
          quantity: "10",
          totalOpenCost: "1000",
        },
        {
          broker: "MOOMOO",
          instrument: BOXX,
          displayName: "Alpha Architect 1-3 Month Box ETF",
          quantity: "5",
          totalOpenCost: "525",
        },
      ],
      cashAccounts: [
        {
          broker: "IBKR",
          currency: "USD",
          settledBalance: "2000",
          pendingBalance: "0",
          pricingPlan: "IBKR_PRO",
          netAssetValue: "50000",
          navSource: "USER_ENTERED",
        },
        {
          broker: "MOOMOO",
          currency: "USD",
          settledBalance: "300",
          pendingBalance: "0",
        },
      ],
      effectiveAt: "2026-08-20T01:00:00Z",
    },
    "2026-08-20T01:00:00Z",
    "baseline-1",
  );
}

describe("broker portfolio", () => {
  it("creates a two-broker reconciliation baseline without changing aggregation semantics", () => {
    const book = baseline();

    expect(book.revision).toBe(1);
    expect(book.positions).toHaveLength(2);
    expect(totalBrokerCashBalance(book)).toBe("2300");
    expect(book.events).toEqual([
      expect.objectContaining({ type: "RECONCILIATION", id: "baseline-1" }),
    ]);
  });

  it("buys in the selected broker and debits only that broker pending cash", () => {
    const book = applyBrokerTrade(
      baseline(),
      {
        id: "buy-1",
        side: "BUY",
        broker: "MOOMOO",
        instrument: BOXX,
        quantity: "2.5",
        unitPrice: "106",
        fee: "1",
        cashStatus: "PENDING",
        effectiveAt: "2026-08-20T02:00:00Z",
      },
      "2026-08-20T02:00:01Z",
    );

    expect(brokerPositionFor(book, "MOOMOO", BOXX)).toMatchObject({
      quantity: "7.5",
      totalOpenCost: "791",
    });
    expect(brokerPositionFor(book, "IBKR", BOXX)).toMatchObject({
      quantity: "10",
      totalOpenCost: "1000",
    });
    const moomooCash = book.cashAccounts.find(
      ({ broker }) => broker === "MOOMOO",
    );
    expect(moomooCash).toMatchObject({
      settledBalance: "300",
      pendingBalance: "-266",
    });
    expect(totalBrokerCashBalance(book)).toBe("2034");
  });

  it("sells from one broker, preserves that broker average cost, and credits net proceeds", () => {
    const book = applyBrokerTrade(
      baseline(),
      {
        id: "sell-1",
        side: "SELL",
        broker: "IBKR",
        instrument: BOXX,
        quantity: "4",
        unitPrice: "108",
        fee: "2",
        cashStatus: "SETTLED",
        effectiveAt: "2026-08-20T03:00:00Z",
      },
      "2026-08-20T03:00:01Z",
    );

    expect(brokerPositionFor(book, "IBKR", BOXX)).toMatchObject({
      quantity: "6",
      totalOpenCost: "600",
    });
    expect(brokerPositionFor(book, "MOOMOO", BOXX)).toMatchObject({
      quantity: "5",
      totalOpenCost: "525",
    });
    const ibkrCash = book.cashAccounts.find(({ broker }) => broker === "IBKR");
    expect(ibkrCash).toMatchObject({
      settledBalance: "2430",
      pendingBalance: "0",
    });
  });

  it("applies the same pooled-cash invariant to every stock buy and sell", () => {
    const source = reconcileBrokerPortfolio(
      null,
      {
        positions: [
          {
            broker: "IBKR",
            instrument: AAPL,
            quantity: "10",
            totalOpenCost: "1000",
          },
          {
            broker: "MOOMOO",
            instrument: SGOV,
            quantity: "5",
            totalOpenCost: "500",
          },
        ],
        cashAccounts: [
          {
            broker: "IBKR",
            currency: "USD",
            settledBalance: "2000",
            pendingBalance: "0",
          },
          {
            broker: "MOOMOO",
            currency: "USD",
            settledBalance: "300",
            pendingBalance: "0",
          },
        ],
        effectiveAt: "2026-08-22T01:00:00Z",
      },
      "2026-08-22T01:00:00Z",
      "all-stocks-baseline",
    );

    const afterSell = applyBrokerTrade(
      source,
      {
        id: "sell-aapl",
        side: "SELL",
        broker: "IBKR",
        instrument: AAPL,
        quantity: "3",
        unitPrice: "150",
        fee: "1",
        cashStatus: "SETTLED",
        effectiveAt: "2026-08-22T02:00:00Z",
      },
      "2026-08-22T02:00:01Z",
    );
    expect(totalBrokerCashBalance(afterSell)).toBe("2749");
    expect(brokerPositionFor(afterSell, "IBKR", AAPL)).toMatchObject({
      quantity: "7",
      totalOpenCost: "700",
    });

    const afterBuy = applyBrokerTrade(
      afterSell,
      {
        id: "buy-sgov",
        side: "BUY",
        broker: "MOOMOO",
        instrument: SGOV,
        quantity: "2",
        unitPrice: "100",
        fee: "1",
        cashStatus: "PENDING",
        effectiveAt: "2026-08-22T03:00:00Z",
      },
      "2026-08-22T03:00:01Z",
    );
    expect(totalBrokerCashBalance(afterBuy)).toBe("2548");
    expect(brokerPositionFor(afterBuy, "MOOMOO", SGOV)).toMatchObject({
      quantity: "7",
      totalOpenCost: "701",
    });
  });

  it("removes only the sold-out broker sub-position", () => {
    const book = applyBrokerTrade(
      baseline(),
      {
        id: "sell-all-ibkr",
        side: "SELL",
        broker: "IBKR",
        instrument: BOXX,
        quantity: "10",
        unitPrice: "107",
        cashStatus: "PENDING",
        effectiveAt: "2026-08-20T04:00:00Z",
      },
      "2026-08-20T04:00:01Z",
    );

    expect(brokerPositionFor(book, "IBKR", BOXX)).toBeNull();
    expect(brokerPositionFor(book, "MOOMOO", BOXX)).not.toBeNull();
  });

  it("rejects selling more than the selected broker holds", () => {
    expect(() =>
      applyBrokerTrade(
        baseline(),
        {
          id: "oversell",
          side: "SELL",
          broker: "MOOMOO",
          instrument: BOXX,
          quantity: "6",
          unitPrice: "107",
          cashStatus: "SETTLED",
          effectiveAt: "2026-08-20T05:00:00Z",
        },
        "2026-08-20T05:00:01Z",
      ),
    ).toThrow(/exceeds MOOMOO available quantity/);
  });

  it("keeps signed book cash while interest can remain based on settled cash", () => {
    const book = applyBrokerTrade(
      baseline(),
      {
        id: "large-buy",
        side: "BUY",
        broker: "IBKR",
        instrument: BOXX,
        quantity: "30",
        unitPrice: "100",
        cashStatus: "SETTLED",
        effectiveAt: "2026-08-20T06:00:00Z",
      },
      "2026-08-20T06:00:01Z",
    );
    const ibkrCash = book.cashAccounts.find(({ broker }) => broker === "IBKR")!;

    expect(ibkrCash.settledBalance).toBe("-1000");
    expect(brokerCashBookBalance(ibkrCash)).toBe("-1000");
  });

  it("keeps fallback NAV aligned when a settled trade changes IBKR cash", () => {
    const source = reconcileBrokerPortfolio(
      null,
      {
        positions: [],
        cashAccounts: [
          {
            broker: "IBKR",
            currency: "USD",
            settledBalance: "20000",
            pendingBalance: "0",
            pricingPlan: "IBKR_PRO",
            netAssetValue: "20000",
            navSource: "CASH_BALANCE_FALLBACK",
          },
          {
            broker: "MOOMOO",
            currency: "USD",
            settledBalance: "0",
            pendingBalance: "0",
          },
        ],
        effectiveAt: "2026-08-20T07:00:00Z",
      },
      "2026-08-20T07:00:00Z",
      "fallback-baseline",
    );
    const traded = applyBrokerTrade(
      source,
      {
        id: "fallback-buy",
        side: "BUY",
        broker: "IBKR",
        instrument: BOXX,
        quantity: "10",
        unitPrice: "100",
        cashStatus: "SETTLED",
        effectiveAt: "2026-08-20T08:00:00Z",
      },
      "2026-08-20T08:00:01Z",
    );
    expect(
      traded.cashAccounts.find(({ broker }) => broker === "IBKR"),
    ).toMatchObject({
      settledBalance: "19000",
      netAssetValue: "19000",
      navSource: "CASH_BALANCE_FALLBACK",
    });
  });
});
