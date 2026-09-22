import { describe, expect, it } from "vitest";

import type { CashSnapshot } from "../application/cash/types.ts";
import type { PositionSnapshot } from "../application/positions/types.ts";
import { resolveQuote } from "../domain/quotes.ts";
import { AAPL, MSFT, validQuote } from "../tests/helpers.ts";
import { createPortfolioViewModel } from "./portfolio-view-model.ts";

function snapshot(
  instrument: typeof AAPL,
  quantity: string,
  totalOpenCost: string,
  displayName: string,
): PositionSnapshot {
  return {
    revision: 1,
    savedAt: "2026-07-30T01:00:00Z",
    batch: {
      instrument,
      displayName,
      inputs: [
        {
          id: `${instrument.symbol}-1`,
          instrument,
          quantity,
          costInput: {
            mode: "TOTAL_OPEN_COST",
            value: totalOpenCost,
          },
        },
      ],
    },
  };
}

function quote(
  instrument: typeof AAPL,
  price: string,
  previousRegularClose: string = price,
) {
  const candidate = validQuote({
    instrument,
    price,
    previousRegularClose,
  });
  return resolveQuote({
    requestedInstrument: instrument,
    now: "2026-07-29T15:01:00Z",
    fetchStatus: "FETCH_OK",
    marketSession: candidate.marketSession,
    candidate,
  });
}

const IBKR_CASH: CashSnapshot = {
  revision: 1,
  savedAt: "2026-08-02T01:00:00Z",
  account: {
    provider: "IBKR",
    currency: "USD",
    balance: "20000",
    netAssetValue: "80000",
    navSource: "USER_ENTERED",
    pricingPlan: "IBKR_PRO",
  },
};

describe("createPortfolioViewModel", () => {
  it("renders an actual empty portfolio without zero-value summary cards", () => {
    expect(createPortfolioViewModel([], [])).toEqual({
      viewState: "empty",
    });
  });

  it("renders cash by itself as an asset with a separate interest estimate", () => {
    const result = createPortfolioViewModel(
      [],
      [],
      { currency: "USD" },
      IBKR_CASH,
    );

    expect(result).toMatchObject({
      viewState: "ready",
      summaryLabel: "估算总资产",
      marketValue: "$20,000.00",
      openCost: "$20,000.00",
      stockOpenCost: "$0.00",
      pnl: "$0.00",
      returnRate: "0.00%",
      dailyChange: "—",
      dailyChangeRate: "—",
      dailyChangeDirection: "neutral",
      status: {
        source: "IBKR 现金为本机记录 · 利息按公开规则估算",
      },
      positions: [],
      cash: {
        balance: "$20,000.00",
        pricingPlan: "IBKR Pro",
        interestBearingBalance: "$10,000.00",
        publishedAnnualRate: "+3.13%",
        navAdjustedAnnualRate: "+2.50%",
        blendedAnnualRate: "+1.25%",
        estimatedAnnualInterest: "+$250.40",
        estimatedMonthlyInterest: "+$20.87",
      },
    });
  });

  it("adds cash to total assets without adding cash or interest to daily PnL", () => {
    const result = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [quote(AAPL, "130", "125")],
      { currency: "USD" },
      IBKR_CASH,
    );

    expect(result).toMatchObject({
      viewState: "ready",
      summaryLabel: "估算总资产",
      marketValue: "$21,300.00",
      openCost: "$21,000.00",
      stockOpenCost: "$1,000.00",
      pnl: "+$300.00",
      returnRate: "+1.43%",
      dailyChange: "+$50.00",
      dailyChangeRate: "+4.00%",
      dailyChangeDirection: "positive",
      cash: {
        estimatedAnnualInterest: "+$250.40",
      },
    });
  });

  it("labels cash as the priced asset subtotal when every stock is unpriced", () => {
    const usd = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [],
      { currency: "USD" },
      IBKR_CASH,
    );

    expect(usd).toMatchObject({
      viewState: "ready",
      summaryLabel: "已计价资产",
      marketValue: "$20,000.00",
      status: {
        source: "15 分钟延迟",
      },
      positions: [
        {
          symbol: "AAPL",
          marketValue: "—",
          valuationPrice: "—",
          pnl: "待定价",
        },
      ],
    });

    const cny = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [],
      { currency: "CNY", usdCnyRate: "7.2" },
      IBKR_CASH,
    );

    expect(cny).toMatchObject({
      viewState: "ready",
      summaryLabel: "人民币已计价资产",
      marketValue: "¥144,000.00",
    });
  });

  it("labels priced stocks plus cash as an incomplete asset subtotal", () => {
    const result = createPortfolioViewModel(
      [
        snapshot(AAPL, "10", "1000", "Apple Inc."),
        snapshot(MSFT, "2", "600", "Microsoft Corp."),
      ],
      [quote(AAPL, "130")],
      { currency: "USD" },
      IBKR_CASH,
    );

    expect(result).toMatchObject({
      viewState: "ready",
      summaryLabel: "已计价资产",
      marketValue: "$21,300.00",
    });
  });

  it("shows the estimated change from the previous regular close for the portfolio and holding", () => {
    const usd = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [quote(AAPL, "130", "125")],
    );

    expect(usd).toMatchObject({
      viewState: "ready",
      dailyChange: "+$50.00",
      dailyChangeRate: "+4.00%",
      dailyChangeDirection: "positive",
      positions: [
        {
          dailyChange: "+$50.00",
          dailyChangeRate: "+4.00%",
          dailyChangeDirection: "positive",
        },
      ],
    });

    const cny = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [quote(AAPL, "130", "125")],
      { currency: "CNY", usdCnyRate: "7.2" },
    );
    expect(cny).toMatchObject({
      viewState: "ready",
      dailyChange: "+¥360.00",
      dailyChangeRate: "+4.00%",
      positions: [
        {
          dailyChange: "+¥360.00",
          dailyChangeRate: "+4.00%",
        },
      ],
    });
  });

  it("derives cash display amounts from the same USD truth in CNY mode", () => {
    const result = createPortfolioViewModel(
      [],
      [],
      { currency: "CNY", usdCnyRate: "7.2" },
      IBKR_CASH,
    );

    expect(result).toMatchObject({
      viewState: "ready",
      summaryLabel: "人民币估算总资产",
      marketValue: "¥144,000.00",
      openCost: "¥144,000.00",
      stockOpenCost: "¥0.00",
      cash: {
        balance: "¥144,000.00",
        netAssetValueUsd: "$80,000.00",
        estimatedAnnualInterest: "+¥1,802.88",
        estimatedMonthlyInterest: "+¥150.24",
      },
    });
  });

  it("marks a subtotal as incomplete when one holding has no price", () => {
    const result = createPortfolioViewModel(
      [
        snapshot(AAPL, "10", "1000", "Apple Inc."),
        snapshot(MSFT, "2", "600", "Microsoft Corp."),
      ],
      [quote(AAPL, "130")],
    );

    expect(result).toMatchObject({
      viewState: "ready",
      summaryLabel: "已定价市值",
      pnlLabel: "已定价部分盈亏",
      marketValue: "$1,300.00",
      openCost: "$1,600.00",
      stockOpenCost: "$1,600.00",
      dailyChange: "—",
      dailyChangeRate: "—",
      dailyChangeDirection: "neutral",
      status: {
        source: "15 分钟延迟",
      },
    });
    if (result.viewState === "ready") {
      expect(result.positions.find(({ symbol }) => symbol === "MSFT"))
        .toMatchObject({
          marketValue: "—",
          valuationPrice: "—",
          pnl: "待定价",
          dailyChange: "—",
          dailyChangeRate: "—",
        });
    }
  });

  it("uses unrounded domain values before formatting the merged result", () => {
    const mergedSnapshot: PositionSnapshot = {
      revision: 2,
      savedAt: "2026-07-30T01:00:00Z",
      batch: {
        instrument: AAPL,
        displayName: "Apple Inc.",
        inputs: [
          {
            id: "one",
            instrument: AAPL,
            quantity: "0.1",
            costInput: { mode: "AVERAGE_COST", value: "0.2" },
          },
          {
            id: "two",
            instrument: AAPL,
            quantity: "0.2",
            costInput: { mode: "AVERAGE_COST", value: "0.2" },
          },
        ],
      },
    };
    const result = createPortfolioViewModel(
      [mergedSnapshot],
      [quote(AAPL, "1")],
    );

    if (result.viewState !== "ready") {
      throw new Error("expected a ready portfolio");
    }
    expect(result.positions[0]).toMatchObject({
      quantity: "0.3",
      averageCost: "$0.20",
      marketValue: "$0.30",
      pnl: "+$0.24",
    });
  });

  it("derives the complete CNY display from unrounded USD values", () => {
    const mergedSnapshot: PositionSnapshot = {
      revision: 2,
      savedAt: "2026-07-30T01:00:00Z",
      batch: {
        instrument: AAPL,
        displayName: "Apple Inc.",
        inputs: [
          {
            id: "one",
            instrument: AAPL,
            quantity: "0.1",
            costInput: { mode: "AVERAGE_COST", value: "0.2" },
          },
          {
            id: "two",
            instrument: AAPL,
            quantity: "0.2",
            costInput: { mode: "AVERAGE_COST", value: "0.2" },
          },
        ],
      },
    };

    const result = createPortfolioViewModel(
      [mergedSnapshot],
      [quote(AAPL, "1")],
      { currency: "CNY", usdCnyRate: "7.2" },
    );

    expect(result).toMatchObject({
      viewState: "ready",
      summaryLabel: "人民币估算总市值",
      marketValue: "¥2.16",
      openCost: "¥0.43",
      stockOpenCost: "¥0.43",
      pnl: "+¥1.73",
      pnlLabel: "折算浮动盈亏",
      returnRate: "+400.00%",
      positions: [
        {
          quantity: "0.3",
          averageCost: "¥1.44",
          valuationPrice: "¥7.20",
          marketValue: "¥2.16",
          pnl: "+¥1.73",
          returnRate: "+400.00%",
        },
      ],
    });
  });

  it("sorts the visible list by unrounded market value", () => {
    const result = createPortfolioViewModel(
      [
        snapshot(AAPL, "1", "1", "Apple Inc."),
        snapshot(MSFT, "1", "1", "Microsoft Corp."),
      ],
      [quote(AAPL, "10.003"), quote(MSFT, "10.004")],
    );

    if (result.viewState !== "ready") {
      throw new Error("expected a ready portfolio");
    }
    expect(result.positions.map(({ symbol }) => symbol)).toEqual([
      "MSFT",
      "AAPL",
    ]);
    expect(result.positions.map(({ marketValue }) => marketValue)).toEqual([
      "$10.00",
      "$10.00",
    ]);
  });

  it("presents a confirmed closure with the last fetched market price", () => {
    const closed = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-08-01T16:00:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "CLOSED",
      candidate: validQuote({
        instrument: AAPL,
        marketSession: "CLOSED",
        sourceEventAt: "2026-07-31T19:45:00Z",
        fetchedAt: "2026-07-31T20:00:00Z",
      }),
      closedSessionDataFinal: true,
    });

    const result = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [closed],
    );

    expect(result).toMatchObject({
      viewState: "ready",
      positions: [
        {
          valuationPrice: "$130.00",
        },
      ],
    });
  });

  it("labels an overnight derived trade and its source explicitly", () => {
    const overnight = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-31T01:00:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "OVERNIGHT",
      candidate: validQuote({
        instrument: AAPL,
        feed: "overnight",
        priceType: "INDICATIVE_TRADE",
        marketSession: "OVERNIGHT",
        sourceEventAt: "2026-07-31T00:45:00Z",
        fetchedAt: "2026-07-31T01:00:00Z",
      }),
    });

    const result = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [overnight],
    );

    expect(result).toMatchObject({
      viewState: "ready",
      status: {
        source: "15 分钟延迟",
      },
      positions: [
        {
          valuationPrice: "$130.00",
        },
      ],
    });
  });

  it("keeps an aging quote usable without adding row-level status copy", () => {
    const candidate = validQuote({
      instrument: AAPL,
      marketSession: "PRE_MARKET",
      sourceEventAt: "2026-07-29T14:43:59.999999999Z",
      fetchedAt: "2026-07-29T15:00:30Z",
    });
    const aging = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "PRE_MARKET",
      candidate,
    });

    const result = createPortfolioViewModel(
      [snapshot(AAPL, "10", "1000", "Apple Inc.")],
      [aging],
    );

    expect(result).toMatchObject({
      viewState: "ready",
      positions: [
        {
          valuationPrice: "$130.00",
        },
      ],
    });
  });
});
