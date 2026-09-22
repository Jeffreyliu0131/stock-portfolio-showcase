export type PortfolioFixtureName =
  | "ready"
  | "empty"
  | "partial"
  | "stale"
  | "error"
  | "loading";

export type PortfolioPosition = {
  instrumentKey: string;
  symbol: string;
  name: string;
  quantity: string;
  averageCost: string;
  marketValue: string;
  valuationPrice: string;
  pnl: string;
  returnRate: string;
  pnlDirection: "positive" | "negative" | "neutral";
  dailyChange: string;
  dailyChangeRate: string;
  dailyChangeDirection: "positive" | "negative" | "neutral";
};

export type PortfolioCash = {
  balance: string;
  accounts: readonly {
    broker: "IBKR" | "MOOMOO";
    balance: string;
    settledBalance: string;
    pendingBalance: string;
    hasPending: boolean;
    isNegative: boolean;
  }[];
  hasIbkrInterest: boolean;
  netAssetValueUsd: string;
  navIsCashFallback: boolean;
  pricingPlan: "IBKR Pro" | "IBKR Lite" | "未配置";
  interestBearingBalance: string;
  publishedAnnualRate: string;
  navAdjustedAnnualRate: string;
  blendedAnnualRate: string;
  estimatedAnnualInterest: string;
  estimatedMonthlyInterest: string;
  policyVerifiedAt: string;
  sourceUrl: string;
};

export type PortfolioFixture =
  | {
      viewState: "empty";
    }
  | {
      viewState: "loading";
    }
  | {
      viewState: "load-error";
      message: string;
    }
  | {
      viewState: "ready";
      summaryLabel: string;
      marketValue: string;
      openCost: string;
      stockOpenCost: string;
      pnl: string;
      pnlLabel: string;
      returnRate: string;
      pnlDirection: "positive" | "negative" | "neutral";
      dailyChange: string;
      dailyChangeRate: string;
      dailyChangeDirection: "positive" | "negative" | "neutral";
      cash: PortfolioCash | null;
      status: {
        source: string;
      };
      positions: PortfolioPosition[];
    };

const healthyPositions: PortfolioPosition[] = [
  {
    instrumentKey: "NASDAQ:AAPL:USD",
    symbol: "AAPL",
    name: "Apple Inc.",
    quantity: "120.5",
    averageCost: "$171.40",
    marketValue: "$24,473.55",
    valuationPrice: "$203.10",
    pnl: "+$3,819.85",
    returnRate: "+18.50%",
    pnlDirection: "positive",
    dailyChange: "+$373.55",
    dailyChangeRate: "+1.55%",
    dailyChangeDirection: "positive",
  },
  {
    instrumentKey: "NASDAQ:MSFT:USD",
    symbol: "MSFT",
    name: "Microsoft Corp.",
    quantity: "38",
    averageCost: "$395.20",
    marketValue: "$16,277.30",
    valuationPrice: "$428.35",
    pnl: "+$1,259.70",
    returnRate: "+8.39%",
    pnlDirection: "positive",
    dailyChange: "+$127.30",
    dailyChangeRate: "+0.79%",
    dailyChangeDirection: "positive",
  },
  {
    instrumentKey: "NYSE_ARCA:VOO:USD",
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    quantity: "12.75",
    averageCost: "$486.75",
    marketValue: "$6,683.04",
    valuationPrice: "$524.16",
    pnl: "+$476.98",
    returnRate: "+7.69%",
    pnlDirection: "positive",
    dailyChange: "+$53.04",
    dailyChangeRate: "+0.80%",
    dailyChangeDirection: "positive",
  },
];

const fixtures: Record<PortfolioFixtureName, PortfolioFixture> = {
  ready: {
    viewState: "ready",
    summaryLabel: "估算总市值",
    marketValue: "$47,433.89",
    openCost: "$41,877.36",
    stockOpenCost: "$41,877.36",
    pnl: "+$5,556.53",
    pnlLabel: "浮动盈亏",
    returnRate: "+13.27%",
    pnlDirection: "positive",
    dailyChange: "+$553.89",
    dailyChangeRate: "+1.18%",
    dailyChangeDirection: "positive",
    cash: null,
    status: {
      source: "15 分钟延迟",
    },
    positions: healthyPositions,
  },
  empty: {
    viewState: "empty",
  },
  partial: {
    viewState: "ready",
    summaryLabel: "已定价市值",
    marketValue: "$40,750.85",
    openCost: "$48,727.36",
    stockOpenCost: "$48,727.36",
    pnl: "+$5,079.55",
    pnlLabel: "已定价部分盈亏",
    returnRate: "+14.24%",
    pnlDirection: "positive",
    dailyChange: "—",
    dailyChangeRate: "—",
    dailyChangeDirection: "neutral",
    cash: null,
    status: {
      source: "15 分钟延迟",
    },
    positions: [
      ...healthyPositions.slice(0, 2),
      {
        instrumentKey: "NASDAQ:TSLA:USD",
        symbol: "TSLA",
        name: "Tesla Inc.",
        quantity: "25",
        averageCost: "$274.00",
        marketValue: "—",
        valuationPrice: "—",
        pnl: "待定价",
        returnRate: "—",
        pnlDirection: "neutral",
        dailyChange: "—",
        dailyChangeRate: "—",
        dailyChangeDirection: "neutral",
      },
    ],
  },
  stale: {
    viewState: "ready",
    summaryLabel: "估算总市值",
    marketValue: "$47,433.89",
    openCost: "$41,877.36",
    stockOpenCost: "$41,877.36",
    pnl: "+$5,556.53",
    pnlLabel: "浮动盈亏",
    returnRate: "+13.27%",
    pnlDirection: "positive",
    dailyChange: "+$553.89",
    dailyChangeRate: "+1.18%",
    dailyChangeDirection: "positive",
    cash: null,
    status: {
      source: "15 分钟延迟",
    },
    positions: healthyPositions,
  },
  error: {
    viewState: "ready",
    summaryLabel: "估算总市值",
    marketValue: "$47,433.89",
    openCost: "$41,877.36",
    stockOpenCost: "$41,877.36",
    pnl: "+$5,556.53",
    pnlLabel: "浮动盈亏",
    returnRate: "+13.27%",
    pnlDirection: "positive",
    dailyChange: "+$553.89",
    dailyChangeRate: "+1.18%",
    dailyChangeDirection: "positive",
    cash: null,
    status: {
      source: "15 分钟延迟",
    },
    positions: healthyPositions,
  },
  loading: {
    viewState: "loading",
  },
};

export function getPortfolioFixture(name: PortfolioFixtureName): PortfolioFixture {
  return fixtures[name];
}
