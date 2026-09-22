import type {
  PortfolioConsultationClassification,
  PortfolioConsultationModelOutput,
  PortfolioConsultationRequest,
} from "../application/ai/portfolio-consultation-api.ts";

export function portfolioConsultationClassifications(): readonly PortfolioConsultationClassification[] {
  return [
    {
      positionId: "p0",
      symbol: "AAPL",
      basis: "AI_INFERRED",
      instrumentType: "SINGLE_STOCK",
      sector: "INFORMATION_TECHNOLOGY",
      themes: ["消费电子", "平台生态"],
      confidence: "HIGH",
      rationale: "主营业务与信息技术硬件及平台生态高度相关",
    },
    {
      positionId: "p1",
      symbol: "MSFT",
      basis: "AI_INFERRED",
      instrumentType: "SINGLE_STOCK",
      sector: "INFORMATION_TECHNOLOGY",
      themes: ["云计算", "企业软件"],
      confidence: "HIGH",
      rationale: "主营业务与企业软件及云计算服务高度相关",
    },
  ];
}

export function initialPortfolioConsultationRequest(): PortfolioConsultationRequest {
  return {
    kind: "PORTFOLIO_CONSULTATION",
    schemaVersion: 4,
    generatedAt: "2026-08-15T07:00:00.000Z",
    locale: "zh-CN",
    mode: "INITIAL_ANALYSIS",
    portfolio: {
      currency: "USD",
      summary: {
        stockPositionCount: 2,
        pricedPositionCount: 2,
        unpricedPositionCount: 0,
        pricingStatus: "COMPLETE",
        totalAssetsUsd: "4000",
        stockMarketValueUsd: "3000",
        portfolioOpenCostUsd: "2000",
        pricedOpenCostUsd: "2000",
        unpricedOpenCostUsd: "0",
        pricedUnrealizedPnlUsd: "1000",
        pricedUnrealizedReturn: "0.5",
        cashBalanceUsd: "1000",
        cashWeight: "0.25",
        top1Weight: "0.5",
        top3Weight: "0.75",
        top5Weight: "0.75",
        dailyStatus: "COMPLETE",
        dailyCalculablePositionCount: 2,
        dailyNetEffectUsd: "75",
        dailyAbsoluteEffectUsd: "125",
      },
      positions: [
        {
          positionId: "p0",
          symbol: "AAPL",
          name: "Apple Inc.",
          listingMarket: "NASDAQ",
          currency: "USD",
          marketRank: 1,
          quantity: "10",
          averageCostUsd: "100",
          openCostUsd: "1000",
          valuationPriceUsd: "200",
          marketValueUsd: "2000",
          unrealizedPnlUsd: "1000",
          unrealizedReturn: "1",
          assetWeight: "0.5",
          estimatedDailyPriceEffectUsd: "100",
          estimatedDailyChangeRate: "0.05",
          absoluteDailyContributionShare: "0.8",
          dailyStatus: "AVAILABLE",
          quote: {
            provider: "Alpaca",
            feed: "delayed_sip",
            priceType: "LATEST_TRADE",
            sourceEventAt: "2026-08-15T06:45:00.000Z",
            fetchedAt: "2026-08-15T07:00:00.000Z",
            marketSession: "REGULAR",
            valuationStatus: "HEALTHY_DELAYED",
            usedLastValid: false,
          },
        },
        {
          positionId: "p1",
          symbol: "MSFT",
          name: "Microsoft Corporation",
          listingMarket: "NASDAQ",
          currency: "USD",
          marketRank: 2,
          quantity: "5",
          averageCostUsd: "200",
          openCostUsd: "1000",
          valuationPriceUsd: "200",
          marketValueUsd: "1000",
          unrealizedPnlUsd: "0",
          unrealizedReturn: "0",
          assetWeight: "0.25",
          estimatedDailyPriceEffectUsd: "-25",
          estimatedDailyChangeRate: "-0.02439024390243902439",
          absoluteDailyContributionShare: "0.2",
          dailyStatus: "AVAILABLE",
          quote: {
            provider: "Alpaca",
            feed: "delayed_sip",
            priceType: "LATEST_TRADE",
            sourceEventAt: "2026-08-15T06:44:00.000Z",
            fetchedAt: "2026-08-15T07:00:00.000Z",
            marketSession: "REGULAR",
            valuationStatus: "HEALTHY_DELAYED",
            usedLastValid: false,
          },
        },
      ],
      cash: {
        provider: "PORTFOLIO",
        currency: "USD",
        balanceUsd: "1000",
        accounts: [
          {
            provider: "IBKR",
            balanceUsd: "1000",
            settledBalanceUsd: "1000",
            pendingBalanceUsd: "0",
          },
        ],
        ibkrInterest: {
          netAssetValueUsd: "50000",
          navSource: "USER_ENTERED",
          pricingPlan: "IBKR_PRO",
          interestBearingBalanceUsd: "0",
          blendedAnnualRate: "0",
          estimatedAnnualInterestUsd: "0",
          estimatedMonthlyInterestUsd: "0",
        },
      },
      quoteContext: {
        delay: "APPROXIMATELY_15_MINUTES",
        oldestSourceEventAt: "2026-08-15T06:44:00.000Z",
        oldestFetchedAt: "2026-08-15T07:00:00.000Z",
      },
    },
    priorClassifications: null,
    history: [],
    question: null,
  };
}

export function initialPortfolioConsultationOutput(): PortfolioConsultationModelOutput {
  return {
    classifications: portfolioConsultationClassifications(),
    brief: {
      headline: "组合由科技相关单股主导，现金提供一定缓冲",
      summary: "当前结构的核心感受是行业和单一标的暴露较集中，现金能够提供部分流动性缓冲。",
      dimensions: [
        {
          kind: "ASSET_ALLOCATION",
          title: "资产与现金",
          text: "股票承担主要风险暴露，现金为组合保留了可见的流动性空间。",
          evidenceRefs: ["portfolio.structure", "portfolio.cash"],
        },
        {
          kind: "CONCENTRATION",
          title: "头部集中",
          text: "组合结果对最大持仓和头部标的的变化较为敏感。",
          evidenceRefs: ["portfolio.concentration", "position.p0"],
        },
        {
          kind: "SECTOR_THEME",
          title: "行业暴露",
          text: "信息技术相关持仓构成当前最主要的行业暴露。",
          evidenceRefs: ["portfolio.data", "position.p0"],
        },
        {
          kind: "VEHICLE_OVERLAP",
          title: "工具与重叠",
          text: "当前持仓以单一股票为主，业务主题之间存在潜在联动。",
          evidenceRefs: ["portfolio.data", "position.p1"],
        },
        {
          kind: "PERFORMANCE_CONTRIBUTION",
          title: "收益与贡献",
          text: "累计结果为正，今日变化仍主要由头部持仓推动。",
          evidenceRefs: ["portfolio.performance", "portfolio.daily"],
        },
        {
          kind: "DATA_LIMITS",
          title: "数据边界",
          text: "当前快照能看结构和贡献，无法计算历史风险、估值或精确穿透。",
          evidenceRefs: ["portfolio.data"],
        },
      ],
      questions: [],
    },
    answer: null,
  };
}

export function followUpPortfolioConsultationRequest(): PortfolioConsultationRequest {
  return {
    ...initialPortfolioConsultationRequest(),
    generatedAt: "2026-08-15T07:05:00.000Z",
    mode: "FOLLOW_UP",
    priorClassifications: portfolioConsultationClassifications(),
    history: [
      { role: "user", content: "科技相关暴露主要来自哪里？" },
      {
        role: "assistant",
        content: "科技相关暴露来自已识别的信息技术持仓，本机证据会显示对应仓位。",
      },
    ],
    question: "现金对当前组合起到什么作用？",
  };
}

export function followUpPortfolioConsultationOutput(): PortfolioConsultationModelOutput {
  return {
    classifications: portfolioConsultationClassifications(),
    brief: null,
    answer: {
      text: "现金降低了组合对股票价格变化的即时敏感度，并保留了流动性选择空间。",
      evidenceRefs: ["portfolio.cash", "portfolio.structure"],
      frameworkLenses: ["OPPORTUNITY_COST", "TEMPERAMENT"],
      suggestedQuestions: ["当前行业集中最需要关注什么？"],
    },
  };
}

export function chatPortfolioConsultationRequest(): PortfolioConsultationRequest {
  return {
    ...initialPortfolioConsultationRequest(),
    generatedAt: "2026-08-15T07:10:00.000Z",
    mode: "CHAT",
    priorClassifications: null,
    history: [
      { role: "user", content: "当前组合最需要关注什么？" },
      {
        role: "assistant",
        content: "当前更值得关注头部持仓带来的结构敏感度。",
      },
    ],
    question: "现金在这个组合里起到什么作用？",
  };
}

export function chatPortfolioConsultationOutput(): PortfolioConsultationModelOutput {
  return {
    classifications: [],
    brief: null,
    answer: {
      text: "现金缓和了股票价格变化对总资产的即时影响，也保留了流动性选择空间。",
      evidenceRefs: ["portfolio.cash", "portfolio.structure"],
      frameworkLenses: ["OPPORTUNITY_COST", "TEMPERAMENT"],
      suggestedQuestions: [],
    },
  };
}
