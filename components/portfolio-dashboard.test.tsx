// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UsdCnyRate } from "../application/fx/types.ts";
import type { PortfolioTrendResult } from "../domain/index.ts";
import { getPortfolioFixture } from "../ui/portfolio-fixtures.ts";
import type { PortfolioFixture } from "../ui/portfolio-fixtures.ts";
import type { PortfolioInsights } from "../ui/portfolio-insights.ts";
import {
  PortfolioDashboard,
  compactPositionDisplayName,
} from "./portfolio-dashboard.tsx";

const USD_CNY_RATE: UsdCnyRate = {
  baseCurrency: "USD",
  quoteCurrency: "CNY",
  rate: "7.2",
  provider: "alpaca",
  rateType: "MIDPOINT",
  sourceEventAt: "2026-08-02T08:00:00Z",
  fetchedAt: "2026-08-02T08:00:01Z",
};

const ECB_USD_CNY_RATE: UsdCnyRate = {
  baseCurrency: "USD",
  quoteCurrency: "CNY",
  rate: "6.75132782",
  provider: "ecb",
  rateType: "REFERENCE",
  referenceDate: "2026-07-31",
  sourceEventAt: "2026-07-31T13:57:02Z",
  fetchedAt: "2026-08-02T08:00:01Z",
};

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

const CASH_ONLY_INSIGHTS: PortfolioInsights = {
  currency: "USD",
  structure: {
    pricingComplete: true,
    pricedPositionCount: 0,
    unpricedPositionCount: 0,
    totalPricedAssetsUsd: "20000",
    weightBasis: "TOTAL_ASSETS",
    positions: [],
    cash: { balanceUsd: "20000", assetWeight: "1" },
    concentration: {
      status: "UNAVAILABLE",
      top1: null,
      top3: null,
      top5: null,
    },
  },
  daily: {
    status: "UNAVAILABLE",
    totalPositionCount: 0,
    calculablePositionCount: 0,
    netEffectUsd: null,
    calculableAbsoluteEffectUsd: null,
    shareBasis: "UNAVAILABLE",
    contributions: [],
    largestPositiveContributor: null,
    largestNegativeContributor: null,
  },
};

function cnyReadyFixture(): PortfolioFixture {
  const base = getPortfolioFixture("ready");
  if (base.viewState !== "ready") {
    throw new Error("ready fixture expected");
  }
  const cnyAmounts = [
    {
      marketValue: "¥176,209.56",
      valuationPrice: "¥1,462.32",
      averageCost: "¥1,234.08",
      pnl: "+¥27,502.92",
      dailyChange: "+¥2,689.56",
    },
    {
      marketValue: "¥117,196.56",
      valuationPrice: "¥3,084.12",
      averageCost: "¥2,845.44",
      pnl: "+¥9,069.84",
      dailyChange: "+¥916.56",
    },
    {
      marketValue: "¥48,117.89",
      valuationPrice: "¥3,773.95",
      averageCost: "¥3,504.60",
      pnl: "+¥3,434.26",
      dailyChange: "+¥381.89",
    },
  ];
  return {
    ...base,
    summaryLabel: "人民币估算总市值",
    marketValue: "¥341,524.01",
    openCost: "¥301,516.99",
    stockOpenCost: "¥301,516.99",
    pnl: "+¥40,007.02",
    pnlLabel: "折算浮动盈亏",
    dailyChange: "+¥3,988.01",
    positions: base.positions.map((position, index) => ({
      ...position,
      ...cnyAmounts[index],
    })),
  };
}

function cashReadyFixture(): PortfolioFixture {
  const base = getPortfolioFixture("ready");
  if (base.viewState !== "ready") {
    throw new Error("ready fixture expected");
  }
  return {
    ...base,
    summaryLabel: "估算总资产",
    marketValue: "$67,433.89",
    openCost: "$61,877.36",
    returnRate: "+8.98%",
    cash: {
      balance: "$20,000.00",
      accounts: [
        {
          broker: "IBKR",
          balance: "$20,000.00",
          settledBalance: "$20,000.00",
          pendingBalance: "$0.00",
          hasPending: false,
          isNegative: false,
        },
      ],
      hasIbkrInterest: true,
      netAssetValueUsd: "$80,000.00",
      navIsCashFallback: false,
      pricingPlan: "IBKR Pro",
      interestBearingBalance: "$10,000.00",
      publishedAnnualRate: "+3.13%",
      navAdjustedAnnualRate: "+2.50%",
      blendedAnnualRate: "+1.25%",
      estimatedAnnualInterest: "+$250.40",
      estimatedMonthlyInterest: "+$20.87",
      policyVerifiedAt: "2026-08-02",
      sourceUrl:
        "https://www.interactivebrokers.com/en/accounts/fees/pricing-interest-rates.php",
    },
  };
}

function negativeDailyFixture(): PortfolioFixture {
  const base = getPortfolioFixture("ready");
  if (base.viewState !== "ready") {
    throw new Error("ready fixture expected");
  }
  return {
    ...base,
    dailyChange: "−$10.00",
    dailyChangeRate: "−0.05%",
    dailyChangeDirection: "negative",
    positions: base.positions.map((position, index) =>
      index === 0
        ? {
            ...position,
            dailyChange: "−$10.00",
            dailyChangeRate: "−0.05%",
            dailyChangeDirection: "negative",
          }
        : position,
    ),
  };
}

function copySuccess() {
  return Promise.resolve({
    delivery: "copied" as const,
    text: "持仓资料",
    positionCount: 1,
  });
}

function openMoreMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: "更多操作" }),
  );
  return screen.getByRole("dialog", { name: "更多操作" });
}

function openCopySheet(
  target: "clipboard" | "chatgpt" = "chatgpt",
) {
  const label =
    target === "chatgpt"
      ? "复制并打开 ChatGPT"
      : "仅复制持仓资料";
  const moreMenu = openMoreMenu();
  fireEvent.click(
    within(moreMenu).getByRole("button", {
      name: label,
    }),
  );
  return screen.getByRole("dialog", {
    name: label,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PortfolioDashboard", () => {
  it("compacts legal and security suffixes without changing the instrument identity", () => {
    expect(
      compactPositionDisplayName("Amazon.com, Inc.", "AMZN"),
    ).toBe("Amazon");
    expect(
      compactPositionDisplayName(
        "Alphabet Inc. Class C Capital Stock",
        "GOOG",
      ),
    ).toBe("Alphabet");
    expect(
      compactPositionDisplayName("Vanguard S&P 500 ETF", "VOO"),
    ).toBe("Vanguard S&P 500");
  });

  it("renders the decision hierarchy and one shared horizontally scrollable holdings table", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        trend={READY_TREND}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const apple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    expect(within(apple).getByText("+18.50%")).toHaveClass(
      "position-cell__secondary",
      "position-cell__secondary--positive",
    );
    expect(within(apple).getByText("+1.55%")).toHaveClass(
      "position-cell__primary",
      "position-cell__primary--positive",
    );
    expect(within(apple).getByText("+$373.55")).toHaveClass(
      "position-cell__secondary",
      "position-cell__secondary--positive",
    );
    expect(within(apple).getByText("Apple")).toBeInTheDocument();
    expect(within(apple).queryByText("Apple Inc.")).not.toBeInTheDocument();
    expect(within(apple).getByText("$24,473.55")).toBeInTheDocument();
    expect(within(apple).getByText("$203.10")).toBeInTheDocument();
    expect(within(apple).getByText("$171.40")).toBeInTheDocument();
    expect(within(apple).queryByText(/ET/)).not.toBeInTheDocument();
    expect(within(apple).queryByText("常规盘")).not.toBeInTheDocument();
    expect(within(apple).queryByText(/15 分钟/)).not.toBeInTheDocument();
    expect(within(apple).getByText("+$3,819.85")).toBeInTheDocument();
    expect(screen.getByText("名称/代码")).toBeInTheDocument();
    expect(screen.getByText("市值/数量")).toBeInTheDocument();
    expect(screen.getByText("估值价/均价")).toBeInTheDocument();
    expect(screen.getByText("盈亏/收益率")).toBeInTheDocument();
    expect(screen.getByText("今日涨幅")).toBeInTheDocument();
    const holdingsScroller = screen.getByRole("region", {
      name: "持仓明细，可左右滑动查看更多",
    });
    expect(holdingsScroller).toHaveAttribute("tabindex", "0");
    expect(holdingsScroller).toHaveAccessibleDescription(
      /名称和代码固定在左侧；从表头或任意持仓行左右滑动，可查看全部持仓数据/,
    );
    fireEvent.keyDown(holdingsScroller, { key: "ArrowRight" });
    expect(holdingsScroller.scrollLeft).toBe(96);
    fireEvent.keyDown(holdingsScroller, { key: "Home" });
    expect(holdingsScroller.scrollLeft).toBe(0);
    expect(holdingsScroller).toContainElement(apple);
    expect(
      holdingsScroller.querySelector(".position-table__header"),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "总仓位" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "账户页面" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("本机统一组合")).not.toBeInTheDocument();
    const currencyMode = screen.getByRole("group", {
      name: "显示币种",
    });
    expect(
      within(currencyMode).getByRole("button", { name: "USD" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(currencyMode).getByRole("button", { name: "人民币" }),
    ).toBeDisabled();
    expect(screen.queryByText("证券与现金")).not.toBeInTheDocument();
    expect(screen.queryByText("全部资产")).not.toBeInTheDocument();
    expect(screen.queryByText("定价覆盖")).not.toBeInTheDocument();
    expect(screen.getByText("累计盈亏")).toBeInTheDocument();
    expect(screen.getByText("今日盈亏")).toBeInTheDocument();
    expect(screen.getByText("股票成本")).toBeInTheDocument();
    expect(screen.getByText("现金")).toBeInTheDocument();
    expect(screen.queryByText("计价币种")).not.toBeInTheDocument();
    expect(screen.getAllByText("$47,433.89")).toHaveLength(1);
    const positiveDailyPnl = screen
      .getAllByLabelText("今日盈亏估算 +$553.89，今日涨跌幅 +1.18%")
      .find((element) =>
        element.classList.contains("account-summary__metric-value"),
      );
    expect(positiveDailyPnl).toBeDefined();
    expect(positiveDailyPnl).toHaveClass(
      "account-summary__pnl--positive",
    );
    expect(
      within(positiveDailyPnl!).getByText("+$553.89"),
    ).toBeInTheDocument();
    expect(
      within(positiveDailyPnl!).getByText("+1.18% · 估算"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "1D 组合收益走势" }),
    ).toHaveAttribute("aria-valuenow", "2");
    expect(
      screen.queryByRole("group", { name: "持仓变化显示" }),
    ).not.toBeInTheDocument();
    expect(apple).toHaveAccessibleDescription(
      /累计持仓盈亏 \+\$3,819\.85，持仓收益率 \+18\.50%； 今日涨幅 \+1\.55%，今日盈亏 \+\$373\.55/,
    );
    const appleDailyCell = apple.querySelector<HTMLElement>(
      '[data-label="今日涨幅"]',
    );
    expect(appleDailyCell).not.toBeNull();
    expect(within(appleDailyCell!).queryByText("估算")).not.toBeInTheDocument();
    expect(within(apple).getByText("+$3,819.85")).toBeInTheDocument();
    expect(
      screen.queryByText("15 分钟延迟 SIP"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("15 分钟延迟")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "持仓与现金" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("左右滑动 · 点按股票操作"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "录入 IBKR USD 现金" }),
    ).toHaveAttribute("href", "/cash");
    expect(
      screen.getByRole("button", { name: "录入资产" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "股票" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/实时/)).not.toBeInTheDocument();
  });

  it("shows only the real intraday trend without historical range controls", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        trend={READY_TREND}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    expect(screen.queryByRole("group", { name: "收益周期" })).not.toBeInTheDocument();
    for (const label of ["1W", "1M", "3M", "1Y", "ALL"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText("今日收益 +$553.89，收益率 +1.18%")).toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "1D 组合收益走势" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "今日盈亏估算 +$553.89，今日涨跌幅 +1.18%",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("今日走势 · 按当前股数估算 · 现金不参与"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Modified Dietz/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /收益历史/ })).not.toBeInTheDocument();
  });

  it("shows a negative daily rate in the summary tile with an explicit minus sign", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={negativeDailyFixture()}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const negativeDailyPnl = screen
      .getAllByLabelText("今日盈亏估算 −$10.00，今日涨跌幅 −0.05%")
      .find((element) =>
        element.classList.contains("account-summary__metric-value"),
      );
    expect(negativeDailyPnl).toBeDefined();
    expect(negativeDailyPnl).toHaveClass(
      "account-summary__pnl--negative",
    );
    expect(
      within(negativeDailyPnl!).getByText("−$10.00"),
    ).toBeInTheDocument();
    expect(
      within(negativeDailyPnl!).getByText("−0.05% · 估算"),
    ).toBeInTheDocument();
    const apple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    expect(within(apple).getByText("−0.05%")).toHaveClass(
      "position-cell__primary--negative",
    );
    expect(within(apple).getByText("−$10.00")).toHaveClass(
      "position-cell__secondary",
      "position-cell__secondary--negative",
    );
  });

  it("switches every displayed amount to CNY while keeping returns unchanged", () => {
    const { container } = render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        insights={CASH_ONLY_INSIGHTS}
        cnyPortfolio={cnyReadyFixture()}
        usdCnyRate={USD_CNY_RATE}
        isFxRateCached={false}
        isFxRefreshing={false}
        isFxRateUnavailable={false}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const cnyButton = screen.getByRole("button", { name: "人民币" });
    expect(cnyButton).toBeEnabled();
    fireEvent.click(cnyButton);

    expect(container.firstElementChild).toHaveAttribute(
      "data-display-currency",
      "CNY",
    );
    expect(cnyButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("人民币估算总市值")).toBeInTheDocument();
    expect(screen.getByText("折算累计盈亏")).toBeInTheDocument();
    expect(screen.getAllByText("¥341,524.01")).toHaveLength(1);
    expect(screen.getByText("¥176,209.56")).toBeInTheDocument();
    expect(screen.getByText("¥1,462.32")).toBeInTheDocument();
    expect(
      screen.getByLabelText("今日收益 +¥3,988.01，收益率 +1.18%"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "今日盈亏估算 +¥3,988.01，今日涨跌幅 +1.18%",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("折算股票成本")).toBeInTheDocument();
    expect(screen.getByText("¥301,516.99")).toBeInTheDocument();
    expect(screen.queryByText("人民币 CNY")).not.toBeInTheDocument();
    expect(screen.getByText("+13.27%")).toBeInTheDocument();
    expect(
      screen.getByText(/1 USD ≈ ¥7\.2 · Alpaca 中间价/),
    ).toHaveTextContent("持仓录入与复制资料仍使用 USD 真值，不计算汇兑盈亏");
    expect(screen.queryByText("$47,433.89")).not.toBeInTheDocument();

    expect(screen.getAllByText("+¥3,988.01")).toHaveLength(2);
    expect(screen.getByText("+1.18% · 估算")).toBeInTheDocument();
    const cnyApple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    expect(within(cnyApple).getByText("+¥2,689.56")).toHaveClass(
      "position-cell__secondary",
      "position-cell__secondary--positive",
    );
    expect(
      screen.queryByRole("group", { name: "持仓变化显示" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "组合分析" }));
    const insightsDialog = screen.getByRole("dialog", {
      name: "组合分析",
    });
    expect(
      within(insightsDialog).getByText(
        /1 USD ≈ ¥7\.2 折算 · Alpaca 中间价 · 汇率时间/,
      ),
    ).toHaveTextContent("占比和排序保持 USD 真值口径");
    fireEvent.click(
      within(insightsDialog).getByRole("button", {
        name: "关闭组合分析",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "USD" }));
    expect(container.firstElementChild).toHaveAttribute(
      "data-display-currency",
      "USD",
    );
    expect(screen.getAllByText("$47,433.89")).toHaveLength(1);
  });

  it("shows IBKR cash in the continuous asset list and combined totals", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={cashReadyFixture()}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    expect(screen.getByText("估算总资产")).toBeInTheDocument();
    expect(screen.getAllByText("$67,433.89")).toHaveLength(1);
    expect(screen.getByText("累计盈亏")).toBeInTheDocument();
    expect(screen.getByText("股票成本")).toBeInTheDocument();
    expect(screen.queryByText("股票成本 + 现金")).not.toBeInTheDocument();
    expect(screen.queryByText("4 项")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("今日收益 +$553.89，收益率 +1.18%"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "今日盈亏估算 +$553.89，今日涨跌幅 +1.18%",
      ),
    ).toBeInTheDocument();
    const cashRow = screen.getByRole("link", {
      name: "IBKR USD 现金余额 $20,000.00，点按修改",
    });
    expect(cashRow).toHaveAttribute("href", "/cash");
    expect(within(cashRow).getByText("IBKR 现金")).toBeInTheDocument();
    expect(within(cashRow).getByText("$20,000.00")).toBeInTheDocument();
    expect(within(cashRow).getByText("+2.50%")).toBeInTheDocument();
    expect(within(cashRow).getByText("整笔混合 +1.25%")).toBeInTheDocument();
    expect(within(cashRow).getByText("+$250.40")).toBeInTheDocument();
    expect(within(cashRow).getByText("月均 +$20.87")).toBeInTheDocument();
    expect(screen.getByText(/2026-08-02 核验/)).toBeInTheDocument();

    expect(within(cashRow).getByText("+$250.40")).toBeInTheDocument();
    expect(cashRow).toHaveAccessibleDescription(
      "当前显示估算年利息 +$250.40； 现金不参与今日涨幅计算",
    );
    const cashDailyCell = cashRow.querySelector<HTMLElement>(
      '[data-label="今日变化"]',
    );
    expect(cashDailyCell).not.toBeNull();
    expect(within(cashDailyCell!).getByText("不参与")).toBeInTheDocument();
  });

  it("labels a cached rate with its original source time", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        cnyPortfolio={cnyReadyFixture()}
        usdCnyRate={USD_CNY_RATE}
        isFxRateCached
        isFxRefreshing={false}
        isFxRateUnavailable={false}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "人民币" }));
    expect(screen.getByText(/上次有效汇率/)).toHaveTextContent(
      "Alpaca 中间价",
    );
  });

  it("labels the credential-free fallback as an ECB daily reference rate", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        cnyPortfolio={cnyReadyFixture()}
        usdCnyRate={ECB_USD_CNY_RATE}
        isFxRateCached={false}
        isFxRefreshing={false}
        isFxRateUnavailable={false}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "人民币" }));
    const disclosure = screen.getByText(/欧洲央行日参考汇率/);
    expect(disclosure).toHaveTextContent("1 USD ≈ ¥6.75132782");
    expect(disclosure).toHaveTextContent("参考日 7/31");
    expect(disclosure).toHaveTextContent("官方更新时间");
    expect(disclosure).not.toHaveTextContent("Alpaca 中间价");
    expect(screen.getByText("人民币估算汇率可用")).toHaveClass(
      "sr-only",
    );
  });

  it("keeps USD visible and explains when no CNY rate is usable", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        cnyPortfolio={null}
        usdCnyRate={null}
        isFxRateCached={false}
        isFxRefreshing={false}
        isFxRateUnavailable
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    expect(screen.getByRole("button", { name: "人民币" })).toBeDisabled();
    expect(
      screen.getByText("人民币估算汇率暂时不可用，当前继续显示 USD。"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$47,433.89")).toHaveLength(1);
  });

  it("shows an unavailable daily rate without adding row-level aging details", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("partial")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    expect(screen.queryByText("定价覆盖")).not.toBeInTheDocument();
    const tesla = screen.getByRole("button", {
      name: "TSLA Tesla Inc. 持仓，点按或长按打开操作",
    });
    expect(within(tesla).getByText("TSLA · 暂无价格")).toBeInTheDocument();
    expect(within(tesla).queryByText(/ET|隔夜|过期/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("今日收益 暂无，收益率 暂无")).toBeInTheDocument();
    expect(
      screen.getByLabelText("今日盈亏估算 暂无，今日涨跌幅 暂无"),
    ).toBeInTheDocument();
    const pnlCell = tesla.querySelector<HTMLElement>(
      '[data-label="盈亏 / 收益率"]',
    );
    expect(pnlCell).not.toBeNull();
    expect(within(pnlCell!).getByText("待定价")).toBeInTheDocument();
    const dailyCell = tesla.querySelector<HTMLElement>(
      '[data-label="今日涨幅"]',
    );
    expect(dailyCell).not.toBeNull();
    expect(within(dailyCell!).getAllByText("暂无")).toHaveLength(2);
  });

  it("shows a real empty state without manufacturing zero balances", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("empty")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "还没有资产" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /录入股票/ }),
    ).not.toBeInTheDocument();
    const restoreLink = screen.getByRole("link", {
      name: "从副本恢复",
    });
    expect(restoreLink).toHaveAttribute("href", "/data-safety");
    fireEvent.click(
      screen.getByRole("button", { name: "录入资产" }),
    );
    const entryDialog = screen.getByRole("dialog", {
      name: "录入资产",
    });
    expect(
      within(entryDialog).getByRole("link", { name: /录入股票/ }),
    ).toHaveAttribute("href", "/positions/new");
    expect(
      within(entryDialog).getByRole("link", {
        name: /录入 IBKR 现金/,
      }),
    ).toHaveAttribute("href", "/cash");
    expect(
      screen.queryByRole("button", { name: "导出数据副本" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "复制并打开 ChatGPT" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "仅复制持仓资料" }),
    ).not.toBeInTheDocument();
  });

  it("contains focus in the asset entry sheet and restores its trigger", async () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("empty")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const trigger = screen.getByRole("button", { name: "录入资产" });
    const background = screen
      .getByRole("heading", { name: "还没有资产" })
      .closest("section")!;
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "录入资产" });
    const first = within(dialog).getByRole("link", { name: /录入股票/ });
    const last = within(dialog).getByRole("button", { name: "取消" });
    await waitFor(() => expect(first).toHaveFocus());
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
  });

  it("contains focus in the more and copy sheets and restores the more trigger", async () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const trigger = screen.getByRole("button", { name: "更多操作" });
    const background = screen
      .getByRole("heading", { name: "总仓位" })
      .closest("header")!;
    const moreDialog = openMoreMenu();
    const firstMore = within(moreDialog).getByRole("button", {
      name: /刷新行情/,
    });
    const lastMore = within(moreDialog).getByRole("button", {
      name: "取消",
    });
    await waitFor(() => expect(firstMore).toHaveFocus());
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");
    firstMore.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastMore).toHaveFocus();
    lastMore.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(firstMore).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(background).not.toHaveAttribute("inert");

    const copyDialog = openCopySheet("clipboard");
    const firstCopy = within(copyDialog).getByRole("button", {
      name: /全部持仓/,
    });
    const lastCopy = within(copyDialog).getByRole("button", {
      name: "关闭",
    });
    await waitFor(() => expect(firstCopy).toHaveFocus());
    expect(background).toHaveAttribute("inert");
    firstCopy.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastCopy).toHaveFocus();
    lastCopy.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(firstCopy).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
  });

  it("contains focus across position actions and delete confirmation", async () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const apple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    const background = screen
      .getByRole("heading", { name: "总仓位" })
      .closest("header")!;
    fireEvent.click(apple);

    let dialog = screen.getByRole("dialog", { name: "AAPL 持仓操作" });
    const firstAction = within(dialog).getByRole("link", {
      name: /修改持仓/,
    });
    const lastAction = within(dialog).getByRole("button", { name: "取消" });
    await waitFor(() => expect(firstAction).toHaveFocus());
    expect(background).toHaveAttribute("inert");
    firstAction.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastAction).toHaveFocus();
    lastAction.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(firstAction).toHaveFocus();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /删除持仓/ }),
    );
    dialog = screen.getByRole("dialog", { name: "删除 AAPL 持仓？" });
    const firstDelete = within(dialog).getByRole("button", { name: "返回" });
    const lastDelete = within(dialog).getByRole("button", {
      name: "确认删除",
    });
    await waitFor(() => expect(firstDelete).toHaveFocus());
    firstDelete.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastDelete).toHaveFocus();
    lastDelete.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(firstDelete).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(apple).toHaveFocus();
    });
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
  });

  it("exposes separate analysis, chat, and research entries with separate dialogs", async () => {
    render(
      <PortfolioDashboard
        initialPortfolio={cashReadyFixture()}
        insights={CASH_ONLY_INSIGHTS}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const analysisTrigger = screen.getByRole("button", {
      name: "组合分析",
    });
    const chatTrigger = screen.getByRole("button", {
      name: "巴菲特框架顾问",
    });
    const researchTrigger = screen.getByRole("button", {
      name: "巴菲特研究系统 · AAPL / MSFT",
    });
    const consultationEntry = screen.getByRole("region", {
      name: "组合工具",
    });
    expect(consultationEntry).toContainElement(analysisTrigger);
    expect(consultationEntry).toContainElement(chatTrigger);
    expect(consultationEntry).toContainElement(researchTrigger);
    expect(analysisTrigger.closest(".section-heading")).toBeNull();
    expect(consultationEntry).not.toHaveTextContent("DeepSeek");
    expect(consultationEntry).not.toHaveTextContent("当前组合上下文");
    const more = openMoreMenu();
    expect(
      within(more).getByRole("link", { name: /数据安全与恢复/ }),
    ).toHaveAttribute("href", "/data-safety");
    expect(
      within(more).queryByRole("button", {
        name: /组合结构与今日贡献|组合分析|巴菲特框架顾问|巴菲特研究系统/,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(more).getByRole("button", { name: "取消" }),
    );
    fireEvent.click(analysisTrigger);

    const insights = screen.getByRole("dialog", {
      name: "组合分析",
    });
    expect(within(insights).getByText("仅现金 · 完整")).toHaveAttribute(
      "data-status",
      "complete",
    );
    expect(
      within(insights)
        .getByText("USD 现金")
        .closest("[role='listitem']"),
    ).toHaveTextContent("100.00%");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(analysisTrigger).toHaveFocus();
    });

    fireEvent.click(chatTrigger);
    expect(
      screen.getByRole("dialog", { name: "巴菲特框架顾问" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "组合分析" })).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("直接问：这个判断的证据够吗？"),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(chatTrigger).toHaveFocus();
    });

    fireEvent.click(researchTrigger);
    expect(
      screen.getByRole("dialog", { name: "巴菲特研究系统" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AAPL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(researchTrigger).toHaveFocus();
    });
  });

  it("closes an open insights sheet when insights become unavailable and does not reopen it on recovery", async () => {
    const props = {
      initialPortfolio: cashReadyFixture(),
      isExporting: false,
      isRefreshing: false,
      notice: null,
      onCopyPositions: copySuccess,
      onExportBackup: () => undefined,
      onRefresh: () => undefined,
      onRetry: () => undefined,
      onDelete: async () => true,
    };
    const { rerender } = render(
      <PortfolioDashboard {...props} insights={CASH_ONLY_INSIGHTS} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "组合分析" }),
    );
    expect(
      screen.getByRole("dialog", { name: "组合分析" }),
    ).toBeInTheDocument();

    rerender(<PortfolioDashboard {...props} insights={null} />);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "组合分析" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "更多操作" })).toHaveFocus();
    });

    rerender(
      <PortfolioDashboard {...props} insights={CASH_ONLY_INSIGHTS} />,
    );
    expect(
      screen.queryByRole("dialog", { name: "组合分析" }),
    ).not.toBeInTheDocument();
  });

  it("opens the copy scope sheet and copies all current positions", async () => {
    const onCopyPositions = vi.fn(copySuccess);
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const moreMenu = openMoreMenu();
    const copy = within(moreMenu).getByRole("button", {
      name: "复制并打开 ChatGPT",
    });
    expect(
      within(moreMenu).getByRole("button", {
        name: "仅复制持仓资料",
      }),
    ).toHaveAttribute("aria-describedby", "copy-privacy-note");
    expect(copy).toHaveAttribute(
      "aria-describedby",
      "chatgpt-copy-privacy-note",
    );
    expect(
      within(moreMenu).getByText(
        "两种方式生成同一份 USD 资料；均不会自动发送",
      ),
    ).toBeInTheDocument();

    fireEvent.click(copy);
    const dialog = screen.getByRole("dialog", {
      name: "复制并打开 ChatGPT",
    });
    expect(
      within(dialog).queryByRole("button", { name: /前 5 大持仓/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /前 10 大持仓/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /全部持仓/ }),
    );

    await waitFor(() => {
      expect(onCopyPositions).toHaveBeenCalledWith(
        { kind: "all" },
        "chatgpt",
      );
      expect(
        screen.getByRole("button", { name: "更多操作" }),
      ).toHaveFocus();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("copies to the clipboard without leaving for ChatGPT", async () => {
    const onCopyPositions = vi.fn(copySuccess);
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const dialog = openCopySheet("clipboard");
    expect(
      within(dialog).getByText(/仅写入系统剪贴板/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /全部持仓/ }),
    );

    await waitFor(() => {
      expect(onCopyPositions).toHaveBeenCalledWith(
        { kind: "all" },
        "clipboard",
      );
      expect(
        screen.getByText("已复制，可粘贴到其他应用"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("已复制并打开 ChatGPT"),
    ).not.toBeInTheDocument();
  });

  it("shows copy success as a transient toast instead of an inline notice", async () => {
    vi.useFakeTimers();
    const originalVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    const setVisibility = (value: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value,
      });
    };
    setVisibility("visible");

    try {
      render(
        <PortfolioDashboard
          initialPortfolio={getPortfolioFixture("ready")}
          isExporting={false}
          isRefreshing={false}
          notice={null}
          onCopyPositions={copySuccess}
          onExportBackup={() => undefined}
          onRefresh={() => undefined}
          onRetry={() => undefined}
          onDelete={async () => true}
        />,
      );

      const dialog = openCopySheet();
      fireEvent.click(
        within(dialog).getByRole("button", { name: /全部持仓/ }),
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const message = screen.getByText("已复制并打开 ChatGPT");
      expect(message.closest(".portfolio-toast")).toHaveAttribute(
        "role",
        "status",
      );
      expect(
        screen.queryByText(/已复制 1 只持仓资料/),
      ).not.toBeInTheDocument();

      act(() => {
        setVisibility("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("已复制并打开 ChatGPT")).toBeInTheDocument();

      act(() => {
        setVisibility("visible");
        document.dispatchEvent(new Event("visibilitychange"));
        vi.advanceTimersByTime(2_399);
      });
      expect(screen.getByText("已复制并打开 ChatGPT")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(
        screen.queryByText("已复制并打开 ChatGPT"),
      ).not.toBeInTheDocument();
    } finally {
      if (originalVisibility === undefined) {
        Reflect.deleteProperty(document, "visibilityState");
      } else {
        Object.defineProperty(
          document,
          "visibilityState",
          originalVisibility,
        );
      }
    }
  });

  it("delivers the distinct top-five and top-ten scopes for a large portfolio", async () => {
    const base = getPortfolioFixture("ready");
    if (base.viewState !== "ready") {
      throw new Error("ready fixture expected");
    }
    const positions = Array.from({ length: 11 }, (_, index) => {
      const template = base.positions[index % base.positions.length];
      if (template === undefined) {
        throw new Error("position fixture expected");
      }
      return {
        ...template,
        instrumentKey: `instrument-${index + 1}`,
        symbol: `S${index + 1}`,
        name: `Stock ${index + 1}`,
      };
    });
    const onCopyPositions = vi.fn(copySuccess);
    render(
      <PortfolioDashboard
        initialPortfolio={{ ...base, positions }}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    let dialog = openCopySheet();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /前 5 大持仓/ }),
    );
    await waitFor(() => {
      expect(onCopyPositions).toHaveBeenCalledWith(
        {
          kind: "top",
          limit: 5,
        },
        "chatgpt",
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "更多操作" }),
      ).toBeEnabled();
    });
    dialog = openCopySheet();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /前 10 大持仓/ }),
    );
    await waitFor(() => {
      expect(onCopyPositions).toHaveBeenLastCalledWith(
        {
          kind: "top",
          limit: 10,
        },
        "chatgpt",
      );
      expect(onCopyPositions).toHaveBeenCalledTimes(2);
    });
  });

  it("selects one position and exposes generated text when clipboard copy fails", async () => {
    const onCopyPositions = vi.fn(async () => ({
      delivery: "manual-fallback" as const,
      text: "持仓资料\nMSFT",
      positionCount: 1,
    }));
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    openCopySheet();
    fireEvent.click(
      screen.getByRole("button", { name: /选择单只持仓/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /MSFT · Microsoft Corp/ }),
    );

    await waitFor(() => {
      expect(onCopyPositions).toHaveBeenCalledWith(
        {
          kind: "single",
          instrumentKey: "NASDAQ:MSFT:USD",
        },
        "chatgpt",
      );
    });
    const manual = await screen.findByRole("textbox", {
      name: "待手动复制的持仓资料",
    });
    expect(
      screen.getByText(/已尝试通过 ChatGPT 链接打开待发送 Prompt/),
    ).toBeInTheDocument();
    expect(manual).toHaveValue("持仓资料\nMSFT");
    expect(manual).toHaveAttribute("readonly");
    fireEvent.click(
      screen.getByRole("button", { name: "选择全部文本" }),
    );
    expect(manual).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "更多操作" }),
      ).toHaveFocus();
    });
  });

  it("keeps clipboard-only failures in the manual copy fallback", async () => {
    const onCopyPositions = vi.fn(async () => ({
      delivery: "manual-fallback" as const,
      text: "持仓资料\nAAPL",
      positionCount: 1,
    }));
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const dialog = openCopySheet("clipboard");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /全部持仓/ }),
    );

    expect(
      await screen.findByText(/系统未能自动写入剪贴板/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/已尝试通过 ChatGPT 链接/),
    ).not.toBeInTheDocument();
    expect(onCopyPositions).toHaveBeenCalledWith(
      { kind: "all" },
      "clipboard",
    );
    expect(
      screen.getByRole("textbox", { name: "待手动复制的持仓资料" }),
    ).toHaveValue("持仓资料\nAAPL");
  });

  it("blocks repeated copy taps while the clipboard operation is pending", async () => {
    let finishCopy: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finishCopy = resolve;
    });
    const onCopyPositions = vi.fn(async () => {
      await pending;
      return {
        delivery: "copied" as const,
        text: "持仓资料",
        positionCount: 3,
      };
    });
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    openCopySheet();
    const allPositions = screen.getByRole("button", {
      name: /全部持仓/,
    });
    fireEvent.click(allPositions);

    expect(allPositions).toBeDisabled();
    fireEvent.click(allPositions);
    expect(onCopyPositions).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCopy?.();
      await pending;
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("copies one position from the existing long-press action sheet", async () => {
    const onCopyPositions = vi.fn(copySuccess);
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const apple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    fireEvent.contextMenu(apple);
    fireEvent.click(
      screen.getByRole("button", { name: /复制并打开 ChatGPT/ }),
    );

    await waitFor(() => {
      expect(onCopyPositions).toHaveBeenCalledWith(
        {
          kind: "single",
          instrumentKey: "NASDAQ:AAPL:USD",
        },
        "chatgpt",
      );
      expect(apple).toHaveFocus();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("copies one position without opening ChatGPT from the position sheet", async () => {
    const onCopyPositions = vi.fn(copySuccess);
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={onCopyPositions}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const apple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    fireEvent.click(apple);
    fireEvent.click(
      screen.getByRole("button", { name: /仅复制这只持仓资料/ }),
    );

    await waitFor(() => {
      expect(onCopyPositions).toHaveBeenCalledWith(
        {
          kind: "single",
          instrumentKey: "NASDAQ:AAPL:USD",
        },
        "clipboard",
      );
      expect(screen.getByText("已复制，可粘贴到其他应用")).toBeInTheDocument();
      expect(apple).toHaveFocus();
    });
  });

  it("opens the same scoped position actions from a normal tap", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
      }),
    );

    expect(
      screen.getByRole("dialog", { name: "AAPL 持仓操作" }),
    ).toBeInTheDocument();
  });

  it("exports the current portfolio once and blocks duplicate taps while generating", () => {
    const onExportBackup = vi.fn();
    const { rerender } = render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={onExportBackup}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const backup = within(openMoreMenu()).getByRole("button", {
      name: "导出数据副本",
    });
    fireEvent.click(backup);
    expect(onExportBackup).toHaveBeenCalledTimes(1);
    expect(backup).toHaveAttribute(
      "aria-describedby",
      "backup-privacy-note",
    );
    expect(
      screen.getByText(
        "JSON 备份包含当前已保存的持仓数量、成本和 IBKR 现金记录，请妥善保存",
      ),
    ).toBeInTheDocument();

    rerender(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={onExportBackup}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const busyBackup = within(openMoreMenu()).getByRole("button", {
      name: "导出数据副本",
    });
    expect(busyBackup).toBeDisabled();
    expect(busyBackup).toHaveTextContent("生成中…");
    fireEvent.click(busyBackup);
    expect(onExportBackup).toHaveBeenCalledTimes(1);
  });

  it("keeps stale quote metadata out of the dense holdings table", () => {
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("stale")}
        isExporting={false}
        isRefreshing={false}
        notice="延迟行情暂时不可用。"
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    expect(
      screen.queryByRole("heading", {
        name: "正在使用上一有效价",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("上一有效价")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/7 月 30 日|10:22|\bET\b/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("延迟行情暂时不可用。"),
    ).toHaveAttribute("role", "status");
    expect(
      screen.queryByRole("button", { name: "恢复上一版" }),
    ).not.toBeInTheDocument();
  });

  it("opens scoped actions and confirms deletion for a long-press target", async () => {
    vi.useFakeTimers();
    const onDelete = vi.fn(async () => true);
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={onDelete}
      />,
    );

    const apple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    fireEvent.pointerDown(apple, {
      pointerType: "touch",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(550);
    });
    fireEvent.pointerUp(apple);
    vi.useRealTimers();

    const dialog = screen.getByRole("dialog", {
      name: "AAPL 持仓操作",
    });
    expect(
      within(dialog).getByRole("link", { name: /修改持仓/ }),
    ).toHaveAttribute("href", expect.stringContaining("mode=edit"));
    expect(
      within(dialog).getByRole("link", { name: /加仓/ }),
    ).toHaveAttribute("href", expect.stringContaining("mode=add"));
    expect(
      within(dialog).queryByRole("button", {
        name: "导出 JSON 备份",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /删除持仓/ }),
    );
    expect(
      screen.getByRole("dialog", {
        name: "删除 AAPL 持仓？",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "确认删除" }),
    );
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("NASDAQ:AAPL:USD");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels a pending long press when a horizontal swipe starts", () => {
    vi.useFakeTimers();
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={async () => true}
      />,
    );

    const apple = screen.getByRole("button", {
      name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
    });
    fireEvent.pointerDown(apple, {
      pointerType: "touch",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(apple, {
      pointerType: "touch",
      clientX: 40,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(550);
    });
    fireEvent.click(apple);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps delete confirmation open and explains a version conflict", async () => {
    const onDelete = vi.fn(async () => false);
    render(
      <PortfolioDashboard
        initialPortfolio={getPortfolioFixture("ready")}
        isExporting={false}
        isRefreshing={false}
        notice={null}
        onCopyPositions={copySuccess}
        onExportBackup={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onDelete={onDelete}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", {
        name: "AAPL Apple Inc. 持仓，点按或长按打开操作",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /删除持仓/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "确认删除" }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "删除失败，持仓可能已在另一页面更新。请返回首页刷新后重试。",
    );
    expect(
      screen.getByRole("dialog", {
        name: "删除 AAPL 持仓？",
      }),
    ).toBeInTheDocument();
  });
});


describe("empty portfolio storage boundary", () => {
  it.each(["provider", "sites"])("describes %s storage without promising the other target", target => {
    vi.stubEnv("NEXT_PUBLIC_PORTFOLIO_TARGET", target);
    render(<PortfolioDashboard initialPortfolio={getPortfolioFixture("empty")} isExporting={false} isRefreshing={false} notice={null} onCopyPositions={copySuccess} onExportBackup={() => undefined} onRefresh={() => undefined} onRetry={() => undefined} onDelete={async () => true} />);
    if (target === "provider") {
      expect(screen.getByText(/这里显示当前浏览器、当前来源的本地持仓/)).toBeInTheDocument();
      expect(screen.queryByText(/这份账号组合会在使用同一 ChatGPT 账号登录的设备间同步/)).toBeNull();
    } else {
      expect(screen.getByText(/这份账号组合会在使用同一 ChatGPT 账号登录的设备间同步/)).toBeInTheDocument();
      expect(screen.queryByText(/这里显示当前浏览器、当前来源的本地持仓/)).toBeNull();
    }
    expect(screen.getByRole("link", { name: "从副本恢复" })).toHaveAttribute("href", "/data-safety");
  });
});
