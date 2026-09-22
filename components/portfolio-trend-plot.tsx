"use client";

import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

export interface PortfolioTrendPlotPoint {
  readonly timeValue: number;
  readonly lineValue: number | null;
  readonly plottedValue: number;
}

interface PortfolioTrendPlotProps {
  readonly points: readonly PortfolioTrendPlotPoint[];
  readonly yDomain: readonly [number, number];
  readonly chartColor: string;
  readonly selected: PortfolioTrendPlotPoint | null;
  readonly isInspecting: boolean;
}

export function PortfolioTrendPlot({
  points,
  yDomain,
  chartColor,
  selected,
  isInspecting,
}: PortfolioTrendPlotProps) {
  return (
    <ComposedChart
      responsive
      accessibilityLayer={false}
      data={points}
      margin={{ top: 10, right: 2, bottom: 6, left: 2 }}
      style={{ width: "100%", height: "100%" }}
    >
      <XAxis
        dataKey="timeValue"
        type="number"
        domain={["dataMin", "dataMax"]}
        hide
      />
      <YAxis domain={[...yDomain]} hide />
      <ReferenceLine
        y={0}
        stroke="var(--portfolio-chart-grid)"
        strokeDasharray="3 5"
      />
      <Area
        type="linear"
        dataKey="lineValue"
        baseValue={0}
        stroke="none"
        fill={chartColor}
        fillOpacity={0.085}
        connectNulls={false}
        isAnimationActive={false}
      />
      <Line
        type="linear"
        dataKey="lineValue"
        stroke={chartColor}
        strokeWidth={2}
        dot={false}
        activeDot={false}
        connectNulls={false}
        isAnimationActive={false}
      />
      {selected === null || !isInspecting ? null : (
        <>
          <ReferenceLine
            x={selected.timeValue}
            stroke="var(--portfolio-chart-cursor)"
            strokeWidth={1}
          />
          <ReferenceDot
            x={selected.timeValue}
            y={selected.plottedValue}
            r={9}
            fill={chartColor}
            fillOpacity={0.18}
            stroke="none"
          />
          <ReferenceDot
            x={selected.timeValue}
            y={selected.plottedValue}
            r={4}
            fill={chartColor}
            stroke="var(--portfolio-hero-bg)"
            strokeWidth={2}
          />
        </>
      )}
    </ComposedChart>
  );
}
