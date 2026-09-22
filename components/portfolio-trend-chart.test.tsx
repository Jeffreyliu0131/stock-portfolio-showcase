// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  HistoricalReturnResult,
  PortfolioTrendResult,
} from "../domain/index.ts";
import { PortfolioTrendChart } from "./portfolio-trend-chart.tsx";

const READY_TREND: PortfolioTrendResult = {
  status: "READY",
  referenceValue: "46880",
  points: [
    {
      sourceEventAt: "2026-08-07T14:30:00Z",
      estimatedDailyPriceEffect: "120",
      estimatedDailyChangeRate: "0.00255972696245733788",
      estimatedAsset: "47000",
      segment: "SIP_HISTORY",
      connectFromPrevious: false,
    },
    {
      sourceEventAt: "2026-08-07T15:30:00Z",
      estimatedDailyPriceEffect: "320",
      estimatedDailyChangeRate: "0.00682593856655290102",
      estimatedAsset: "47200",
      segment: "SIP_HISTORY",
      connectFromPrevious: true,
    },
    {
      sourceEventAt: "2026-08-07T16:30:00Z",
      estimatedDailyPriceEffect: "553.89",
      estimatedDailyChangeRate: "0.011815913312287",
      estimatedAsset: "47433.89",
      segment: "SIP_HISTORY",
      connectFromPrevious: true,
    },
  ],
};

const READY_HISTORY: HistoricalReturnResult = {
  status: "READY",
  basis: "MODIFIED_DIETZ",
  range: "1M",
  rangeReturnRate: "0.05",
  rangeFlowAdjustedChange: "5000",
  segmentCount: 1,
  points: [
    {
      sourceEventAt: "2026-07-01T21:00:00Z",
      actualNav: "100000",
      flowAdjustedChange: "0",
      returnRate: "0",
      connectFromPrevious: false,
    },
    {
      sourceEventAt: "2026-07-31T21:00:00Z",
      actualNav: "105000",
      flowAdjustedChange: "5000",
      returnRate: "0.05",
      connectFromPrevious: true,
    },
  ],
};

afterEach(cleanup);

describe("PortfolioTrendChart", () => {
  it("renders a READY trend and supports keyboard scrubbing", async () => {
    const { container } = render(
      <PortfolioTrendChart
        trend={READY_TREND}
        isLoading={false}
        displayCurrency="USD"
        usdCnyRate={null}
        direction="positive"
        hasStocks
      />,
    );

    const scrubber = screen.getByRole("slider", {
      name: "1D 组合收益走势",
    });
    expect(scrubber).toHaveAttribute("aria-valuemin", "0");
    expect(scrubber).toHaveAttribute("aria-valuemax", "2");
    expect(scrubber).toHaveAttribute("aria-valuenow", "2");
    expect(scrubber).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(
        /12:30 ET，估算资产 \$47,433\.89，今日盈亏 \+\$553\.89，收益率 \+1\.18%/,
      ),
    );
    await waitFor(
      () => {
        expect(container.querySelector(".recharts-line")).not.toBeNull();
      },
      { timeout: 5_000 },
    );
    expect(
      container.querySelectorAll(".recharts-reference-dot-dot"),
    ).toHaveLength(0);

    fireEvent.keyDown(scrubber, { key: "Home" });
    expect(scrubber).toHaveAttribute("aria-valuenow", "0");
    expect(scrubber).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/10:30 ET.*\+\$120\.00.*\+0\.26%/),
    );
    expect(
      container.querySelectorAll(".recharts-reference-dot-dot"),
    ).toHaveLength(2);

    fireEvent.keyDown(scrubber, { key: "ArrowRight" });
    expect(scrubber).toHaveAttribute("aria-valuenow", "1");
    expect(scrubber).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/11:30 ET.*\+\$320\.00.*\+0\.68%/),
    );

    fireEvent.keyDown(scrubber, { key: "ArrowLeft" });
    expect(scrubber).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(scrubber, { key: "End" });
    expect(scrubber).toHaveAttribute("aria-valuenow", "2");

    fireEvent.blur(scrubber);
    expect(
      container.querySelectorAll(".recharts-reference-dot-dot"),
    ).toHaveLength(0);
  }, 10_000);

  it("does not draw a line for an UNAVAILABLE result", () => {
    const unavailable: PortfolioTrendResult = {
      status: "UNAVAILABLE",
      reason: "MISSING_SERIES",
      points: [],
    };
    const { container } = render(
      <PortfolioTrendChart
        trend={unavailable}
        isLoading={false}
        displayCurrency="USD"
        usdCnyRate={null}
        direction="neutral"
        hasStocks
      />,
    );

    expect(screen.queryByRole("slider", { name: "1D 组合收益走势" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "部分股票缺少当日行情，今日走势暂不可用",
    );
    expect(container.querySelector(".recharts-line")).toBeNull();
  });

  it("scrubs horizontally and returns to the latest point on release", async () => {
    const { container } = render(
      <PortfolioTrendChart
        trend={READY_TREND}
        isLoading={false}
        displayCurrency="USD"
        usdCnyRate={null}
        direction="positive"
        hasStocks
      />,
    );
    const scrubber = screen.getByRole("slider", {
      name: "1D 组合收益走势",
    });
    await waitFor(
      () => {
        expect(container.querySelector(".recharts-line")).not.toBeNull();
      },
      { timeout: 5_000 },
    );
    Object.defineProperties(scrubber, {
      getBoundingClientRect: {
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          right: 300,
          bottom: 180,
          left: 0,
          width: 300,
          height: 180,
          toJSON: () => ({}),
        }),
      },
      setPointerCapture: { value: () => undefined },
      hasPointerCapture: { value: () => false },
      releasePointerCapture: { value: () => undefined },
    });

    fireEvent.pointerDown(scrubber, {
      clientX: 0,
      clientY: 90,
      pointerId: 1,
    });
    expect(scrubber).toHaveAttribute("aria-valuenow", "0");
    expect(
      container.querySelectorAll(".recharts-reference-dot-dot"),
    ).toHaveLength(2);

    fireEvent.pointerMove(scrubber, {
      clientX: 150,
      clientY: 92,
      pointerId: 1,
    });
    expect(scrubber).toHaveAttribute("aria-valuenow", "1");

    fireEvent.pointerUp(scrubber, { pointerId: 1 });
    expect(scrubber).toHaveAttribute("aria-valuenow", "2");
    expect(
      container.querySelectorAll(".recharts-reference-dot-dot"),
    ).toHaveLength(0);
  }, 10_000);

  it("does not draw a stock trend for a cash-only portfolio", () => {
    const { container } = render(
      <PortfolioTrendChart
        trend={READY_TREND}
        isLoading={false}
        displayCurrency="USD"
        usdCnyRate={null}
        direction="neutral"
        hasStocks={false}
      />,
    );

    expect(screen.queryByRole("slider", { name: "1D 组合收益走势" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "现金不参与今日走势",
    );
    expect(container.querySelector(".recharts-line")).toBeNull();
  });

  it("renders a long-range cash-flow-adjusted account history on a true date axis", async () => {
    const { container } = render(
      <PortfolioTrendChart
        trend={READY_HISTORY}
        range="1M"
        isLoading={false}
        displayCurrency="USD"
        usdCnyRate={null}
        direction="positive"
        hasStocks={false}
      />,
    );

    const scrubber = screen.getByRole("slider", {
      name: "1M 组合收益走势",
    });
    expect(scrubber).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(
        /7月31日，账户 NAV \$105,000\.00，现金流调整收益 \+\$5,000\.00，收益率 \+5\.00%/,
      ),
    );
    await waitFor(
      () => {
        expect(container.querySelector(".recharts-line")).not.toBeNull();
      },
      { timeout: 5_000 },
    );
    expect(
      container.querySelector('[data-axis-type="xAxis"]'),
    ).toBeNull();
  }, 10_000);
});
