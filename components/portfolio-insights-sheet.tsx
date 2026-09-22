"use client";
import { productionExperience } from "../application/runtime/build-target.ts";

import { useEffect, useMemo, useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { Decimal, deriveCnyAmount } from "../domain/index.ts";
import type { PortfolioCopySource } from "../ui/portfolio-copy-text.ts";
import type {
  PortfolioDailyContribution,
  PortfolioInsights,
  PortfolioStructurePosition,
} from "../ui/portfolio-insights.ts";
import { formatCny, formatUsd } from "../ui/position-preview.ts";
import {
  isolateModalSiblings,
  trapModalTabKey,
} from "./modal-accessibility.ts";
import { PortfolioAiConsultationPanel } from "./portfolio-ai-consultation-panel.tsx";

export type InsightDisplayCurrency = "USD" | "CNY";

export interface PortfolioInsightsSheetProps {
  readonly insights: PortfolioInsights;
  readonly portfolioSource?: PortfolioCopySource | null;
  readonly displayCurrency: InsightDisplayCurrency;
  readonly usdCnyRate: string | null;
  readonly cnySourceDisclosure?: string | null;
  readonly onClose: () => void;
}

const STOCK_COLORS = [
  "#1769e8",
  "#129f96",
  "#6574cf",
  "#d0912f",
  "#9568c7",
] as const;
const OTHER_STOCK_COLOR = "#c2c8d2";
const CASH_COLOR = "#929aa7";

interface AllocationSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

interface DailyChartRow {
  readonly instrumentKey: string;
  readonly symbol: string;
  readonly normalized: number | null;
  readonly color: string;
}

function percent(value: string | null, digits = 2): string {
  return value === null
    ? "—"
    : `${new Decimal(value).mul(100).toFixed(digits)}%`;
}

function displayAmount(
  valueUsd: string | null,
  currency: InsightDisplayCurrency,
  usdCnyRate: string | null,
): string {
  if (valueUsd === null) {
    return "—";
  }
  if (currency === "CNY" && usdCnyRate !== null) {
    return formatCny(deriveCnyAmount(valueUsd, usdCnyRate).cnyAmount);
  }
  return formatUsd(valueUsd);
}

function signedDisplayAmount(
  valueUsd: string | null,
  currency: InsightDisplayCurrency,
  usdCnyRate: string | null,
): string {
  if (valueUsd === null) {
    return "—";
  }
  const value = new Decimal(valueUsd);
  if (value.isZero()) {
    return displayAmount("0", currency, usdCnyRate);
  }
  return `${value.isPositive() ? "+" : "−"}${displayAmount(
    value.abs().toString(),
    currency,
    usdCnyRate,
  )}`;
}

function amountTone(value: string | null): string {
  if (value === null) {
    return "neutral";
  }
  const amount = new Decimal(value);
  if (amount.isZero()) {
    return "neutral";
  }
  return amount.isPositive()
    ? "positive"
    : amount.isNegative()
      ? "negative"
      : "neutral";
}

function dailyUnavailableLabel(
  contribution: PortfolioDailyContribution,
): string {
  return contribution.status === "MISSING_PRICE"
    ? "缺少有效估值价"
    : "缺少前一常规收盘价";
}

function compareStructurePositions(
  left: PortfolioStructurePosition,
  right: PortfolioStructurePosition,
): number {
  if (left.marketValueUsd === null) {
    return right.marketValueUsd === null ? 0 : 1;
  }
  if (right.marketValueUsd === null) {
    return -1;
  }
  return new Decimal(right.marketValueUsd).comparedTo(left.marketValueUsd);
}

function concentrationLabel(
  limit: 3 | 5,
  includedPositionCount: number | null,
): string {
  return includedPositionCount !== null && includedPositionCount < limit
    ? `Top ${limit}（实际 ${includedPositionCount} 只）`
    : `Top ${limit}`;
}

function statusLabel(
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE",
): string {
  return status === "COMPLETE"
    ? "完整"
    : status === "PARTIAL"
      ? "部分口径"
      : "暂不可用";
}

function contributionList(
  rows: readonly PortfolioDailyContribution[],
  currency: InsightDisplayCurrency,
  usdCnyRate: string | null,
  visuallyHidden = false,
) {
  return (
    <div
      className={`contribution-list${visuallyHidden ? " sr-only" : ""}`}
      role="list"
      aria-label="逐股今日盈亏贡献"
    >
      {rows.map((contribution) => (
        <div className="contribution-row" role="listitem" key={contribution.instrumentKey}>
          <div>
            <strong>{contribution.symbol}</strong>
            <span>{contribution.name}</span>
          </div>
          {contribution.amountUsd === null ? (
            <div className="contribution-row__missing">
              <strong>—</strong>
              <span>{dailyUnavailableLabel(contribution)}</span>
            </div>
          ) : (
            <div>
              <strong
                className={`numeric insight-tone--${amountTone(
                  contribution.amountUsd,
                )}`}
              >
                {signedDisplayAmount(
                  contribution.amountUsd,
                  currency,
                  usdCnyRate,
                )}
              </strong>
              <span className="numeric">
                {contribution.absoluteContributionShare === null
                  ? "占比不适用"
                  : `绝对贡献 ${percent(
                      contribution.absoluteContributionShare,
                    )}`}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function PortfolioInsightsSheet({
  insights,
  portfolioSource = null,
  displayCurrency,
  usdCnyRate,
  cnySourceDisclosure = null,
  onClose,
}: PortfolioInsightsSheetProps) {
  const dialog = useRef<HTMLElement | null>(null);
  const { structure, daily } = insights;

  const sortedStructurePositions = useMemo(
    () => structure.positions.toSorted(compareStructurePositions),
    [structure.positions],
  );
  const pricedPositions = useMemo(
    () =>
      sortedStructurePositions.filter(
        (position) =>
          position.marketValueUsd !== null && position.assetWeight !== null,
      ),
    [sortedStructurePositions],
  );
  const contributionRows = useMemo(
    () =>
      daily.contributions.toSorted((left, right) => {
        if (left.amountUsd === null) {
          return right.amountUsd === null ? 0 : 1;
        }
        if (right.amountUsd === null) {
          return -1;
        }
        return new Decimal(right.amountUsd)
          .abs()
          .comparedTo(new Decimal(left.amountUsd).abs());
      }),
    [daily.contributions],
  );

  const allocationSlices = useMemo<readonly AllocationSlice[]>(() => {
    const slices: AllocationSlice[] = pricedPositions
      .slice(0, STOCK_COLORS.length)
      .filter((position) => new Decimal(position.assetWeight ?? "0").gt(0))
      .map((position, index) => ({
        key: position.instrumentKey,
        label: position.symbol,
        value: new Decimal(position.assetWeight ?? "0").mul(100).toNumber(),
        color: STOCK_COLORS[index] ?? OTHER_STOCK_COLOR,
      }));
    const remainingWeight = pricedPositions
      .slice(STOCK_COLORS.length)
      .reduce(
        (total, position) => total.add(position.assetWeight ?? "0"),
        new Decimal(0),
      );
    if (remainingWeight.gt(0)) {
      slices.push({
        key: "OTHER_STOCKS",
        label: "其他股票",
        value: remainingWeight.mul(100).toNumber(),
        color: OTHER_STOCK_COLOR,
      });
    }
    if (
      structure.cash !== null &&
      structure.cash.assetWeight !== null &&
      new Decimal(structure.cash.assetWeight).gt(0)
    ) {
      slices.push({
        key: "USD_CASH",
        label: "USD 现金",
        value: new Decimal(structure.cash.assetWeight).mul(100).toNumber(),
        color: CASH_COLOR,
      });
    }
    return slices;
  }, [pricedPositions, structure.cash]);

  const stockWeight = useMemo(
    () =>
      pricedPositions
        .reduce(
          (total, position) => total.add(position.assetWeight ?? "0"),
          new Decimal(0),
        )
        .toString(),
    [pricedPositions],
  );
  const largestPosition = pricedPositions[0] ?? null;

  const dailyChart = useMemo(() => {
    const available = contributionRows.filter(
      (row): row is PortfolioDailyContribution & { amountUsd: string } =>
        row.amountUsd !== null,
    );
    const maxAbsolute = available.reduce(
      (largest, row) => Decimal.max(largest, new Decimal(row.amountUsd).abs()),
      new Decimal(0),
    );
    const positiveAbsolute = available.reduce(
      (total, row) =>
        new Decimal(row.amountUsd).isPositive()
          ? total.add(row.amountUsd)
          : total,
      new Decimal(0),
    );
    const negativeAbsolute = available.reduce((total, row) => {
      const amount = new Decimal(row.amountUsd);
      return amount.isNegative() ? total.add(amount.abs()) : total;
    }, new Decimal(0));
    const absoluteTotal = positiveAbsolute.add(negativeAbsolute);
    const rows: DailyChartRow[] = contributionRows.map((row) => ({
      instrumentKey: row.instrumentKey,
      symbol: row.symbol,
      normalized:
        row.amountUsd === null || maxAbsolute.isZero()
          ? null
          : new Decimal(row.amountUsd).div(maxAbsolute).toNumber(),
      color:
        row.amountUsd !== null && new Decimal(row.amountUsd).isNegative()
          ? "#17875f"
          : "#e5484d",
    }));
    return {
      rows,
      maxAbsoluteUsd: maxAbsolute.toString(),
      hasDirectionalScale: !maxAbsolute.isZero(),
      positiveShare: absoluteTotal.isZero()
        ? null
        : positiveAbsolute.div(absoluteTotal).toString(),
      negativeShare: absoluteTotal.isZero()
        ? null
        : negativeAbsolute.div(absoluteTotal).toString(),
    };
  }, [contributionRows]);

  useEffect(() => {
    const currentDialog = dialog.current;
    if (currentDialog === null) {
      return;
    }
    const releaseIsolation = isolateModalSiblings(currentDialog);
    currentDialog
      .querySelector<HTMLElement>("[data-autofocus]")
      ?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        trapModalTabKey(event, currentDialog);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      releaseIsolation();
    };
  }, [onClose]);

  const displayCurrencyLabel =
    displayCurrency === "CNY" && usdCnyRate !== null ? "CNY 估算" : "USD";
  const displayedStructureStatus =
    structure.positions.length === 0 &&
    structure.cash !== null &&
    structure.cash.assetWeight !== null
      ? "COMPLETE"
      : structure.concentration.status;
  const structureCoverage =
    structure.positions.length === 0 && structure.cash !== null
      ? "仅现金 · 完整"
      : `覆盖 ${structure.pricedPositionCount}/${structure.positions.length} 只 · ${statusLabel(
          displayedStructureStatus,
        )}`;
  const dailyCoverage = `覆盖 ${daily.calculablePositionCount}/${daily.totalPositionCount} 只 · ${statusLabel(
    daily.status,
  )}`;
  const chartHeight = dailyChart.rows.length * 54;

  const dailySection = (<section className="insight-section insight-section--daily" aria-labelledby="daily-contribution-title">
            <div className="insight-section__heading">
              <h3 id="daily-contribution-title">今日贡献</h3>
              <span>单位：{displayCurrencyLabel}</span>
            </div>
            <p
              className="insight-coverage insight-coverage--daily"
              data-status={daily.status.toLowerCase()}
            >
              {dailyCoverage}
            </p>

            <div className="insight-basis-note" aria-label="今日变化摘要">
              <p>{daily.status === "UNAVAILABLE" ? "数据不足，暂不能解释今天的组合变化。" : daily.status === "PARTIAL" ? `以下仅说明可计算的 ${daily.calculablePositionCount} 只持仓；${daily.totalPositionCount - daily.calculablePositionCount} 只缺少数据，不能据此判断完整组合净变化。` : "按当前持仓数量估算今天的变化："}</p>
              {daily.status !== "UNAVAILABLE" ? <>
                <p>最大已知正贡献：{daily.largestPositiveContributor ? `${daily.largestPositiveContributor.symbol} ${signedDisplayAmount(daily.largestPositiveContributor.amountUsd, displayCurrency, usdCnyRate)}` : "可计算持仓中暂无"}；最大已知负贡献：{daily.largestNegativeContributor ? `${daily.largestNegativeContributor.symbol} ${signedDisplayAmount(daily.largestNegativeContributor.amountUsd, displayCurrency, usdCnyRate)}` : "可计算持仓中暂无"}。</p>
                {daily.largestPositiveContributor && daily.largestNegativeContributor ? <p>正负贡献相互抵消，净额不能代表每只持仓的变化幅度。</p> : null}
              </> : null}
            </div>
            <dl className="daily-summary">
              <div>
                <dt>组合净贡献</dt>
                <dd
                  className={`numeric insight-tone--${amountTone(
                    daily.netEffectUsd,
                  )}`}
                >
                  {daily.status === "COMPLETE"
                    ? signedDisplayAmount(
                        daily.netEffectUsd,
                        displayCurrency,
                        usdCnyRate,
                      )
                    : "—"}
                </dd>
                {daily.status === "COMPLETE" ? null : (
                  <small>需全部股票可计算</small>
                )}
              </div>
              <div>
                <dt>
                  {daily.status === "PARTIAL" ? "子集涨跌贡献" : "涨跌贡献比例"}
                </dt>
                <dd className="daily-summary__split numeric">
                  <span className="insight-tone--positive">
                    {percent(dailyChart.positiveShare, 1)}
                  </span>
                  <span aria-hidden="true">/</span>
                  <span className="insight-tone--negative">
                    {percent(dailyChart.negativeShare, 1)}
                  </span>
                </dd>
              </div>
            </dl>

            {dailyChart.hasDirectionalScale ? (
              <figure
                className="daily-chart"
                role="img"
                aria-labelledby="daily-chart-caption"
              >
                <div className="daily-chart__head" aria-hidden="true">
                  <span>标的</span>
                  <span>贡献幅度</span>
                  <span>贡献</span>
                </div>
                <div className="daily-chart__matrix" aria-hidden="true">
                  <div className="daily-chart__identities">
                    {contributionRows.map((row) => (
                      <div key={row.instrumentKey}>
                        <strong>{row.symbol}</strong>
                        <span>{row.name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="daily-chart__plot">
                    <BarChart
                      responsive
                      accessibilityLayer={false}
                      data={dailyChart.rows}
                      layout="vertical"
                      barCategoryGap="32%"
                      margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                      style={{ width: "100%", height: chartHeight }}
                    >
                      <CartesianGrid
                        horizontal={false}
                        stroke="#e3e7ed"
                        strokeDasharray="2 5"
                      />
                      <XAxis
                        type="number"
                        domain={[-1, 1]}
                        ticks={[-1, -0.5, 0, 0.5, 1]}
                        hide
                      />
                      <YAxis type="category" dataKey="symbol" hide />
                      <ReferenceLine x={0} stroke="#9aa4b2" strokeWidth={1.2} />
                      <Bar dataKey="normalized" barSize={14} isAnimationActive={false}>
                        {dailyChart.rows.map((row) => (
                          <Cell key={row.instrumentKey} fill={row.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </div>
                  <div className="daily-chart__metrics">
                    {contributionRows.map((row) => (
                      <div key={row.instrumentKey}>
                        <strong
                          className={`numeric insight-tone--${amountTone(
                            row.amountUsd,
                          )}`}
                        >
                          {signedDisplayAmount(
                            row.amountUsd,
                            displayCurrency,
                            usdCnyRate,
                          )}
                        </strong>
                        <span className="numeric">
                          {row.amountUsd === null
                            ? dailyUnavailableLabel(row)
                            : row.absoluteContributionShare === null
                              ? "占比不适用"
                              : percent(row.absoluteContributionShare)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="daily-chart__axis" aria-hidden="true">
                  <div>
                    <span>
                      −{displayAmount(
                        dailyChart.maxAbsoluteUsd,
                        displayCurrency,
                        usdCnyRate,
                      )}
                    </span>
                    <span>0</span>
                    <span>
                      +{displayAmount(
                        dailyChart.maxAbsoluteUsd,
                        displayCurrency,
                        usdCnyRate,
                      )}
                    </span>
                  </div>
                </div>
                <div className="daily-chart__legend" aria-hidden="true">
                  <span><i data-tone="negative" />负贡献</span>
                  <span><i data-tone="positive" />正贡献</span>
                </div>
                <figcaption id="daily-chart-caption" className="sr-only">
                  今日贡献零轴图。{contributionRows
                    .filter((row) => row.amountUsd !== null)
                    .map(
                      (row) =>
                        `${row.symbol} ${signedDisplayAmount(
                          row.amountUsd,
                          displayCurrency,
                          usdCnyRate,
                        )}，绝对贡献 ${percent(
                          row.absoluteContributionShare,
                        )}`,
                    )
                    .join("；")}
                </figcaption>
              </figure>
            ) : (
              <div className="insight-empty-state insight-empty-state--daily">
                <strong>
                  {daily.shareBasis === "ZERO_ABSOLUTE_EFFECT"
                    ? "今日绝对变化为 0"
                    : "今日贡献暂不可用"}
                </strong>
                <p>
                  {daily.shareBasis === "ZERO_ABSOLUTE_EFFECT"
                    ? "净额仍可为 0，但没有可分配的绝对贡献占比。"
                    : "当前没有股票同时具备估值价与前一常规收盘价。"}
                </p>
              </div>
            )}

            {contributionList(
              contributionRows,
              displayCurrency,
              usdCnyRate,
              dailyChart.hasDirectionalScale,
            )}
            <p className="insight-basis-note insight-basis-note--method">
              估值基于当前数量 ×（估值价 − 前一常规收盘价），可能与今日交易口径的实际盈亏不同。绝对贡献占比使用可计算股票的绝对变化总量，现金不参与。
            </p>
          </section>);
  const structureSection = (<section className="insight-section insight-section--structure" aria-labelledby="structure-title">
            <div className="insight-section__heading">
              <h3 id="structure-title">组合结构</h3>
              <span
                className="insight-coverage"
                data-status={displayedStructureStatus.toLowerCase()}
              >
                {structureCoverage}
              </span>
            </div>

            {allocationSlices.length > 0 ? (
              <figure
                className="allocation-chart"
                role="img"
                aria-labelledby="allocation-chart-caption"
              >
                <div className="allocation-chart__plot" aria-hidden="true">
                  <PieChart
                    responsive
                    accessibilityLayer={false}
                    style={{ width: "100%", height: "100%" }}
                  >
                    <Pie
                      data={allocationSlices}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius="58%"
                      outerRadius="88%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="#ffffff"
                      strokeWidth={2}
                      isAnimationActive={false}
                      rootTabIndex={-1}
                    >
                      {allocationSlices.map((slice) => (
                        <Cell key={slice.key} fill={slice.color} />
                      ))}
                    </Pie>
                  </PieChart>
                  <div className="allocation-chart__center">
                    <span>{largestPosition === null ? "资产结构" : "最大单股"}</span>
                    <strong className="numeric">
                      {largestPosition === null
                        ? structure.cash === null
                          ? "—"
                          : percent(structure.cash.assetWeight, 1)
                        : percent(largestPosition.assetWeight, 1)}
                    </strong>
                    <p>
                      {largestPosition === null
                        ? structure.cash === null
                          ? "暂无可计价资产"
                          : "当前可计价资产为 USD 现金"
                        : `${largestPosition.symbol} 占比最高`}
                    </p>
                  </div>
                </div>
                <figcaption id="allocation-chart-caption" className="sr-only">
                  组合仓位环图。
                  {[
                    ...pricedPositions.map(
                      (position) =>
                        `${position.symbol} ${percent(position.assetWeight)}`,
                    ),
                    ...(structure.cash === null
                      ? []
                      : [`USD 现金 ${percent(structure.cash.assetWeight)}`]),
                  ].join("，")}
                </figcaption>
              </figure>
            ) : (
              <div className="insight-empty-state">
                <strong>结构暂不可用</strong>
                <p>没有可用股票价格或现金，无法形成仓位分母。</p>
              </div>
            )}

            <div className="allocation-list" role="list" aria-label="资产仓位结构">
              {sortedStructurePositions.map((position) => {
                const pricedIndex = pricedPositions.findIndex(
                  (priced) => priced.instrumentKey === position.instrumentKey,
                );
                const color =
                  pricedIndex < 0
                    ? OTHER_STOCK_COLOR
                    : STOCK_COLORS[pricedIndex] ?? OTHER_STOCK_COLOR;
                return (
                  <div className="allocation-row" role="listitem" key={position.instrumentKey}>
                    <span
                      className="allocation-row__swatch"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <div className="allocation-row__identity">
                      <strong>{position.symbol}</strong>
                      <span>{position.name}</span>
                    </div>
                    <div className="allocation-row__metrics">
                      <strong className="numeric">{percent(position.assetWeight)}</strong>
                      <span className="numeric">
                        {position.marketValueUsd === null
                          ? "未计价"
                          : displayAmount(
                              position.marketValueUsd,
                              displayCurrency,
                              usdCnyRate,
                            )}
                      </span>
                    </div>
                  </div>
                );
              })}
              {structure.cash !== null ? (
                <div className="allocation-row" role="listitem">
                  <span
                    className="allocation-row__swatch"
                    style={{ backgroundColor: CASH_COLOR }}
                    aria-hidden="true"
                  />
                  <div className="allocation-row__identity">
                    <strong>USD 现金</strong>
                    <span>IBKR 现金本金</span>
                  </div>
                  <div className="allocation-row__metrics">
                    <strong className="numeric">{percent(structure.cash.assetWeight)}</strong>
                    <span className="numeric">
                      {displayAmount(
                        structure.cash.balanceUsd,
                        displayCurrency,
                        usdCnyRate,
                      )}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            {pricedPositions.length > STOCK_COLORS.length ? (
              <p className="insight-basis-note">
                环图将第 6 名起的 {pricedPositions.length - STOCK_COLORS.length} 只股票合并为“其他股票”，明细仍逐只列出。
              </p>
            ) : null}
            <p className="insight-basis-note">
              {structure.weightBasis === "PRICED_ASSETS"
                ? `${structure.unpricedPositionCount} 只股票缺价，未进入分母；其成本没有被当成市值。`
                : structure.weightBasis === "UNAVAILABLE"
                  ? "缺少可用分母，仓位占比不可计算。"
                  : "仓位占比基于未舍入的已定价股票市值与现金本金。"}
            </p>

            <dl className="allocation-summary">
              <div>
                <dt>Top 1（最大单股）</dt>
                <dd className="numeric">
                  {percent(structure.concentration.top1?.assetWeight ?? null)}
                </dd>
              </div>
              <div>
                <dt>
                  {structure.weightBasis === "PRICED_ASSETS"
                    ? "已计价股票合计"
                    : "股票合计（不含现金）"}
                </dt>
                <dd className="numeric">
                  {structure.weightBasis === "UNAVAILABLE"
                    ? "—"
                    : percent(stockWeight)}
                </dd>
              </div>
            </dl>
            <dl className="concentration-ladder" aria-label="集中度阶梯">
              <div>
                <dt>
                  {concentrationLabel(
                    3,
                    structure.concentration.top3?.includedPositionCount ?? null,
                  )}
                </dt>
                <dd className="numeric">
                  {percent(structure.concentration.top3?.assetWeight ?? null)}
                </dd>
              </div>
              <div>
                <dt>
                  {concentrationLabel(
                    5,
                    structure.concentration.top5?.includedPositionCount ?? null,
                  )}
                </dt>
                <dd className="numeric">
                  {percent(structure.concentration.top5?.assetWeight ?? null)}
                </dd>
              </div>
            </dl>
          </section>);
  const aiSection = (portfolioSource !== null ? (
            <PortfolioAiConsultationPanel
              insights={insights}
              portfolioSource={portfolioSource}
              displayCurrency={displayCurrency}
              usdCnyRate={usdCnyRate}
            />
          ) : null);

  return (
    <div
      className="action-sheet-backdrop portfolio-insights-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="action-sheet portfolio-insights-sheet"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-insights-title"
      >
        <header className="portfolio-insights-sheet__header">
          <div>
            <p>估值货币 · {displayCurrencyLabel}</p>
            <h2 id="portfolio-insights-title">组合分析</h2>
          </div>
          <button
            className="portfolio-insights-sheet__close"
            type="button"
            data-autofocus
            aria-label="关闭组合分析"
            onClick={onClose}
          >
            完成
          </button>
        </header>

        <div className="portfolio-insights-sheet__body">
          {displayCurrency === "CNY" &&
          usdCnyRate !== null &&
          cnySourceDisclosure !== null ? (
            <p className="portfolio-insights-sheet__fx-note">
              {cnySourceDisclosure}
            </p>
          ) : null}

          {productionExperience() ? <>{aiSection}{structureSection}{dailySection}</> : <>{dailySection}{structureSection}{aiSection}</>}

        </div>
      </section>
    </div>
  );
}
