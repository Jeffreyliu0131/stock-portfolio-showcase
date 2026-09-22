import Decimal from "decimal.js";

import {
  normalizePortfolioCashInput,
  type PortfolioCashInput,
  type PortfolioCashSource,
} from "../application/cash/index.ts";
import type { PositionSnapshot } from "../application/positions/types.ts";
import {
  IBKR_USD_INTEREST_POLICY,
  aggregatePositionInputs,
  deriveCnyAmount,
  instrumentKeyId,
  summarizePortfolio,
  valuePosition,
  type DecimalString,
  type ResolvedQuote,
} from "../domain/index.ts";
import {
  formatCny,
  formatQuantity,
  formatUsd,
} from "./position-preview.ts";
import type {
  PortfolioCash,
  PortfolioFixture,
  PortfolioPosition,
} from "./portfolio-fixtures.ts";

export type PortfolioDisplayOptions =
  | { readonly currency: "USD" }
  | {
      readonly currency: "CNY";
      readonly usdCnyRate: DecimalString;
    };

type MoneyFormatter = (value: DecimalString) => string;

function moneyFormatter(
  options: PortfolioDisplayOptions,
): MoneyFormatter {
  if (options.currency === "USD") {
    return formatUsd;
  }
  return (value) =>
    formatCny(
      deriveCnyAmount(value, options.usdCnyRate).cnyAmount,
    );
}

function signedMoney(
  value: string,
  formatMoney: MoneyFormatter,
): string {
  const decimal = new Decimal(value);
  if (decimal.isZero()) {
    return formatMoney("0");
  }
  const sign = decimal.isPositive() ? "+" : "−";
  return `${sign}${formatMoney(decimal.abs().toString())}`;
}

function percent(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const decimal = new Decimal(value).mul(100);
  const sign = decimal.isZero()
    ? ""
    : decimal.isPositive()
      ? "+"
      : "−";
  return `${sign}${decimal.abs().toFixed(2)}%`;
}

function direction(
  value: string | null,
): "positive" | "negative" | "neutral" {
  if (value === null) {
    return "neutral";
  }
  const decimal = new Decimal(value);
  return decimal.isZero()
    ? "neutral"
    : decimal.isPositive()
    ? "positive"
    : "negative";
}

function positionView(
  snapshot: PositionSnapshot,
  quote: ResolvedQuote | null,
  formatMoney: MoneyFormatter,
): PortfolioPosition {
  const [position] = aggregatePositionInputs(snapshot.batch.inputs);
  if (position === undefined) {
    throw new Error("a committed position batch must not be empty");
  }
  const valued = valuePosition(position, quote);
  return {
    instrumentKey: instrumentKeyId(position.instrument),
    symbol: position.instrument.symbol,
    name: snapshot.batch.displayName ?? position.instrument.symbol,
    quantity: formatQuantity(position.quantity),
    averageCost: formatMoney(position.averageCost),
    marketValue:
      valued.marketValue === null
        ? "—"
        : formatMoney(valued.marketValue),
    valuationPrice:
      valued.valuationPrice === null
        ? "—"
        : formatMoney(valued.valuationPrice),
    pnl:
      valued.unrealizedPnl === null
        ? "待定价"
        : signedMoney(valued.unrealizedPnl, formatMoney),
    returnRate: percent(valued.unrealizedReturn),
    pnlDirection: direction(valued.unrealizedPnl),
    dailyChange:
      valued.estimatedDailyPriceEffect === null
        ? "—"
        : signedMoney(
            valued.estimatedDailyPriceEffect,
            formatMoney,
          ),
    dailyChangeRate: percent(valued.estimatedDailyChangeRate),
    dailyChangeDirection: direction(
      valued.estimatedDailyPriceEffect,
    ),
  };
}

function cashView(
  source: PortfolioCashSource,
  formatMoney: MoneyFormatter,
): PortfolioCash {
  const interest = source.ibkrInterest;
  const estimate = interest?.estimate ?? null;
  const snapshot = interest?.snapshot ?? null;
  return {
    balance: formatMoney(source.totalBalance),
    accounts: source.accounts.map((account) => ({
      broker: account.broker,
      balance: formatMoney(account.balance),
      settledBalance: formatMoney(account.settledBalance),
      pendingBalance: formatMoney(account.pendingBalance),
      hasPending: !new Decimal(account.pendingBalance).isZero(),
      isNegative: new Decimal(account.balance).isNegative(),
    })),
    hasIbkrInterest: estimate !== null,
    netAssetValueUsd:
      estimate === null ? "—" : formatUsd(estimate.netAssetValue),
    navIsCashFallback:
      snapshot?.account.navSource === "CASH_BALANCE_FALLBACK",
    pricingPlan:
      estimate === null
        ? "未配置"
        : estimate.pricingPlan === "IBKR_PRO"
          ? "IBKR Pro"
          : "IBKR Lite",
    interestBearingBalance:
      estimate === null ? "—" : formatMoney(estimate.interestBearingBalance),
    publishedAnnualRate:
      estimate === null ? "—" : percent(estimate.publishedAnnualRate),
    navAdjustedAnnualRate:
      estimate === null ? "—" : percent(estimate.navAdjustedAnnualRate),
    blendedAnnualRate:
      estimate === null ? "—" : percent(estimate.blendedAnnualRate),
    estimatedAnnualInterest:
      estimate === null
        ? "—"
        : signedMoney(estimate.estimatedAnnualInterest, formatMoney),
    estimatedMonthlyInterest:
      estimate === null
        ? "—"
        : signedMoney(estimate.estimatedMonthlyInterest, formatMoney),
    policyVerifiedAt: IBKR_USD_INTEREST_POLICY.verifiedAt,
    sourceUrl: IBKR_USD_INTEREST_POLICY.sourceUrl,
  };
}

export function createPortfolioViewModel(
  snapshots: readonly PositionSnapshot[],
  quotes: readonly ResolvedQuote[],
  options: PortfolioDisplayOptions = { currency: "USD" },
  cashInput: PortfolioCashInput = null,
): PortfolioFixture {
  const cash = normalizePortfolioCashInput(cashInput);
  if (snapshots.length === 0 && cash === null) {
    return { viewState: "empty" };
  }

  const quotesByInstrument = new Map(
    quotes.map((quote) => [instrumentKeyId(quote.instrument), quote]),
  );
  const formatMoney = moneyFormatter(options);
  const valued = snapshots.map((snapshot) => {
    const [position] = aggregatePositionInputs(snapshot.batch.inputs);
    if (position === undefined) {
      throw new Error("a committed position batch must not be empty");
    }
    const quote =
      quotesByInstrument.get(instrumentKeyId(position.instrument)) ?? null;
    return valuePosition(position, quote);
  });
  const summary = summarizePortfolio(valued);
  const cashBalance =
    cash === null
      ? new Decimal(0)
      : new Decimal(cash.totalBalance);
  const totalPricedAssetValue = new Decimal(
    summary.pricedMarketValue,
  ).add(cashBalance);
  const totalRecordedPrincipal = new Decimal(
    summary.portfolioOpenCost,
  ).add(cashBalance);
  const pricedPrincipal = new Decimal(summary.pricedOpenCost).add(
    cashBalance,
  );
  const pricedCount =
    summary.openPositionCount - summary.unpricedPositionCount;
  const hasAnyPrice = pricedCount > 0;
  const hasAnyAssetValue = hasAnyPrice || cash !== null;
  const hasUnpricedStocks = summary.unpricedPositionCount > 0;
  const portfolioReturn =
    !hasAnyAssetValue || pricedPrincipal.lte(0)
      ? null
      : new Decimal(summary.pricedUnrealizedPnl)
          .div(pricedPrincipal)
          .toString();
  const marketValueByInstrument = new Map(
    valued.map((position) => [
      instrumentKeyId(position.instrument),
      position.marketValue,
    ]),
  );
  const positions = snapshots
    .map((snapshot) =>
      positionView(
        snapshot,
        quotesByInstrument.get(
          instrumentKeyId(snapshot.batch.instrument),
        ) ?? null,
        formatMoney,
      ),
    )
    .toSorted((left, right) => {
      const leftValue =
        marketValueByInstrument.get(left.instrumentKey) ?? null;
      const rightValue =
        marketValueByInstrument.get(right.instrumentKey) ?? null;
      const compareByCode = () =>
        left.symbol !== right.symbol
          ? left.symbol < right.symbol
            ? -1
            : 1
          : left.instrumentKey < right.instrumentKey
            ? -1
            : left.instrumentKey > right.instrumentKey
              ? 1
              : 0;
      if (leftValue === null) {
        return rightValue === null ? compareByCode() : 1;
      }
      if (rightValue === null) {
        return -1;
      }
      const valueOrder = new Decimal(rightValue).comparedTo(leftValue);
      return valueOrder === 0 ? compareByCode() : valueOrder;
    });

  return {
    viewState: "ready",
    summaryLabel:
      hasUnpricedStocks && hasAnyAssetValue
        ? options.currency === "CNY"
          ? cash === null
            ? "人民币已定价市值"
            : "人民币已计价资产"
          : cash === null
            ? "已定价市值"
            : "已计价资产"
        : hasAnyAssetValue
          ? options.currency === "CNY"
            ? cash === null
              ? "人民币估算总市值"
              : "人民币估算总资产"
            : cash === null
              ? "估算总市值"
              : "估算总资产"
          : options.currency === "CNY"
            ? "人民币总市值待定价"
            : "总市值待定价",
    marketValue: hasAnyAssetValue
      ? formatMoney(totalPricedAssetValue.toString())
      : "—",
    openCost: formatMoney(totalRecordedPrincipal.toString()),
    stockOpenCost: formatMoney(summary.portfolioOpenCost),
    pnl: hasAnyPrice
      ? signedMoney(summary.pricedUnrealizedPnl, formatMoney)
      : cash === null
        ? "—"
        : formatMoney("0"),
    pnlLabel:
      summary.status === "PARTIAL"
        ? options.currency === "CNY"
          ? "折算已定价部分盈亏"
          : "已定价部分盈亏"
        : options.currency === "CNY"
          ? "折算浮动盈亏"
          : "浮动盈亏",
    returnRate: percent(portfolioReturn),
    pnlDirection: direction(
      hasAnyPrice ? summary.pricedUnrealizedPnl : null,
    ),
    dailyChange:
      summary.estimatedDailyPriceEffect === null
        ? "—"
        : signedMoney(
            summary.estimatedDailyPriceEffect,
            formatMoney,
          ),
    dailyChangeRate: percent(summary.estimatedDailyChangeRate),
    dailyChangeDirection: direction(
      summary.estimatedDailyPriceEffect,
    ),
    cash:
      cash === null
        ? null
        : cashView(cash, formatMoney),
    status: {
      source:
        snapshots.length === 0
          ? cash !== null && cash.accounts.length > 1
            ? "组合现金统一汇总 · 买卖自动增减"
            : "IBKR 现金为本机记录 · 利息按公开规则估算"
          : "15 分钟延迟",
    },
    positions,
  };
}
