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
  instrumentKeyId,
  summarizePortfolio,
  valuePosition,
  type PortfolioSummary,
  type ResolvedQuote,
  type ValuedPosition,
} from "../domain/index.ts";
import { formatQuantity, formatUsd } from "./position-preview.ts";

const CopyDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
});

export type PortfolioCopyScope =
  | { readonly kind: "all" }
  | { readonly kind: "top"; readonly limit: 5 | 10 }
  | { readonly kind: "single"; readonly instrumentKey: string };

export type PortfolioCopyTarget = "clipboard" | "chatgpt";

export interface PortfolioCopyPosition {
  readonly instrumentKey: string;
  readonly name: string;
  readonly marketRank: number | null;
  readonly value: ValuedPosition;
}

export interface PortfolioCopySource {
  readonly positions: readonly PortfolioCopyPosition[];
  readonly summary: PortfolioSummary;
  readonly cash: PortfolioCashSource | null;
}

export interface PortfolioCopyOutcome {
  readonly delivery: "copied" | "manual-fallback";
  readonly text: string;
  readonly positionCount: number;
}

function comparePositions(
  left: Omit<PortfolioCopyPosition, "marketRank">,
  right: Omit<PortfolioCopyPosition, "marketRank">,
): number {
  const compareByCode = () => {
    const leftSymbol = left.value.instrument.symbol;
    const rightSymbol = right.value.instrument.symbol;
    if (leftSymbol !== rightSymbol) {
      return leftSymbol < rightSymbol ? -1 : 1;
    }
    return left.instrumentKey < right.instrumentKey
      ? -1
      : left.instrumentKey > right.instrumentKey
        ? 1
        : 0;
  };
  if (left.value.marketValue === null) {
    return right.value.marketValue === null
      ? compareByCode()
      : 1;
  }
  if (right.value.marketValue === null) {
    return -1;
  }
  const marketValueOrder = new CopyDecimal(right.value.marketValue).comparedTo(
    left.value.marketValue,
  );
  return marketValueOrder === 0
    ? compareByCode()
    : marketValueOrder;
}

export function createPortfolioCopySource(
  snapshots: readonly PositionSnapshot[],
  quotes: readonly ResolvedQuote[],
  cashInput: PortfolioCashInput = null,
): PortfolioCopySource {
  const cash = normalizePortfolioCashInput(cashInput);
  const quotesByInstrument = new Map(
    quotes.map((quote) => [instrumentKeyId(quote.instrument), quote]),
  );
  const values = snapshots.map((snapshot) => {
    const [position] = aggregatePositionInputs(snapshot.batch.inputs);
    if (position === undefined) {
      throw new Error("a committed position batch must not be empty");
    }
    const key = instrumentKeyId(position.instrument);
    return {
      instrumentKey: key,
      name: snapshot.batch.displayName ?? position.instrument.symbol,
      value: valuePosition(position, quotesByInstrument.get(key) ?? null),
    };
  });
  const positions = values
    .toSorted(comparePositions)
    .map(
      (position, index): PortfolioCopyPosition => ({
        ...position,
        marketRank:
          position.value.marketValue === null ? null : index + 1,
      }),
    );
  return {
    positions,
    summary: summarizePortfolio(values.map((position) => position.value)),
    cash,
  };
}

function selection(
  source: PortfolioCopySource,
  scope: PortfolioCopyScope,
): readonly PortfolioCopyPosition[] {
  if (scope.kind === "all") {
    return source.positions;
  }
  if (scope.kind === "top") {
    return source.positions.slice(0, scope.limit);
  }
  const selected = source.positions.find(
    (position) => position.instrumentKey === scope.instrumentKey,
  );
  if (selected === undefined) {
    throw new Error(`portfolio copy position not found: ${scope.instrumentKey}`);
  }
  return [selected];
}

export function portfolioCopySelectionCount(
  source: PortfolioCopySource,
  scope: PortfolioCopyScope,
): number {
  return selection(source, scope).length;
}

function scopeLabel(
  source: PortfolioCopySource,
  scope: PortfolioCopyScope,
  positions: readonly PortfolioCopyPosition[],
): string {
  if (scope.kind === "all") {
    return source.cash === null
      ? `全部持仓（${positions.length} 只）`
      : source.cash.accounts.length === 1 &&
          source.cash.accounts[0]?.broker === "IBKR"
        ? `全部资产（${positions.length} 只股票 + IBKR 现金）`
        : `全部资产（${positions.length} 只股票 + ${source.cash.accounts.length} 个现金账户）`;
  }
  if (scope.kind === "top") {
    return `前 ${scope.limit} 大持仓`;
  }
  return `单只持仓：${positions[0]?.value.instrument.symbol ?? ""}`;
}

function signedUsd(value: string): string {
  const decimal = new CopyDecimal(value);
  if (decimal.isZero()) {
    return formatUsd("0");
  }
  const sign = decimal.isPositive() ? "+" : "−";
  return `${sign}${formatUsd(decimal.abs().toString())}`;
}

function percent(value: string | null, signed: boolean): string {
  if (value === null) {
    return "无法计算";
  }
  const decimal = new CopyDecimal(value).mul(100);
  const sign = signed
    ? decimal.isZero()
      ? ""
      : decimal.isPositive()
      ? "+"
      : "−"
    : "";
  return `${sign}${decimal.abs().toFixed(2)}%`;
}

function pricedPositionCount(summary: PortfolioSummary): number {
  return summary.openPositionCount - summary.unpricedPositionCount;
}

function cashBalance(source: PortfolioCopySource): Decimal {
  return new CopyDecimal(source.cash?.totalBalance ?? "0");
}

function totalPricedAssets(source: PortfolioCopySource): Decimal {
  return new CopyDecimal(source.summary.pricedMarketValue).add(
    cashBalance(source),
  );
}

function portfolioWeight(
  position: PortfolioCopyPosition,
  source: PortfolioCopySource,
): string | null {
  const denominator = totalPricedAssets(source);
  if (
    position.value.marketValue === null ||
    denominator.isZero()
  ) {
    return null;
  }
  return new CopyDecimal(position.value.marketValue)
    .div(denominator)
    .toString();
}

function selectedCoverage(
  positions: readonly PortfolioCopyPosition[],
  source: PortfolioCopySource,
): string | null {
  const denominator = totalPricedAssets(source);
  if (denominator.isZero()) {
    return null;
  }
  const selectedValue = positions.reduce(
    (total, position) =>
      position.value.marketValue === null
        ? total
        : total.add(position.value.marketValue),
    new CopyDecimal(0),
  );
  return selectedValue.div(denominator).toString();
}

function weightLabel(source: PortfolioCopySource): string {
  if (source.summary.unpricedPositionCount === 0) {
    return source.cash === null ? "占总市值" : "占总资产";
  }
  return source.cash === null ? "占已定价市值" : "占已计价资产";
}

function cashWeight(source: PortfolioCopySource): string | null {
  if (source.cash === null) {
    return null;
  }
  const denominator = totalPricedAssets(source);
  if (denominator.isZero()) {
    return null;
  }
  return cashBalance(source).div(denominator).toString();
}

function summaryLines(source: PortfolioCopySource): string[] {
  const { summary } = source;
  const pricedCount = pricedPositionCount(summary);
  const hasValue = pricedCount > 0 || source.cash !== null;
  const marketValueLabel =
    summary.unpricedPositionCount === 0
      ? source.cash === null
        ? "估算总市值"
        : "估算总资产"
      : source.cash === null
        ? "已定价市值"
        : "已计价资产";
  const lines = [
    "【组合】",
    `${marketValueLabel}：${
      hasValue ? formatUsd(totalPricedAssets(source).toString()) : "暂无有效价格"
    }`,
  ];

  if (summary.openPositionCount === 0) {
    lines.push("股票：0 只");
  } else if (pricedCount === 0) {
    lines.push(`股票：${summary.openPositionCount} 只（已定价 0）`);
  } else {
    const stockValue = source.cash === null
      ? ""
      : `；${summary.unpricedPositionCount === 0 ? "市值" : "已定价市值"} ${formatUsd(
          summary.pricedMarketValue,
        )}`;
    lines.push(
      `股票：${summary.openPositionCount} 只（已定价 ${pricedCount}）${stockValue}；${
        summary.unpricedPositionCount === 0 ? "成本" : "已定价成本"
      } ${formatUsd(summary.pricedOpenCost)}；浮动盈亏 ${signedUsd(
        summary.pricedUnrealizedPnl,
      )}`,
    );
  }

  if (summary.unpricedPositionCount > 0) {
    lines.push(
      `未定价：${summary.unpricedPositionCount} 只；成本 ${formatUsd(
        summary.unpricedOpenCost,
      )}（未计入资产与盈亏）`,
    );
  }

  if (source.cash !== null) {
    const cashLabel =
      source.cash.accounts.length === 1 &&
      source.cash.accounts[0]?.broker === "IBKR"
        ? "IBKR USD"
        : "USD";
    lines.push(
      `现金：${cashLabel} ${formatUsd(source.cash.totalBalance)}（${weightLabel(
        source,
      )} ${percent(cashWeight(source), false)}）`,
    );
    for (const account of source.cash.accounts) {
      const pending = new CopyDecimal(account.pendingBalance);
      lines.push(
        `- ${account.broker}：${formatUsd(account.balance)}（已结算 ${formatUsd(
          account.settledBalance,
        )}${pending.isZero() ? "" : `；待结算 ${signedUsd(account.pendingBalance)}`}）`,
      );
    }
  }
  return lines;
}

function cashLines(source: PortfolioCopySource): string[] {
  if (source.cash === null) {
    return [];
  }
  const interest = source.cash.ibkrInterest;
  if (interest === null) {
    return [
      "【现金说明】",
      "IBKR 正已结算现金或利息参数尚未完整，当前不生成利息估算；moomoo 现金不套用 IBKR 利率。",
    ];
  }
  const { snapshot, estimate } = interest;
  return [
      "【IBKR 现金】",
      `方案 / NAV：${
        snapshot.account.pricingPlan === "IBKR_PRO" ? "IBKR Pro" : "IBKR Lite"
      }；${formatUsd(snapshot.account.netAssetValue)}${
        snapshot.account.navSource === "CASH_BALANCE_FALLBACK"
          ? "（未填写 NAV，暂按已结算现金估算）"
          : "（用户填写）"
      }`,
      `利息口径：计息余额 ${formatUsd(
        estimate.interestBearingBalance,
      )}；档位年利率 ${percent(
        estimate.publishedAnnualRate,
        false,
      )} → NAV 调整后 ${percent(
        estimate.navAdjustedAnnualRate,
        false,
      )}；${source.cash.mode === "LEGACY" ? "整笔现金年化" : "整笔已结算现金年化"} ${percent(estimate.blendedAnnualRate, false)}`,
      `利息估算：年 ${signedUsd(
        estimate.estimatedAnnualInterest,
      )}；月均 ${signedUsd(
        estimate.estimatedMonthlyInterest,
      )}；${source.cash.mode === "LEGACY" ? "" : "待结算款不参与；"}首 ${formatUsd(
        IBKR_USD_INTEREST_POLICY.interestFreeBalance,
      )} 不计息；利率 ${IBKR_USD_INTEREST_POLICY.verifiedAt} 核验且可变，实际以 IBKR 结算为准。`,
    ];
}

function tableCell(value: string): string {
  return value.replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}

function priceCell(position: PortfolioCopyPosition): string {
  const { value } = position;
  if (value.valuationPrice === null || value.marketValue === null) {
    return "暂无有效价格";
  }
  const markers = [
    value.quote?.usedLastValid === true ? "*" : "",
    value.quote?.sourcePriceType === "INDICATIVE_TRADE" ? "†" : "",
  ].join("");
  return `${formatUsd(value.valuationPrice)}${markers}`;
}

function positionRow(
  position: PortfolioCopyPosition,
  source: PortfolioCopySource,
): string {
  const { value } = position;
  const weight = portfolioWeight(position, source);
  const pricedCount = pricedPositionCount(source.summary);
  const isPriced = value.marketValue !== null && value.valuationPrice !== null;
  const cells = [
    position.marketRank === null
      ? "无法计算"
      : `${position.marketRank}/${pricedCount}`,
    `${value.instrument.symbol} · ${tableCell(position.name)}`,
    formatQuantity(value.quantity),
    formatUsd(value.averageCost),
    priceCell(position),
    isPriced ? formatUsd(value.marketValue ?? "0") : "无法计算",
    isPriced ? signedUsd(value.unrealizedPnl ?? "0") : "无法计算",
    isPriced ? percent(value.unrealizedReturn, true) : "无法计算",
    isPriced ? percent(weight, false) : "无法计算",
  ];
  return `| ${cells.join(" | ")} |`;
}

function utcMinuteTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
}

function quoteTimeRange(
  positions: readonly PortfolioCopyPosition[],
): string {
  const pricedPositions = positions.filter(
    (position) => position.value.marketValue !== null,
  );
  if (pricedPositions.length === 0) {
    return "暂无有效价格";
  }
  const times = pricedPositions
    .map((position) => position.value.quote?.sourceEventAt ?? null)
    .map((timestamp) =>
      timestamp === null ? null : utcMinuteTimestamp(timestamp),
    )
    .filter((timestamp): timestamp is string => timestamp !== null)
    .toSorted();
  if (times.length === 0) {
    return "价格时间未知";
  }
  const first = times[0] ?? "";
  const last = times.at(-1) ?? first;
  const range = first === last ? first : `${first}–${last}`;
  return times.length < pricedPositions.length
    ? `价格时间 ${range}（部分未知）`
    : `价格时间 ${range}`;
}

function selectedSummaryLine(
  positions: readonly PortfolioCopyPosition[],
  source: PortfolioCopySource,
): string {
  const priced = positions.filter(
    (position) => position.value.marketValue !== null,
  );
  const marketValue = priced.reduce(
    (total, position) => total.add(position.value.marketValue ?? "0"),
    new CopyDecimal(0),
  );
  const valueLabel = priced.length === positions.length ? "市值" : "已定价市值";
  const parts = [
    `本范围：${positions.length} 只`,
    priced.length === 0
      ? "暂无有效价格"
      : `${valueLabel} ${formatUsd(marketValue.toString())}`,
    `${weightLabel(source)} ${percent(
      priced.length === 0 ? null : selectedCoverage(positions, source),
      false,
    )}`,
  ];
  if (priced.length < positions.length) {
    parts.push(`${positions.length - priced.length} 只缺价`);
  }
  return parts.join("；");
}

export function createPortfolioCopyText(
  source: PortfolioCopySource,
  scope: PortfolioCopyScope,
  copiedAt: string = new Date().toISOString(),
): string {
  const selected = selection(source, scope);
  const copiedAtUtc = utcMinuteTimestamp(copiedAt);
  if (copiedAtUtc === null) {
    throw new Error("portfolio copy time must be a valid timestamp");
  }
  const lines = [
    "持仓资料（USD）",
    `范围：${scopeLabel(source, scope, selected)}`,
    `资料生成：${copiedAtUtc}`,
  ];
  if (source.positions.length > 0) {
    lines.push(
      `行情：Alpaca 延迟约 15 分钟，非实时；${quoteTimeRange(
        source.positions,
      )}；休市或故障时可能使用最后有效价。`,
    );
  }
  lines.push("", ...summaryLines(source));

  if (scope.kind === "top") {
    lines.push(selectedSummaryLine(selected, source));
  }

  if (scope.kind === "all" && source.cash !== null) {
    lines.push("", ...cashLines(source));
  }

  lines.push(
    "",
    scope.kind === "single" ? "【持仓】" : "【持仓（按市值降序）】",
  );
  if (selected.length === 0) {
    lines.push("暂无股票持仓。");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `| 排名 | 标的 | 数量（股） | 均价 | 现价 | 市值 | 盈亏 | 收益率 | ${weightLabel(
      source,
    )} |`,
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...selected.map((position) => positionRow(position, source)),
  );
  if (selected.some((position) => position.value.quote?.usedLastValid)) {
    lines.push("* 现价为上一有效价。");
  }
  if (
    selected.some(
      (position) =>
        position.value.quote?.sourcePriceType === "INDICATIVE_TRADE",
    )
  ) {
    lines.push("† 现价为隔夜指示价。");
  }
  return `${lines.join("\n")}\n`;
}
