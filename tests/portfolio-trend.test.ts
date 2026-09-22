import { describe, expect, it } from "vitest";

import type { IntradayBarSeries } from "../application/market-data/intraday-bars-api.ts";
import {
  createPortfolioTrend,
  type PortfolioTrendInput,
} from "../domain/portfolio-trend.ts";
import { AAPL, MSFT } from "./helpers.ts";

const T1 = "2026-08-07T13:30:00Z";
const T2 = "2026-08-07T13:45:00Z";
const OVERNIGHT = "2026-08-08T01:15:00Z";

function series(
  instrument: typeof AAPL,
  bars: readonly { readonly close: string; readonly sourceEventAt: string }[],
  status: IntradayBarSeries["status"] = bars.length === 0
    ? "NO_DATA"
    : "OK",
): IntradayBarSeries {
  return {
    instrument,
    status,
    bars: bars.map((bar) => ({
      ...bar,
      priceType: "MINUTE_BAR_CLOSE" as const,
    })),
  };
}

function input(
  overrides: Partial<PortfolioTrendInput> = {},
): PortfolioTrendInput {
  return {
    positions: [
      {
        instrument: AAPL,
        quantity: "2",
        previousRegularClose: "100",
      },
      {
        instrument: MSFT,
        quantity: "1",
        previousRegularClose: "200",
      },
    ],
    series: [
      series(AAPL, [
        { close: "105", sourceEventAt: T1 },
        { close: "110", sourceEventAt: T2 },
      ]),
      series(MSFT, [{ close: "180", sourceEventAt: T2 }]),
    ],
    cashBalance: "50",
    ...overrides,
  };
}

describe("current-position estimated portfolio trend", () => {
  it("aggregates sparse bars with exact Decimal amounts and local cash", () => {
    expect(createPortfolioTrend(input())).toEqual({
      status: "READY",
      referenceValue: "400",
      points: [
        {
          sourceEventAt: T1,
          estimatedDailyPriceEffect: "10",
          estimatedDailyChangeRate: "0.025",
          estimatedAsset: "460",
          segment: "SIP_HISTORY",
          connectFromPrevious: false,
        },
        {
          sourceEventAt: T2,
          estimatedDailyPriceEffect: "0",
          estimatedDailyChangeRate: "0",
          estimatedAsset: "450",
          segment: "SIP_HISTORY",
          connectFromPrevious: true,
        },
      ],
    });
  });

  it("keeps a successful no-data symbol at its previous close", () => {
    const result = createPortfolioTrend(
      input({
        series: [
          series(AAPL, [{ close: "105", sourceEventAt: T1 }]),
          series(MSFT, []),
        ],
      }),
    );

    expect(result).toMatchObject({
      status: "READY",
      points: [
        {
          estimatedDailyPriceEffect: "10",
          estimatedAsset: "460",
        },
      ],
    });
  });

  it("returns unavailable when any previous close is missing", () => {
    const positions = input().positions.map((position) =>
      position.instrument.symbol === "MSFT"
        ? { ...position, previousRegularClose: null }
        : position,
    );
    expect(createPortfolioTrend(input({ positions }))).toEqual({
      status: "UNAVAILABLE",
      reason: "MISSING_REFERENCE_CLOSE",
      points: [],
    });
  });

  it("returns unavailable for a missing or failed series", () => {
    expect(
      createPortfolioTrend(
        input({
          series: [
            series(AAPL, [{ close: "105", sourceEventAt: T1 }]),
            series(MSFT, [], "FAILED"),
          ],
        }),
      ),
    ).toEqual({
      status: "UNAVAILABLE",
      reason: "MISSING_SERIES",
      points: [],
    });
  });

  it("adds a complete overnight quote only as a disconnected point", () => {
    const result = createPortfolioTrend(
      input({
        overnightPoint: {
          sourceEventAt: OVERNIGHT,
          prices: [
            { instrument: AAPL, price: "120" },
            { instrument: MSFT, price: "210" },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      status: "READY",
      points: [
        {},
        {},
        {
          sourceEventAt: OVERNIGHT,
          estimatedDailyPriceEffect: "50",
          estimatedDailyChangeRate: "0.125",
          estimatedAsset: "500",
          segment: "OVERNIGHT_CURRENT",
          connectFromPrevious: false,
        },
      ],
    });
  });

  it("does not invent an overnight point when any current quote is missing", () => {
    const result = createPortfolioTrend(
      input({
        overnightPoint: {
          sourceEventAt: OVERNIGHT,
          prices: [{ instrument: AAPL, price: "120" }],
        },
      }),
    );

    expect(result.status).toBe("READY");
    if (result.status === "READY") {
      expect(result.points).toHaveLength(2);
      expect(
        result.points.some((point) => point.segment === "OVERNIGHT_CURRENT"),
      ).toBe(false);
    }
  });

  it("can return a lone disconnected overnight point before SIP bars exist", () => {
    const result = createPortfolioTrend(
      input({
        series: [series(AAPL, []), series(MSFT, [])],
        overnightPoint: {
          sourceEventAt: OVERNIGHT,
          prices: [
            { instrument: AAPL, price: "120" },
            { instrument: MSFT, price: "210" },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      status: "READY",
      points: [
        {
          segment: "OVERNIGHT_CURRENT",
          connectFromPrevious: false,
        },
      ],
    });
  });

  it("does not manufacture a flat line from empty historical data", () => {
    expect(
      createPortfolioTrend(
        input({ series: [series(AAPL, []), series(MSFT, [])] }),
      ),
    ).toEqual({
      status: "UNAVAILABLE",
      reason: "INSUFFICIENT_POINTS",
      points: [],
    });
  });
});
