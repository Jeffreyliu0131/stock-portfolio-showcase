import {
  PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
  parsePortfolioConsultationRequest,
  type PortfolioConsultationClassification,
  type PortfolioConsultationCompleteness,
  type PortfolioConsultationHistoryMessage,
  type PortfolioConsultationInstrumentType,
  type PortfolioConsultationMode,
  type PortfolioConsultationPortfolioContext,
  type PortfolioConsultationRequest,
  type PortfolioConsultationSector,
} from "../application/ai/portfolio-consultation-api.ts";
import {
  Decimal,
  canonicalDecimal,
  type PreciseDecimal,
} from "../domain/index.ts";
import type { PortfolioCopySource } from "./portfolio-copy-text.ts";
import type { PortfolioInsights } from "./portfolio-insights.ts";

export const PORTFOLIO_SECTOR_LABELS: Readonly<
  Record<PortfolioConsultationSector, string>
> = {
  ENERGY: "能源",
  MATERIALS: "原材料",
  INDUSTRIALS: "工业",
  CONSUMER_DISCRETIONARY: "非必需消费",
  CONSUMER_STAPLES: "必需消费",
  HEALTH_CARE: "医疗保健",
  FINANCIALS: "金融",
  INFORMATION_TECHNOLOGY: "信息技术",
  REAL_ESTATE: "房地产",
  COMMUNICATION_SERVICES: "通信服务",
  UTILITIES: "公用事业",
  DIVERSIFIED: "多行业",
  FIXED_INCOME: "固定收益",
  COMMODITY: "大宗商品",
  UNKNOWN: "待确认",
};

export const PORTFOLIO_INSTRUMENT_TYPE_LABELS: Readonly<
  Record<PortfolioConsultationInstrumentType, string>
> = {
  SINGLE_STOCK: "单一股票",
  BROAD_MARKET_ETF: "宽基 ETF",
  SECTOR_ETF: "行业 ETF",
  THEMATIC_ETF: "主题 ETF",
  FIXED_INCOME_ETF: "固定收益 ETF",
  COMMODITY_ETF: "商品 ETF",
  OTHER_FUND: "其他基金",
  UNKNOWN: "待确认工具",
};

export interface CreatePortfolioConsultationRequestOptions {
  readonly mode: PortfolioConsultationMode;
  readonly priorClassifications?: readonly PortfolioConsultationClassification[] | null;
  readonly history?: readonly PortfolioConsultationHistoryMessage[];
  readonly question?: string | null;
  readonly generatedAt?: string;
}

export interface PortfolioConsultationExposure<Key extends string> {
  readonly key: Key;
  readonly label: string;
  readonly assetWeight: string | null;
  readonly pricedPositionCount: number;
  readonly unpricedPositionCount: number;
  readonly symbols: readonly string[];
}

export interface PortfolioConsultationExposureSummary {
  readonly sectors: readonly PortfolioConsultationExposure<PortfolioConsultationSector>[];
  readonly instrumentTypes: readonly PortfolioConsultationExposure<PortfolioConsultationInstrumentType>[];
  readonly status: PortfolioConsultationCompleteness;
}

function canonical(value: PreciseDecimal): string {
  return canonicalDecimal(value);
}

function completeness(
  totalPositionCount: number,
  availablePositionCount: number,
): PortfolioConsultationCompleteness {
  return totalPositionCount === 0 || availablePositionCount === 0
    ? "UNAVAILABLE"
    : totalPositionCount === availablePositionCount
      ? "COMPLETE"
      : "PARTIAL";
}

function createPortfolioContext(
  source: PortfolioCopySource,
  insights: PortfolioInsights,
): PortfolioConsultationPortfolioContext {
  const structureByInstrument = new Map(
    insights.structure.positions.map((position) => [
      position.instrumentKey,
      position,
    ]),
  );
  const dailyByInstrument = new Map(
    insights.daily.contributions.map((contribution) => [
      contribution.instrumentKey,
      contribution,
    ]),
  );
  const positions = source.positions.map((position, index) => {
    const structure = structureByInstrument.get(position.instrumentKey);
    const daily = dailyByInstrument.get(position.instrumentKey);
    if (structure === undefined || daily === undefined) {
      throw new Error("portfolio consultation context is out of sync");
    }
    const { value } = position;
    const quote = value.quote;
    return {
      positionId: `p${index}`,
      symbol: value.instrument.symbol,
      name: position.name,
      listingMarket: value.instrument.listingMarket,
      currency: "USD" as const,
      marketRank: position.marketRank,
      quantity: value.quantity,
      averageCostUsd: value.averageCost,
      openCostUsd: value.openCost,
      valuationPriceUsd: value.valuationPrice,
      marketValueUsd: value.marketValue,
      unrealizedPnlUsd: value.unrealizedPnl,
      unrealizedReturn: value.unrealizedReturn,
      assetWeight: structure.assetWeight,
      estimatedDailyPriceEffectUsd: value.estimatedDailyPriceEffect,
      estimatedDailyChangeRate: value.estimatedDailyChangeRate,
      absoluteDailyContributionShare: daily.absoluteContributionShare,
      dailyStatus: daily.status,
      quote:
        quote === null
          ? null
          : {
              provider: quote.provider,
              feed: quote.feed,
              priceType: quote.effectivePriceType,
              sourceEventAt: quote.sourceEventAt,
              fetchedAt: quote.fetchedAt,
              marketSession: quote.marketSession,
              valuationStatus: quote.valuationStatus,
              usedLastValid: quote.usedLastValid,
            },
    };
  });

  const pricedOpenCost = new Decimal(source.summary.pricedOpenCost);
  const pricedUnrealizedPnl = new Decimal(
    source.summary.pricedUnrealizedPnl,
  );
  const hasAssetDenominator =
    insights.structure.totalPricedAssetsUsd !== null;
  const pricingStatus: PortfolioConsultationCompleteness =
    !hasAssetDenominator
      ? "UNAVAILABLE"
      : insights.structure.pricingComplete
        ? "COMPLETE"
        : "PARTIAL";

  return {
    currency: "USD",
    summary: {
      stockPositionCount: source.positions.length,
      pricedPositionCount: insights.structure.pricedPositionCount,
      unpricedPositionCount: insights.structure.unpricedPositionCount,
      pricingStatus,
      totalAssetsUsd: insights.structure.totalPricedAssetsUsd,
      stockMarketValueUsd: source.summary.pricedMarketValue,
      portfolioOpenCostUsd: source.summary.portfolioOpenCost,
      pricedOpenCostUsd: source.summary.pricedOpenCost,
      unpricedOpenCostUsd: source.summary.unpricedOpenCost,
      pricedUnrealizedPnlUsd: source.summary.pricedUnrealizedPnl,
      pricedUnrealizedReturn: pricedOpenCost.isZero()
        ? null
        : canonical(pricedUnrealizedPnl.div(pricedOpenCost)),
      cashBalanceUsd: source.cash?.totalBalance ?? null,
      cashWeight: insights.structure.cash?.assetWeight ?? null,
      top1Weight: insights.structure.concentration.top1?.assetWeight ?? null,
      top3Weight: insights.structure.concentration.top3?.assetWeight ?? null,
      top5Weight: insights.structure.concentration.top5?.assetWeight ?? null,
      dailyStatus: insights.daily.status,
      dailyCalculablePositionCount: insights.daily.calculablePositionCount,
      dailyNetEffectUsd: insights.daily.netEffectUsd,
      dailyAbsoluteEffectUsd: insights.daily.calculableAbsoluteEffectUsd,
    },
    positions,
    cash:
      source.cash === null
        ? null
        : {
            provider: "PORTFOLIO",
            currency: "USD",
            balanceUsd: source.cash.totalBalance,
            accounts: source.cash.accounts.map((account) => ({
              provider: account.broker,
              balanceUsd: account.balance,
              settledBalanceUsd: account.settledBalance,
              pendingBalanceUsd: account.pendingBalance,
            })),
            ibkrInterest:
              source.cash.ibkrInterest === null
                ? null
                : {
                    netAssetValueUsd:
                      source.cash.ibkrInterest.snapshot.account.netAssetValue,
                    navSource:
                      source.cash.ibkrInterest.snapshot.account.navSource,
                    pricingPlan:
                      source.cash.ibkrInterest.snapshot.account.pricingPlan,
                    interestBearingBalanceUsd:
                      source.cash.ibkrInterest.estimate.interestBearingBalance,
                    blendedAnnualRate:
                      source.cash.ibkrInterest.estimate.blendedAnnualRate,
                    estimatedAnnualInterestUsd:
                      source.cash.ibkrInterest.estimate.estimatedAnnualInterest,
                    estimatedMonthlyInterestUsd:
                      source.cash.ibkrInterest.estimate.estimatedMonthlyInterest,
                  },
          },
    quoteContext: {
      delay: "APPROXIMATELY_15_MINUTES",
      oldestSourceEventAt: source.summary.oldestSourceEventAt,
      oldestFetchedAt: source.summary.oldestFetchedAt,
    },
  };
}

export function createPortfolioConsultationRequest(
  source: PortfolioCopySource,
  insights: PortfolioInsights,
  options: CreatePortfolioConsultationRequestOptions,
): PortfolioConsultationRequest {
  const request: PortfolioConsultationRequest = {
    kind: "PORTFOLIO_CONSULTATION",
    schemaVersion: PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    locale: "zh-CN",
    mode: options.mode,
    portfolio: createPortfolioContext(source, insights),
    priorClassifications: options.priorClassifications ?? null,
    history: options.history ?? [],
    question: options.question ?? null,
  };
  const parsed = parsePortfolioConsultationRequest(request);
  if (parsed === null) {
    throw new Error("generated portfolio consultation context is invalid");
  }
  return parsed;
}

export function createPortfolioConsultationFollowUpRequest(
  initialRequest: PortfolioConsultationRequest,
  priorClassifications: readonly PortfolioConsultationClassification[],
  history: readonly PortfolioConsultationHistoryMessage[],
  question: string,
  generatedAt: string = new Date().toISOString(),
): PortfolioConsultationRequest {
  const request: PortfolioConsultationRequest = {
    ...initialRequest,
    generatedAt,
    mode: "FOLLOW_UP",
    portfolio: initialRequest.portfolio,
    priorClassifications,
    history,
    question,
  };
  const parsed = parsePortfolioConsultationRequest(request);
  if (parsed === null) {
    throw new Error("generated portfolio consultation follow-up is invalid");
  }
  return parsed;
}

export function createPortfolioConsultationChatTurnRequest(
  initialRequest: PortfolioConsultationRequest,
  history: readonly PortfolioConsultationHistoryMessage[],
  question: string,
  generatedAt: string = new Date().toISOString(),
): PortfolioConsultationRequest {
  const request: PortfolioConsultationRequest = {
    ...initialRequest,
    generatedAt,
    mode: "CHAT",
    portfolio: initialRequest.portfolio,
    priorClassifications: null,
    history,
    question,
  };
  const parsed = parsePortfolioConsultationRequest(request);
  if (parsed === null) {
    throw new Error("generated portfolio consultation chat turn is invalid");
  }
  return parsed;
}

interface MutableExposure<Key extends string> {
  readonly key: Key;
  readonly label: string;
  weight: PreciseDecimal;
  pricedPositionCount: number;
  unpricedPositionCount: number;
  readonly symbols: string[];
}

function aggregateExposure<Key extends string>(
  portfolio: PortfolioConsultationPortfolioContext,
  classifications: readonly PortfolioConsultationClassification[],
  keyForClassification: (classification: PortfolioConsultationClassification) => Key,
  labelForKey: (key: Key) => string,
): readonly PortfolioConsultationExposure<Key>[] {
  const positionsById = new Map(
    portfolio.positions.map((position) => [position.positionId, position]),
  );
  const grouped = new Map<Key, MutableExposure<Key>>();
  for (const classification of classifications) {
    const position = positionsById.get(classification.positionId);
    if (position === undefined || position.symbol !== classification.symbol) {
      throw new Error("AI classification does not match the current portfolio");
    }
    const key = keyForClassification(classification);
    const current = grouped.get(key) ?? {
      key,
      label: labelForKey(key),
      weight: new Decimal(0),
      pricedPositionCount: 0,
      unpricedPositionCount: 0,
      symbols: [],
    };
    if (position.assetWeight === null) {
      current.unpricedPositionCount += 1;
    } else {
      current.weight = current.weight.add(position.assetWeight);
      current.pricedPositionCount += 1;
    }
    current.symbols.push(position.symbol);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((entry): PortfolioConsultationExposure<Key> => ({
      key: entry.key,
      label: entry.label,
      assetWeight:
        entry.pricedPositionCount === 0 ? null : canonical(entry.weight),
      pricedPositionCount: entry.pricedPositionCount,
      unpricedPositionCount: entry.unpricedPositionCount,
      symbols: entry.symbols,
    }))
    .toSorted((left, right) => {
      if (left.assetWeight === null) {
        return right.assetWeight === null
          ? left.label.localeCompare(right.label, "zh-CN")
          : 1;
      }
      if (right.assetWeight === null) {
        return -1;
      }
      const weightOrder = new Decimal(right.assetWeight).comparedTo(
        left.assetWeight,
      );
      return weightOrder === 0
        ? left.label.localeCompare(right.label, "zh-CN")
        : weightOrder;
    });
}

export function summarizePortfolioConsultationExposures(
  portfolio: PortfolioConsultationPortfolioContext,
  classifications: readonly PortfolioConsultationClassification[],
): PortfolioConsultationExposureSummary {
  if (classifications.length !== portfolio.positions.length) {
    throw new Error("AI classification coverage is incomplete");
  }
  const pricedPositionCount = portfolio.positions.filter(
    (position) => position.assetWeight !== null,
  ).length;
  return {
    sectors: aggregateExposure(
      portfolio,
      classifications,
      (classification) => classification.sector,
      (sector) => PORTFOLIO_SECTOR_LABELS[sector],
    ),
    instrumentTypes: aggregateExposure(
      portfolio,
      classifications,
      (classification) => classification.instrumentType,
      (instrumentType) => PORTFOLIO_INSTRUMENT_TYPE_LABELS[instrumentType],
    ),
    status: completeness(portfolio.positions.length, pricedPositionCount),
  };
}
