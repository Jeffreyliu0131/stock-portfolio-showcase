"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Decimal } from "../domain/decimal.ts";
import { deriveCnyAmount } from "../domain/fx.ts";
import type {
  HistoricalReturnResult,
  PortfolioTrendRange,
} from "../domain/portfolio-history.ts";
import type { PortfolioTrendResult } from "../domain/portfolio-trend.ts";
import { formatCny, formatUsd } from "../ui/financial-format.ts";

const PortfolioTrendPlot = lazy(async () => {
  const module = await import("./portfolio-trend-plot.tsx");
  return { default: module.PortfolioTrendPlot };
});

type DisplayCurrency = "USD" | "CNY";
type Direction = "positive" | "negative" | "neutral";

export interface PortfolioTrendChartProps {
  readonly trend: PortfolioTrendResult | HistoricalReturnResult | null;
  readonly range?: PortfolioTrendRange;
  readonly isLoading: boolean;
  readonly displayCurrency: DisplayCurrency;
  readonly usdCnyRate: string | null;
  readonly direction: Direction;
  readonly hasStocks: boolean;
}

interface RenderPoint {
  readonly sourceEventAt: string;
  readonly timeValue: number;
  readonly lineValue: number | null;
  readonly plottedValue: number;
  readonly changeUsd: string;
  readonly changeRate: string;
  readonly assetUsd: string;
  readonly connectFromPrevious: boolean;
  readonly segment: "SIP_HISTORY" | "OVERNIGHT_CURRENT" | "ACCOUNT_HISTORY";
}

const NEW_YORK_TIME = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function displayAmount(
  usd: string,
  currency: DisplayCurrency,
  usdCnyRate: string | null,
): string {
  if (currency === "CNY" && usdCnyRate !== null) {
    return formatCny(deriveCnyAmount(usd, usdCnyRate).cnyAmount);
  }
  return formatUsd(usd);
}

function signedAmount(
  usd: string,
  currency: DisplayCurrency,
  usdCnyRate: string | null,
): string {
  const value = new Decimal(usd);
  if (value.isZero()) {
    return displayAmount("0", currency, usdCnyRate);
  }
  return `${value.isPositive() ? "+" : "−"}${displayAmount(
    value.abs().toString(),
    currency,
    usdCnyRate,
  )}`;
}

function percent(value: string): string {
  const rate = new Decimal(value).mul(100);
  if (rate.isZero()) {
    return "0.00%";
  }
  return `${rate.isPositive() ? "+" : "−"}${rate.abs().toFixed(2)}%`;
}

function pointTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${NEW_YORK_TIME.format(date)} ET`;
}

function pointDate(value: string, range: PortfolioTrendRange): string {
  if (range === "1D") {
    return pointTime(value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: range === "1Y" || range === "ALL" ? "numeric" : undefined,
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function unavailableMessage(reason: string | undefined): string {
  if (reason === "MISSING_REFERENCE_CLOSE") {
    return "缺少前一常规收盘价，今日走势暂不可用";
  }
  if (reason === "MISSING_SERIES") {
    return "部分股票缺少当日行情，今日走势暂不可用";
  }
  if (reason === "INSUFFICIENT_POINTS") {
    return "当日有效时点不足，暂不绘制走势";
  }
  if (reason === "NO_HISTORY" || reason === "INSUFFICIENT_NAV") {
    return "真实 NAV 点不足，暂不能计算这个周期";
  }
  if (reason === "UNKNOWN_EXTERNAL_FLOW") {
    return "存在未分类现金流，暂不能计算收益";
  }
  if (reason === "INVALID_DIETZ_DENOMINATOR") {
    return "该区间无法形成有效收益分母";
  }
  if (reason === "NO_POINTS_IN_RANGE") {
    return "这个周期内还没有历史 NAV";
  }
  return "今日走势暂不可用";
}

export function PortfolioTrendChart({
  trend,
  range = "1D",
  isLoading,
  displayCurrency,
  usdCnyRate,
  direction,
  hasStocks,
}: PortfolioTrendChartProps) {
  const currentReady =
    range === "1D" && trend?.status === "READY" && !("basis" in trend)
      ? trend
      : null;
  const historicalReady =
    range !== "1D" &&
    trend !== null &&
    "basis" in trend &&
    (trend.status === "READY" || trend.status === "PARTIAL")
      ? trend
      : null;
  const renderPoints = useMemo<readonly RenderPoint[]>(
    () => {
      if (currentReady !== null) {
        return currentReady.points.map((point) => ({
          sourceEventAt: point.sourceEventAt,
          timeValue: new Date(point.sourceEventAt).getTime(),
          lineValue:
            point.segment === "SIP_HISTORY"
              ? Number(point.estimatedDailyPriceEffect)
              : null,
          plottedValue: Number(point.estimatedDailyPriceEffect),
          changeUsd: point.estimatedDailyPriceEffect,
          changeRate: point.estimatedDailyChangeRate,
          assetUsd: point.estimatedAsset,
          connectFromPrevious: point.connectFromPrevious,
          segment: point.segment,
        }));
      }
      return historicalReady?.points.map((point) => ({
        sourceEventAt: point.sourceEventAt,
        timeValue: new Date(point.sourceEventAt).getTime(),
        lineValue: Number(point.flowAdjustedChange),
        plottedValue: Number(point.flowAdjustedChange),
        changeUsd: point.flowAdjustedChange,
        changeRate: point.returnRate,
        assetUsd: point.actualNav,
        connectFromPrevious: point.connectFromPrevious,
        segment: "ACCOUNT_HISTORY" as const,
      })) ?? [];
    },
    [currentReady, historicalReady],
  );
  const chartPoints = useMemo<readonly RenderPoint[]>(() => {
    const values: RenderPoint[] = [];
    for (const [index, point] of renderPoints.entries()) {
      if (index > 0 && !point.connectFromPrevious) {
        const previous = renderPoints[index - 1];
        values.push({
          ...point,
          sourceEventAt: `${point.sourceEventAt}:gap`,
          timeValue:
            previous === undefined
              ? point.timeValue - 1
              : Math.max(previous.timeValue + 1, point.timeValue - 1),
          lineValue: null,
        });
      }
      values.push(point);
    }
    return values;
  }, [renderPoints]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isInspecting, setIsInspecting] = useState(false);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const scrubbing = useRef(false);

  useEffect(() => {
    setSelectedIndex(Math.max(0, renderPoints.length - 1));
  }, [renderPoints.length, currentReady?.points, historicalReady?.points]);

  const selected = renderPoints[selectedIndex] ?? null;
  const yDomain = useMemo<[number, number]>(() => {
    const values = renderPoints
      .map((point) => point.plottedValue)
      .filter(Number.isFinite);
    if (values.length === 0) {
      return [-1, 1];
    }
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    const span = Math.max(maximum - minimum, Math.abs(maximum), Math.abs(minimum), 1);
    const padding = span * 0.12;
    return [minimum - padding, maximum + padding];
  }, [renderPoints]);

  const chartColor =
    direction === "negative"
      ? "var(--portfolio-chart-loss)"
      : direction === "positive"
        ? "var(--portfolio-chart-gain)"
        : "var(--portfolio-chart-neutral)";

  const selectFromClientX = (clientX: number, element: HTMLElement) => {
    if (renderPoints.length === 0) {
      return;
    }
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    setSelectedIndex(Math.round(ratio * (renderPoints.length - 1)));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    scrubbing.current = false;
    setIsInspecting(true);
    selectFromClientX(event.clientX, event.currentTarget);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = pointerOrigin.current;
    if (origin === null) {
      return;
    }
    const deltaX = Math.abs(event.clientX - origin.x);
    const deltaY = Math.abs(event.clientY - origin.y);
    if (!scrubbing.current && deltaX > 8 && deltaX > deltaY) {
      scrubbing.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (scrubbing.current) {
      event.preventDefault();
      selectFromClientX(event.clientX, event.currentTarget);
    }
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerOrigin.current = null;
    scrubbing.current = false;
    setIsInspecting(false);
    setSelectedIndex(Math.max(0, renderPoints.length - 1));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (renderPoints.length === 0) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setIsInspecting(true);
      setSelectedIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setIsInspecting(true);
      setSelectedIndex((current) => Math.min(renderPoints.length - 1, current + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setIsInspecting(true);
      setSelectedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setIsInspecting(true);
      setSelectedIndex(renderPoints.length - 1);
    }
  };

  if (range === "1D" && !hasStocks) {
    return (
      <div className="portfolio-trend portfolio-trend--empty" role="status">
        <strong>现金不参与今日走势</strong>
        <span>录入股票后显示按当前股数估算的价格影响线</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="portfolio-trend portfolio-trend--loading"
        aria-label={`正在载入 ${range} 走势`}
        aria-busy="true"
      >
        <span className="portfolio-trend__skeleton" />
      </div>
    );
  }

  if (
    (currentReady === null && historicalReady === null) ||
    renderPoints.length < 2
  ) {
    const reason = trend?.status === "UNAVAILABLE" ? trend.reason : undefined;
    return (
      <div className="portfolio-trend portfolio-trend--empty" role="status">
        <strong>{unavailableMessage(reason)}</strong>
        <span>
          {range === "1D"
            ? "总资产与当前盈亏仍按最后有效行情显示"
            : "可到“收益历史与交易记录”导入月结单或继续积累 NAV"}
        </span>
      </div>
    );
  }

  const selectedLabel = selected === null
    ? `${range} 走势`
    : `${pointDate(selected.sourceEventAt, range)}，${
        range === "1D" ? "估算资产" : "账户 NAV"
      } ${displayAmount(
        selected.assetUsd,
        displayCurrency,
        usdCnyRate,
      )}，${range === "1D" ? "今日盈亏" : "现金流调整收益"} ${signedAmount(
        selected.changeUsd,
        displayCurrency,
        usdCnyRate,
      )}，收益率 ${percent(selected.changeRate)}`;

  return (
    <div className="portfolio-trend">
      <div className="portfolio-trend__readout" aria-live="polite">
        <span>
          {selected === null
            ? `${range} 走势`
            : pointDate(selected.sourceEventAt, range)}
        </span>
        {selected === null ? null : (
          <strong className="numeric">
            {signedAmount(
              selected.changeUsd,
              displayCurrency,
              usdCnyRate,
            )}
            <small>{percent(selected.changeRate)}</small>
          </strong>
        )}
      </div>
      <div
        className="portfolio-trend__plot"
        role="slider"
        tabIndex={0}
        aria-label={`${range} 组合收益走势`}
        aria-valuemin={0}
        aria-valuemax={renderPoints.length - 1}
        aria-valuenow={selectedIndex}
        aria-valuetext={selectedLabel}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onBlur={() => {
          setIsInspecting(false);
          setSelectedIndex(Math.max(0, renderPoints.length - 1));
        }}
      >
        <Suspense
          fallback={
            <span
              className="portfolio-trend__skeleton"
              aria-hidden="true"
            />
          }
        >
          <PortfolioTrendPlot
            points={chartPoints}
            yDomain={yDomain}
            chartColor={chartColor}
            selected={selected}
            isInspecting={isInspecting}
          />
        </Suspense>
      </div>
      {range === "1D" && renderPoints.some((point) => point.segment === "OVERNIGHT_CURRENT") ? (
        <p className="portfolio-trend__overnight-note">
          隔夜仅显示当前指示点，未连接缺失区间
        </p>
      ) : null}
    </div>
  );
}
