import { Decimal, rfc3339ToEpochNanoseconds } from "../../domain/index.ts";
import {
  VALUE_INVESTING_FRAMEWORK_LENSES,
  type ValueInvestingFrameworkLens,
} from "./value-investing-framework.ts";

export const PORTFOLIO_CONSULTATION_SCHEMA_VERSION = 4 as const;
export const PORTFOLIO_CONSULTATION_PROMPT_VERSION =
  "portfolio-value-advisor-v4" as const;
export const MAX_PORTFOLIO_CONSULTATION_POSITIONS = 100;
export const MAX_PORTFOLIO_CONSULTATION_HISTORY_MESSAGES = 12;
export const MAX_PORTFOLIO_CONSULTATION_QUESTION_CHARS = 1_200;

export type PortfolioConsultationMode =
  | "INITIAL_ANALYSIS"
  | "FOLLOW_UP"
  | "CHAT";

export type PortfolioConsultationCompleteness =
  | "COMPLETE"
  | "PARTIAL"
  | "UNAVAILABLE";

export type PortfolioConsultationDailyStatus =
  | "AVAILABLE"
  | "MISSING_PRICE"
  | "MISSING_PREVIOUS_CLOSE";

export type PortfolioConsultationInstrumentType =
  | "SINGLE_STOCK"
  | "BROAD_MARKET_ETF"
  | "SECTOR_ETF"
  | "THEMATIC_ETF"
  | "FIXED_INCOME_ETF"
  | "COMMODITY_ETF"
  | "OTHER_FUND"
  | "UNKNOWN";

export type PortfolioConsultationSector =
  | "ENERGY"
  | "MATERIALS"
  | "INDUSTRIALS"
  | "CONSUMER_DISCRETIONARY"
  | "CONSUMER_STAPLES"
  | "HEALTH_CARE"
  | "FINANCIALS"
  | "INFORMATION_TECHNOLOGY"
  | "REAL_ESTATE"
  | "COMMUNICATION_SERVICES"
  | "UTILITIES"
  | "DIVERSIFIED"
  | "FIXED_INCOME"
  | "COMMODITY"
  | "UNKNOWN";

export type PortfolioConsultationConfidence = "HIGH" | "MEDIUM" | "LOW";

export type PortfolioConsultationDimensionKind =
  | "ASSET_ALLOCATION"
  | "CONCENTRATION"
  | "SECTOR_THEME"
  | "VEHICLE_OVERLAP"
  | "PERFORMANCE_CONTRIBUTION"
  | "DATA_LIMITS";

export const PORTFOLIO_CONSULTATION_INSTRUMENT_TYPES = [
  "SINGLE_STOCK",
  "BROAD_MARKET_ETF",
  "SECTOR_ETF",
  "THEMATIC_ETF",
  "FIXED_INCOME_ETF",
  "COMMODITY_ETF",
  "OTHER_FUND",
  "UNKNOWN",
] as const satisfies readonly PortfolioConsultationInstrumentType[];

export const PORTFOLIO_CONSULTATION_SECTORS = [
  "ENERGY",
  "MATERIALS",
  "INDUSTRIALS",
  "CONSUMER_DISCRETIONARY",
  "CONSUMER_STAPLES",
  "HEALTH_CARE",
  "FINANCIALS",
  "INFORMATION_TECHNOLOGY",
  "REAL_ESTATE",
  "COMMUNICATION_SERVICES",
  "UTILITIES",
  "DIVERSIFIED",
  "FIXED_INCOME",
  "COMMODITY",
  "UNKNOWN",
] as const satisfies readonly PortfolioConsultationSector[];

export const PORTFOLIO_CONSULTATION_CONFIDENCES = [
  "HIGH",
  "MEDIUM",
  "LOW",
] as const satisfies readonly PortfolioConsultationConfidence[];

export const PORTFOLIO_CONSULTATION_DIMENSION_KINDS = [
  "ASSET_ALLOCATION",
  "CONCENTRATION",
  "SECTOR_THEME",
  "VEHICLE_OVERLAP",
  "PERFORMANCE_CONTRIBUTION",
  "DATA_LIMITS",
] as const satisfies readonly PortfolioConsultationDimensionKind[];

export interface PortfolioConsultationPositionQuote {
  readonly provider: string | null;
  readonly feed: string | null;
  readonly priceType: string | null;
  readonly sourceEventAt: string | null;
  readonly fetchedAt: string | null;
  readonly marketSession: string;
  readonly valuationStatus: string;
  readonly usedLastValid: boolean;
}

export interface PortfolioConsultationPositionContext {
  readonly positionId: string;
  readonly symbol: string;
  readonly name: string;
  readonly listingMarket: string;
  readonly currency: "USD";
  readonly marketRank: number | null;
  readonly quantity: string;
  readonly averageCostUsd: string;
  readonly openCostUsd: string;
  readonly valuationPriceUsd: string | null;
  readonly marketValueUsd: string | null;
  readonly unrealizedPnlUsd: string | null;
  readonly unrealizedReturn: string | null;
  readonly assetWeight: string | null;
  readonly estimatedDailyPriceEffectUsd: string | null;
  readonly estimatedDailyChangeRate: string | null;
  readonly absoluteDailyContributionShare: string | null;
  readonly dailyStatus: PortfolioConsultationDailyStatus;
  readonly quote: PortfolioConsultationPositionQuote | null;
}

export interface PortfolioConsultationCashAccountContext {
  readonly provider: "IBKR" | "MOOMOO";
  readonly balanceUsd: string;
  readonly settledBalanceUsd: string;
  readonly pendingBalanceUsd: string;
}

export interface PortfolioConsultationIbkrInterestContext {
  readonly netAssetValueUsd: string;
  readonly navSource: "USER_ENTERED" | "CASH_BALANCE_FALLBACK";
  readonly pricingPlan: "IBKR_PRO" | "IBKR_LITE";
  readonly interestBearingBalanceUsd: string;
  readonly blendedAnnualRate: string;
  readonly estimatedAnnualInterestUsd: string;
  readonly estimatedMonthlyInterestUsd: string;
}

export interface PortfolioConsultationCashContext {
  readonly provider: "PORTFOLIO";
  readonly currency: "USD";
  readonly balanceUsd: string;
  readonly accounts: readonly PortfolioConsultationCashAccountContext[];
  readonly ibkrInterest: PortfolioConsultationIbkrInterestContext | null;
}

export interface PortfolioConsultationSummaryContext {
  readonly stockPositionCount: number;
  readonly pricedPositionCount: number;
  readonly unpricedPositionCount: number;
  readonly pricingStatus: PortfolioConsultationCompleteness;
  readonly totalAssetsUsd: string | null;
  readonly stockMarketValueUsd: string;
  readonly portfolioOpenCostUsd: string;
  readonly pricedOpenCostUsd: string;
  readonly unpricedOpenCostUsd: string;
  readonly pricedUnrealizedPnlUsd: string;
  readonly pricedUnrealizedReturn: string | null;
  readonly cashBalanceUsd: string | null;
  readonly cashWeight: string | null;
  readonly top1Weight: string | null;
  readonly top3Weight: string | null;
  readonly top5Weight: string | null;
  readonly dailyStatus: PortfolioConsultationCompleteness;
  readonly dailyCalculablePositionCount: number;
  readonly dailyNetEffectUsd: string | null;
  readonly dailyAbsoluteEffectUsd: string | null;
}

export interface PortfolioConsultationQuoteContext {
  readonly delay: "APPROXIMATELY_15_MINUTES";
  readonly oldestSourceEventAt: string | null;
  readonly oldestFetchedAt: string | null;
}

export interface PortfolioConsultationPortfolioContext {
  readonly currency: "USD";
  readonly summary: PortfolioConsultationSummaryContext;
  readonly positions: readonly PortfolioConsultationPositionContext[];
  readonly cash: PortfolioConsultationCashContext | null;
  readonly quoteContext: PortfolioConsultationQuoteContext;
}

export interface PortfolioConsultationHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface PortfolioConsultationRequest {
  readonly kind: "PORTFOLIO_CONSULTATION";
  readonly schemaVersion: typeof PORTFOLIO_CONSULTATION_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly locale: "zh-CN";
  readonly mode: PortfolioConsultationMode;
  readonly portfolio: PortfolioConsultationPortfolioContext;
  readonly priorClassifications: readonly PortfolioConsultationClassification[] | null;
  readonly history: readonly PortfolioConsultationHistoryMessage[];
  readonly question: string | null;
}

export interface PortfolioConsultationClassification {
  readonly positionId: string;
  readonly symbol: string;
  readonly basis: "AI_INFERRED";
  readonly instrumentType: PortfolioConsultationInstrumentType;
  readonly sector: PortfolioConsultationSector;
  readonly themes: readonly string[];
  readonly confidence: PortfolioConsultationConfidence;
  readonly rationale: string;
}

export interface PortfolioConsultationDimension {
  readonly kind: PortfolioConsultationDimensionKind;
  readonly title: string;
  readonly text: string;
  readonly evidenceRefs: readonly string[];
}

export interface PortfolioConsultationBrief {
  readonly headline: string;
  readonly summary: string;
  readonly dimensions: readonly PortfolioConsultationDimension[];
  readonly questions: readonly string[];
}

export interface PortfolioConsultationAnswer {
  readonly text: string;
  readonly evidenceRefs: readonly string[];
  readonly frameworkLenses: readonly ValueInvestingFrameworkLens[];
  readonly suggestedQuestions: readonly string[];
}

export interface PortfolioConsultationModelOutput {
  readonly classifications: readonly PortfolioConsultationClassification[];
  readonly brief: PortfolioConsultationBrief | null;
  readonly answer: PortfolioConsultationAnswer | null;
}

export interface PortfolioConsultationSuccess
  extends PortfolioConsultationModelOutput {
  readonly kind: "PORTFOLIO_CONSULTATION_RESULT";
  readonly schemaVersion: typeof PORTFOLIO_CONSULTATION_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly model: string;
  readonly promptVersion: typeof PORTFOLIO_CONSULTATION_PROMPT_VERSION;
  readonly mode: PortfolioConsultationMode;
}

export type PortfolioConsultationApiErrorCode =
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "AI_NOT_CONFIGURED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "INVALID_MODEL_OUTPUT";

export interface PortfolioConsultationApiError {
  readonly kind: "ERROR";
  readonly code: PortfolioConsultationApiErrorCode;
  readonly message: string;
}

export type PortfolioConsultationApiResponse =
  | PortfolioConsultationSuccess
  | PortfolioConsultationApiError;

const REQUEST_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "locale",
  "mode",
  "portfolio",
  "priorClassifications",
  "history",
  "question",
] as const;
const PORTFOLIO_KEYS = [
  "currency",
  "summary",
  "positions",
  "cash",
  "quoteContext",
] as const;
const SUMMARY_KEYS = [
  "stockPositionCount",
  "pricedPositionCount",
  "unpricedPositionCount",
  "pricingStatus",
  "totalAssetsUsd",
  "stockMarketValueUsd",
  "portfolioOpenCostUsd",
  "pricedOpenCostUsd",
  "unpricedOpenCostUsd",
  "pricedUnrealizedPnlUsd",
  "pricedUnrealizedReturn",
  "cashBalanceUsd",
  "cashWeight",
  "top1Weight",
  "top3Weight",
  "top5Weight",
  "dailyStatus",
  "dailyCalculablePositionCount",
  "dailyNetEffectUsd",
  "dailyAbsoluteEffectUsd",
] as const;
const POSITION_KEYS = [
  "positionId",
  "symbol",
  "name",
  "listingMarket",
  "currency",
  "marketRank",
  "quantity",
  "averageCostUsd",
  "openCostUsd",
  "valuationPriceUsd",
  "marketValueUsd",
  "unrealizedPnlUsd",
  "unrealizedReturn",
  "assetWeight",
  "estimatedDailyPriceEffectUsd",
  "estimatedDailyChangeRate",
  "absoluteDailyContributionShare",
  "dailyStatus",
  "quote",
] as const;
const QUOTE_KEYS = [
  "provider",
  "feed",
  "priceType",
  "sourceEventAt",
  "fetchedAt",
  "marketSession",
  "valuationStatus",
  "usedLastValid",
] as const;
const CASH_KEYS = [
  "provider",
  "currency",
  "balanceUsd",
  "accounts",
  "ibkrInterest",
] as const;
const CASH_ACCOUNT_KEYS = [
  "provider",
  "balanceUsd",
  "settledBalanceUsd",
  "pendingBalanceUsd",
] as const;
const IBKR_INTEREST_KEYS = [
  "netAssetValueUsd",
  "navSource",
  "pricingPlan",
  "interestBearingBalanceUsd",
  "blendedAnnualRate",
  "estimatedAnnualInterestUsd",
  "estimatedMonthlyInterestUsd",
] as const;
const QUOTE_CONTEXT_KEYS = [
  "delay",
  "oldestSourceEventAt",
  "oldestFetchedAt",
] as const;
const HISTORY_KEYS = ["role", "content"] as const;
const MODEL_OUTPUT_KEYS = ["classifications", "brief", "answer"] as const;
const CLASSIFICATION_KEYS = [
  "positionId",
  "symbol",
  "basis",
  "instrumentType",
  "sector",
  "themes",
  "confidence",
  "rationale",
] as const;
const BRIEF_KEYS = ["headline", "summary", "dimensions", "questions"] as const;
const DIMENSION_KEYS = ["kind", "title", "text", "evidenceRefs"] as const;
const ANSWER_KEYS = [
  "text",
  "evidenceRefs",
  "frameworkLenses",
  "suggestedQuestions",
] as const;
const SUCCESS_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "model",
  "promptVersion",
  "mode",
  "classifications",
  "brief",
  "answer",
] as const;
const ERROR_KEYS = ["kind", "code", "message"] as const;

const PLAIN_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const POSITION_ID_PATTERN = /^p(?:0|[1-9]\d{0,2})$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,19}$/;
const MARKET_PATTERN = /^[A-Z0-9._-]{1,20}$/;
const SAFE_EVIDENCE_REF_PATTERN =
  /^(?:portfolio\.(?:structure|concentration|performance|daily|cash|data)|position\.p(?:0|[1-9]\d{0,2})|sector\.[A-Z_]+|role\.[A-Z_]+)$/;
const FORBIDDEN_GENERATED_NUMBER_PATTERN =
  /[0-9０-９%％$¥￥€£]|(?:百分之|千分之|万分之)[零〇一二两三四五六七八九十百千万亿]+|(?:第|前)[零〇一二两三四五六七八九十百千万亿]+/u;
const FORBIDDEN_GENERATED_CLAIM_PATTERN =
  /(买入|卖出|增持|减持|加仓|减仓|清仓|建仓|换仓|调仓|抄底|止盈|止损|做多|做空|提高仓位|降低仓位|增加仓位|减少仓位|目标价|保证收益|必涨|必跌|推荐股票|行情预测|预测涨跌|预计上涨|预计下跌|新闻显示|财报显示|实时消息|实时数据|最新消息|我是巴菲特|作为巴菲特|代表巴菲特|巴菲特本人|巴菲特会说|巴菲特会做|巴菲特认为|伯克希尔官方|伯克希尔认为|I am Warren Buffett|As Warren Buffett|Warren Buffett would|Berkshire Hathaway official)/iu;
const URL_PATTERN = /(?:https?:\/\/|www\.)/iu;

const INSTRUMENT_TYPES = new Set<PortfolioConsultationInstrumentType>(
  PORTFOLIO_CONSULTATION_INSTRUMENT_TYPES,
);
const SECTORS = new Set<PortfolioConsultationSector>(
  PORTFOLIO_CONSULTATION_SECTORS,
);
const DIMENSION_KINDS = new Set<PortfolioConsultationDimensionKind>(
  PORTFOLIO_CONSULTATION_DIMENSION_KINDS,
);
const FRAMEWORK_LENSES = new Set<ValueInvestingFrameworkLens>(
  VALUE_INVESTING_FRAMEWORK_LENSES,
);
const FUNDAMENTAL_LENSES_REQUIRING_EVIDENCE_GAP = new Set<ValueInvestingFrameworkLens>([
  "DURABLE_BUSINESS",
  "MANAGEMENT_CAPITAL_ALLOCATION",
  "OWNER_EARNINGS",
  "FINANCIAL_STRENGTH",
  "INTRINSIC_VALUE_MARGIN_OF_SAFETY",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(record).toSorted();
  const expectedKeys = [...expected].toSorted();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    rfc3339ToEpochNanoseconds(value, "portfolioConsultation.timestamp");
    return true;
  } catch {
    return false;
  }
}

function isNullableRfc3339(value: unknown): value is string | null {
  return value === null || isRfc3339(value);
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function decimal(
  value: unknown,
  constraint: "SIGNED" | "NON_NEGATIVE" | "POSITIVE" | "FRACTION",
): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    !PLAIN_DECIMAL_PATTERN.test(value) ||
    value === "-0"
  ) {
    return false;
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) {
    return false;
  }
  switch (constraint) {
    case "SIGNED":
      return true;
    case "NON_NEGATIVE":
      return parsed.gte(0);
    case "POSITIVE":
      return parsed.gt(0);
    case "FRACTION":
      return parsed.gte(0) && parsed.lte(1);
  }
}

function nullableDecimal(
  value: unknown,
  constraint: "SIGNED" | "NON_NEGATIVE" | "POSITIVE" | "FRACTION",
): value is string | null {
  return value === null || decimal(value, constraint);
}

function completeness(
  value: unknown,
): value is PortfolioConsultationCompleteness {
  return value === "COMPLETE" || value === "PARTIAL" || value === "UNAVAILABLE";
}

function safeSourceLabel(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value === value.trim() &&
      value.length >= 1 &&
      value.length <= 80 &&
      !/[\u0000-\u001f\u007f]/u.test(value))
  );
}

function safeName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    [...value].length >= 1 &&
    [...value].length <= 160 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseQuote(value: unknown): PortfolioConsultationPositionQuote | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, QUOTE_KEYS) ||
    !safeSourceLabel(value.provider) ||
    !safeSourceLabel(value.feed) ||
    !safeSourceLabel(value.priceType) ||
    !isNullableRfc3339(value.sourceEventAt) ||
    !isNullableRfc3339(value.fetchedAt) ||
    !safeSourceLabel(value.marketSession) ||
    value.marketSession === null ||
    !safeSourceLabel(value.valuationStatus) ||
    value.valuationStatus === null ||
    typeof value.usedLastValid !== "boolean"
  ) {
    return undefined;
  }
  return value as unknown as PortfolioConsultationPositionQuote;
}

function parsePosition(
  value: unknown,
): PortfolioConsultationPositionContext | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, POSITION_KEYS) ||
    typeof value.positionId !== "string" ||
    !POSITION_ID_PATTERN.test(value.positionId) ||
    typeof value.symbol !== "string" ||
    !SYMBOL_PATTERN.test(value.symbol) ||
    !safeName(value.name) ||
    typeof value.listingMarket !== "string" ||
    !MARKET_PATTERN.test(value.listingMarket) ||
    value.currency !== "USD" ||
    (value.marketRank !== null &&
      !isSafeIntegerInRange(value.marketRank, 1, MAX_PORTFOLIO_CONSULTATION_POSITIONS)) ||
    !decimal(value.quantity, "POSITIVE") ||
    !decimal(value.averageCostUsd, "NON_NEGATIVE") ||
    !decimal(value.openCostUsd, "NON_NEGATIVE") ||
    !nullableDecimal(value.valuationPriceUsd, "POSITIVE") ||
    !nullableDecimal(value.marketValueUsd, "NON_NEGATIVE") ||
    !nullableDecimal(value.unrealizedPnlUsd, "SIGNED") ||
    !nullableDecimal(value.unrealizedReturn, "SIGNED") ||
    !nullableDecimal(value.assetWeight, "SIGNED") ||
    !nullableDecimal(value.estimatedDailyPriceEffectUsd, "SIGNED") ||
    !nullableDecimal(value.estimatedDailyChangeRate, "SIGNED") ||
    !nullableDecimal(value.absoluteDailyContributionShare, "FRACTION") ||
    (value.dailyStatus !== "AVAILABLE" &&
      value.dailyStatus !== "MISSING_PRICE" &&
      value.dailyStatus !== "MISSING_PREVIOUS_CLOSE")
  ) {
    return null;
  }
  const quote = parseQuote(value.quote);
  if (quote === undefined) {
    return null;
  }
  const isPriced = value.marketValueUsd !== null;
  if (
    isPriced !== (value.valuationPriceUsd !== null) ||
    isPriced !== (value.unrealizedPnlUsd !== null) ||
    isPriced !== (value.assetWeight !== null) ||
    (!isPriced && (value.unrealizedReturn !== null || value.marketRank !== null)) ||
    (value.dailyStatus === "AVAILABLE") !==
      (value.estimatedDailyPriceEffectUsd !== null &&
        value.estimatedDailyChangeRate !== null) ||
    (value.dailyStatus === "MISSING_PRICE" && isPriced) ||
    (value.dailyStatus !== "AVAILABLE" &&
      value.absoluteDailyContributionShare !== null)
  ) {
    return null;
  }
  return {
    ...(value as unknown as PortfolioConsultationPositionContext),
    quote,
  };
}

function parseCash(value: unknown): PortfolioConsultationCashContext | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, CASH_KEYS) ||
    value.provider !== "PORTFOLIO" ||
    value.currency !== "USD" ||
    !decimal(value.balanceUsd, "SIGNED") ||
    !Array.isArray(value.accounts) ||
    value.accounts.length < 1 ||
    value.accounts.length > 2
  ) {
    return undefined;
  }
  const accounts: PortfolioConsultationCashAccountContext[] = [];
  const providers = new Set<string>();
  for (const account of value.accounts) {
    if (
      !isRecord(account) ||
      !hasExactKeys(account, CASH_ACCOUNT_KEYS) ||
      (account.provider !== "IBKR" && account.provider !== "MOOMOO") ||
      providers.has(account.provider) ||
      !decimal(account.balanceUsd, "SIGNED") ||
      !decimal(account.settledBalanceUsd, "SIGNED") ||
      !decimal(account.pendingBalanceUsd, "SIGNED") ||
      !new Decimal(account.settledBalanceUsd)
        .add(account.pendingBalanceUsd)
        .eq(account.balanceUsd)
    ) {
      return undefined;
    }
    providers.add(account.provider);
    accounts.push(account as unknown as PortfolioConsultationCashAccountContext);
  }
  const accountTotal = accounts.reduce(
    (total, account) => total.add(account.balanceUsd),
    new Decimal(0),
  );
  if (!accountTotal.eq(value.balanceUsd)) {
    return undefined;
  }
  let ibkrInterest: PortfolioConsultationIbkrInterestContext | null = null;
  if (value.ibkrInterest !== null) {
    if (
      !isRecord(value.ibkrInterest) ||
      !hasExactKeys(value.ibkrInterest, IBKR_INTEREST_KEYS) ||
      !providers.has("IBKR") ||
      !decimal(value.ibkrInterest.netAssetValueUsd, "POSITIVE") ||
      (value.ibkrInterest.navSource !== "USER_ENTERED" &&
        value.ibkrInterest.navSource !== "CASH_BALANCE_FALLBACK") ||
      (value.ibkrInterest.pricingPlan !== "IBKR_PRO" &&
        value.ibkrInterest.pricingPlan !== "IBKR_LITE") ||
      !decimal(value.ibkrInterest.interestBearingBalanceUsd, "NON_NEGATIVE") ||
      !decimal(value.ibkrInterest.blendedAnnualRate, "FRACTION") ||
      !decimal(value.ibkrInterest.estimatedAnnualInterestUsd, "NON_NEGATIVE") ||
      !decimal(value.ibkrInterest.estimatedMonthlyInterestUsd, "NON_NEGATIVE")
    ) {
      return undefined;
    }
    const ibkr = accounts.find((account) => account.provider === "IBKR")!;
    if (
      value.ibkrInterest.navSource === "CASH_BALANCE_FALLBACK" &&
      !new Decimal(value.ibkrInterest.netAssetValueUsd).eq(
        Decimal.max(new Decimal(ibkr.settledBalanceUsd), 0),
      )
    ) {
      return undefined;
    }
    ibkrInterest =
      value.ibkrInterest as unknown as PortfolioConsultationIbkrInterestContext;
  }
  return {
    provider: "PORTFOLIO",
    currency: "USD",
    balanceUsd: value.balanceUsd,
    accounts,
    ibkrInterest,
  };
}

function parseSummary(value: unknown): PortfolioConsultationSummaryContext | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, SUMMARY_KEYS) ||
    !isSafeIntegerInRange(value.stockPositionCount, 0, MAX_PORTFOLIO_CONSULTATION_POSITIONS) ||
    !isSafeIntegerInRange(value.pricedPositionCount, 0, MAX_PORTFOLIO_CONSULTATION_POSITIONS) ||
    !isSafeIntegerInRange(value.unpricedPositionCount, 0, MAX_PORTFOLIO_CONSULTATION_POSITIONS) ||
    !completeness(value.pricingStatus) ||
    !nullableDecimal(value.totalAssetsUsd, "SIGNED") ||
    !decimal(value.stockMarketValueUsd, "NON_NEGATIVE") ||
    !decimal(value.portfolioOpenCostUsd, "NON_NEGATIVE") ||
    !decimal(value.pricedOpenCostUsd, "NON_NEGATIVE") ||
    !decimal(value.unpricedOpenCostUsd, "NON_NEGATIVE") ||
    !decimal(value.pricedUnrealizedPnlUsd, "SIGNED") ||
    !nullableDecimal(value.pricedUnrealizedReturn, "SIGNED") ||
    !nullableDecimal(value.cashBalanceUsd, "SIGNED") ||
    !nullableDecimal(value.cashWeight, "SIGNED") ||
    !nullableDecimal(value.top1Weight, "SIGNED") ||
    !nullableDecimal(value.top3Weight, "SIGNED") ||
    !nullableDecimal(value.top5Weight, "SIGNED") ||
    !completeness(value.dailyStatus) ||
    !isSafeIntegerInRange(
      value.dailyCalculablePositionCount,
      0,
      MAX_PORTFOLIO_CONSULTATION_POSITIONS,
    ) ||
    !nullableDecimal(value.dailyNetEffectUsd, "SIGNED") ||
    !nullableDecimal(value.dailyAbsoluteEffectUsd, "NON_NEGATIVE")
  ) {
    return null;
  }
  return value as unknown as PortfolioConsultationSummaryContext;
}

function contextsAreConsistent(
  summary: PortfolioConsultationSummaryContext,
  positions: readonly PortfolioConsultationPositionContext[],
  cash: PortfolioConsultationCashContext | null,
): boolean {
  const priced = positions.filter((position) => position.marketValueUsd !== null);
  const unpriced = positions.filter((position) => position.marketValueUsd === null);
  const dailyAvailable = positions.filter(
    (position) => position.dailyStatus === "AVAILABLE",
  );
  if (
    summary.stockPositionCount !== positions.length ||
    summary.pricedPositionCount !== priced.length ||
    summary.unpricedPositionCount !== unpriced.length ||
    summary.dailyCalculablePositionCount !== dailyAvailable.length ||
    (cash === null) !== (summary.cashBalanceUsd === null) ||
    (cash === null && summary.cashWeight !== null)
  ) {
    return false;
  }

  const stockMarketValue = priced.reduce(
    (total, position) => total.add(position.marketValueUsd ?? "0"),
    new Decimal(0),
  );
  const portfolioOpenCost = positions.reduce(
    (total, position) => total.add(position.openCostUsd),
    new Decimal(0),
  );
  const pricedOpenCost = priced.reduce(
    (total, position) => total.add(position.openCostUsd),
    new Decimal(0),
  );
  const unpricedOpenCost = unpriced.reduce(
    (total, position) => total.add(position.openCostUsd),
    new Decimal(0),
  );
  const pricedPnl = priced.reduce(
    (total, position) => total.add(position.unrealizedPnlUsd ?? "0"),
    new Decimal(0),
  );
  const totalAssets = stockMarketValue.add(cash?.balanceUsd ?? "0");
  const hasAssetDenominator = priced.length > 0 || cash !== null;
  if (
    !stockMarketValue.eq(summary.stockMarketValueUsd) ||
    !portfolioOpenCost.eq(summary.portfolioOpenCostUsd) ||
    !pricedOpenCost.eq(summary.pricedOpenCostUsd) ||
    !unpricedOpenCost.eq(summary.unpricedOpenCostUsd) ||
    !pricedPnl.eq(summary.pricedUnrealizedPnlUsd) ||
    (hasAssetDenominator
      ? summary.totalAssetsUsd === null || !totalAssets.eq(summary.totalAssetsUsd)
      : summary.totalAssetsUsd !== null) ||
    (cash !== null && !new Decimal(cash.balanceUsd).eq(summary.cashBalanceUsd ?? "0"))
  ) {
    return false;
  }

  const expectedPricingStatus: PortfolioConsultationCompleteness =
    hasAssetDenominator
      ? unpriced.length === 0
        ? "COMPLETE"
        : "PARTIAL"
      : "UNAVAILABLE";
  const expectedDailyStatus: PortfolioConsultationCompleteness =
    positions.length === 0 || dailyAvailable.length === 0
      ? "UNAVAILABLE"
      : dailyAvailable.length === positions.length
        ? "COMPLETE"
        : "PARTIAL";
  if (
    summary.pricingStatus !== expectedPricingStatus ||
    summary.dailyStatus !== expectedDailyStatus ||
    (summary.dailyStatus === "COMPLETE") !== (summary.dailyNetEffectUsd !== null) ||
    (dailyAvailable.length === 0) !== (summary.dailyAbsoluteEffectUsd === null)
  ) {
    return false;
  }

  if (
    (pricedOpenCost.isZero()
      ? summary.pricedUnrealizedReturn !== null
      : summary.pricedUnrealizedReturn === null ||
        !pricedPnl.div(pricedOpenCost).eq(summary.pricedUnrealizedReturn))
  ) {
    return false;
  }

  if (hasAssetDenominator && !totalAssets.isZero()) {
    for (const position of priced) {
      if (
        position.assetWeight === null ||
        !new Decimal(position.marketValueUsd ?? "0")
          .div(totalAssets)
          .eq(position.assetWeight)
      ) {
        return false;
      }
    }
    if (
      cash !== null &&
      (summary.cashWeight === null ||
        !new Decimal(cash.balanceUsd).div(totalAssets).eq(summary.cashWeight))
    ) {
      return false;
    }
  } else if (
    totalAssets.isZero() &&
    (summary.cashWeight !== null ||
      priced.some((position) => position.assetWeight !== null))
  ) {
    return false;
  }
  return true;
}

function parsePortfolio(
  value: unknown,
): PortfolioConsultationPortfolioContext | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PORTFOLIO_KEYS) ||
    value.currency !== "USD" ||
    !Array.isArray(value.positions) ||
    value.positions.length > MAX_PORTFOLIO_CONSULTATION_POSITIONS
  ) {
    return null;
  }
  const summary = parseSummary(value.summary);
  const cash = parseCash(value.cash);
  if (summary === null || cash === undefined) {
    return null;
  }
  const positions: PortfolioConsultationPositionContext[] = [];
  const positionIds = new Set<string>();
  for (const candidate of value.positions) {
    const position = parsePosition(candidate);
    if (
      position === null ||
      positionIds.has(position.positionId)
    ) {
      return null;
    }
    positionIds.add(position.positionId);
    positions.push(position);
  }
  if (
    !isRecord(value.quoteContext) ||
    !hasExactKeys(value.quoteContext, QUOTE_CONTEXT_KEYS) ||
    value.quoteContext.delay !== "APPROXIMATELY_15_MINUTES" ||
    !isNullableRfc3339(value.quoteContext.oldestSourceEventAt) ||
    !isNullableRfc3339(value.quoteContext.oldestFetchedAt) ||
    !contextsAreConsistent(summary, positions, cash)
  ) {
    return null;
  }
  return {
    currency: "USD",
    summary,
    positions,
    cash,
    quoteContext: value.quoteContext as unknown as PortfolioConsultationQuoteContext,
  };
}

function safeConversationText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    [...value].length >= 1 &&
    [...value].length <= maximumLength &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value)
  );
}

function parseHistory(
  value: unknown,
): readonly PortfolioConsultationHistoryMessage[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAX_PORTFOLIO_CONSULTATION_HISTORY_MESSAGES ||
    value.length % 2 !== 0
  ) {
    return null;
  }
  const history: PortfolioConsultationHistoryMessage[] = [];
  let totalCharacters = 0;
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    const maximumLength = expectedRole === "user" ? 1_200 : 2_400;
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, HISTORY_KEYS) ||
      candidate.role !== expectedRole ||
      !safeConversationText(candidate.content, maximumLength)
    ) {
      return null;
    }
    totalCharacters += [...candidate.content].length;
    if (totalCharacters > 18_000) {
      return null;
    }
    history.push({ role: expectedRole, content: candidate.content });
  }
  return history;
}

export function parsePortfolioConsultationRequest(
  value: unknown,
): PortfolioConsultationRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REQUEST_KEYS) ||
    value.kind !== "PORTFOLIO_CONSULTATION" ||
    value.schemaVersion !== PORTFOLIO_CONSULTATION_SCHEMA_VERSION ||
    value.locale !== "zh-CN" ||
    !isRfc3339(value.generatedAt) ||
    (value.mode !== "INITIAL_ANALYSIS" &&
      value.mode !== "FOLLOW_UP" &&
      value.mode !== "CHAT")
  ) {
    return null;
  }
  const portfolio = parsePortfolio(value.portfolio);
  const history = parseHistory(value.history);
  if (portfolio === null || history === null) {
    return null;
  }
  const priorClassifications =
    value.priorClassifications === null
      ? null
      : parseClassifications(value.priorClassifications, portfolio.positions);
  if (
    (value.priorClassifications !== null && priorClassifications === null) ||
    (value.mode === "INITIAL_ANALYSIS" &&
      (history.length !== 0 ||
        value.question !== null ||
        priorClassifications !== null)) ||
    (value.mode === "FOLLOW_UP" &&
      (priorClassifications === null ||
        !safeConversationText(
          value.question,
          MAX_PORTFOLIO_CONSULTATION_QUESTION_CHARS,
        ))) ||
    (value.mode === "CHAT" &&
      (priorClassifications !== null ||
        !safeConversationText(
          value.question,
          MAX_PORTFOLIO_CONSULTATION_QUESTION_CHARS,
        )))
  ) {
    return null;
  }
  return {
    kind: "PORTFOLIO_CONSULTATION",
    schemaVersion: PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    locale: "zh-CN",
    mode: value.mode,
    portfolio,
    priorClassifications,
    history,
    question: value.question as string | null,
  };
}

function safeGeneratedText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    [...value].length < minimumLength ||
    [...value].length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    FORBIDDEN_GENERATED_NUMBER_PATTERN.test(value) ||
    FORBIDDEN_GENERATED_CLAIM_PATTERN.test(value) ||
    URL_PATTERN.test(value)
  ) {
    return false;
  }
  return true;
}

function safeTheme(value: unknown): value is string {
  return safeGeneratedText(value, 1, 24);
}

function parseClassifications(
  value: unknown,
  positions: readonly PortfolioConsultationPositionContext[],
): readonly PortfolioConsultationClassification[] | null {
  if (!Array.isArray(value) || value.length !== positions.length) {
    return null;
  }
  const positionsById = new Map(
    positions.map((position) => [position.positionId, position]),
  );
  const seen = new Set<string>();
  const classifications: PortfolioConsultationClassification[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, CLASSIFICATION_KEYS) ||
      typeof candidate.positionId !== "string" ||
      seen.has(candidate.positionId) ||
      typeof candidate.symbol !== "string" ||
      candidate.basis !== "AI_INFERRED" ||
      !INSTRUMENT_TYPES.has(candidate.instrumentType as PortfolioConsultationInstrumentType) ||
      !SECTORS.has(candidate.sector as PortfolioConsultationSector) ||
      !Array.isArray(candidate.themes) ||
      candidate.themes.length > 3 ||
      candidate.themes.some((theme) => !safeTheme(theme)) ||
      new Set(candidate.themes).size !== candidate.themes.length ||
      (candidate.confidence !== "HIGH" &&
        candidate.confidence !== "MEDIUM" &&
        candidate.confidence !== "LOW") ||
      !safeGeneratedText(candidate.rationale, 4, 100)
    ) {
      return null;
    }
    const position = positionsById.get(candidate.positionId);
    const expectedPosition = positions[classifications.length];
    if (
      position === undefined ||
      position.symbol !== candidate.symbol ||
      expectedPosition?.positionId !== candidate.positionId
    ) {
      return null;
    }
    seen.add(candidate.positionId);
    classifications.push(candidate as unknown as PortfolioConsultationClassification);
  }
  return classifications;
}

function classificationsMatch(
  left: readonly PortfolioConsultationClassification[],
  right: readonly PortfolioConsultationClassification[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        entry.positionId === candidate.positionId &&
        entry.symbol === candidate.symbol &&
        entry.basis === candidate.basis &&
        entry.instrumentType === candidate.instrumentType &&
        entry.sector === candidate.sector &&
        entry.confidence === candidate.confidence &&
        entry.rationale === candidate.rationale &&
        entry.themes.length === candidate.themes.length &&
        entry.themes.every((theme, themeIndex) => theme === candidate.themes[themeIndex])
      );
    })
  );
}

function allowedEvidenceRefs(
  request: PortfolioConsultationRequest,
  classifications: readonly PortfolioConsultationClassification[],
): ReadonlySet<string> {
  const refs = new Set<string>([
    "portfolio.structure",
    "portfolio.concentration",
    "portfolio.performance",
    "portfolio.daily",
    "portfolio.cash",
    "portfolio.data",
  ]);
  for (const position of request.portfolio.positions) {
    refs.add(`position.${position.positionId}`);
  }
  for (const classification of classifications) {
    refs.add(`sector.${classification.sector}`);
    refs.add(`role.${classification.instrumentType}`);
  }
  return refs;
}

function parseEvidenceRefs(
  value: unknown,
  allowed: ReadonlySet<string>,
  minimumLength: number,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length < minimumLength || value.length > 5) {
    return null;
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const ref of value) {
    if (
      typeof ref !== "string" ||
      !SAFE_EVIDENCE_REF_PATTERN.test(ref) ||
      !allowed.has(ref) ||
      seen.has(ref)
    ) {
      return null;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function refSupportsDimension(
  ref: string,
  kind: PortfolioConsultationDimensionKind,
): boolean {
  switch (kind) {
    case "ASSET_ALLOCATION":
      return (
        ref === "portfolio.structure" ||
        ref === "portfolio.cash" ||
        ref === "portfolio.data" ||
        ref.startsWith("role.")
      );
    case "CONCENTRATION":
      return (
        ref === "portfolio.concentration" ||
        ref === "portfolio.data" ||
        ref.startsWith("position.")
      );
    case "SECTOR_THEME":
      return (
        ref === "portfolio.data" ||
        ref.startsWith("sector.") ||
        ref.startsWith("position.")
      );
    case "VEHICLE_OVERLAP":
      return (
        ref === "portfolio.data" ||
        ref.startsWith("role.") ||
        ref.startsWith("sector.") ||
        ref.startsWith("position.")
      );
    case "PERFORMANCE_CONTRIBUTION":
      return (
        ref === "portfolio.performance" ||
        ref === "portfolio.daily" ||
        ref === "portfolio.data" ||
        ref.startsWith("position.")
      );
    case "DATA_LIMITS":
      return ref === "portfolio.data";
  }
}

function parseBrief(
  value: unknown,
  allowed: ReadonlySet<string>,
): PortfolioConsultationBrief | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BRIEF_KEYS) ||
    !safeGeneratedText(value.headline, 8, 64) ||
    !safeGeneratedText(value.summary, 16, 240) ||
    !Array.isArray(value.dimensions) ||
    value.dimensions.length !== DIMENSION_KINDS.size ||
    !Array.isArray(value.questions) ||
    value.questions.length !== 0
  ) {
    return null;
  }
  const dimensions: PortfolioConsultationDimension[] = [];
  const seen = new Set<PortfolioConsultationDimensionKind>();
  for (const candidate of value.dimensions) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, DIMENSION_KEYS) ||
      !DIMENSION_KINDS.has(candidate.kind as PortfolioConsultationDimensionKind) ||
      seen.has(candidate.kind as PortfolioConsultationDimensionKind) ||
      !safeGeneratedText(candidate.title, 2, 24) ||
      !safeGeneratedText(candidate.text, 10, 200)
    ) {
      return null;
    }
    const kind = candidate.kind as PortfolioConsultationDimensionKind;
    const refs = parseEvidenceRefs(candidate.evidenceRefs, allowed, 1);
    if (refs === null || !refs.some((ref) => refSupportsDimension(ref, kind))) {
      return null;
    }
    seen.add(kind);
    dimensions.push({
      kind,
      title: candidate.title,
      text: candidate.text,
      evidenceRefs: refs,
    });
  }
  if (seen.size !== DIMENSION_KINDS.size) {
    return null;
  }
  return {
    headline: value.headline,
    summary: value.summary,
    dimensions,
    questions: value.questions as readonly string[],
  };
}

function parseAnswer(
  value: unknown,
  allowed: ReadonlySet<string>,
  minimumSuggestedQuestions = 1,
  maximumSuggestedQuestions = 2,
): PortfolioConsultationAnswer | null {
  const candidate = isRecord(value) ? value : null;
  const frameworkLenses =
    candidate !== null && Array.isArray(candidate.frameworkLenses)
      ? candidate.frameworkLenses
      : [];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ANSWER_KEYS) ||
    !safeGeneratedText(value.text, 8, 900) ||
    frameworkLenses.length < 1 ||
    frameworkLenses.length > 3 ||
    frameworkLenses.some(
      (lens) => !FRAMEWORK_LENSES.has(lens as ValueInvestingFrameworkLens),
    ) ||
    new Set(frameworkLenses).size !== frameworkLenses.length ||
    (frameworkLenses.some((lens) =>
      FUNDAMENTAL_LENSES_REQUIRING_EVIDENCE_GAP.has(
        lens as ValueInvestingFrameworkLens,
      ),
    ) && !frameworkLenses.includes("EVIDENCE_GAP")) ||
    !Array.isArray(value.suggestedQuestions) ||
    value.suggestedQuestions.length < minimumSuggestedQuestions ||
    value.suggestedQuestions.length > maximumSuggestedQuestions ||
    value.suggestedQuestions.some(
      (question) => !safeGeneratedText(question, 6, 100),
    ) ||
    new Set(value.suggestedQuestions).size !== value.suggestedQuestions.length
  ) {
    return null;
  }
  const evidenceRefs = parseEvidenceRefs(value.evidenceRefs, allowed, 0);
  if (evidenceRefs === null) {
    return null;
  }
  return {
    text: value.text,
    evidenceRefs,
    frameworkLenses: frameworkLenses as readonly ValueInvestingFrameworkLens[],
    suggestedQuestions: value.suggestedQuestions as readonly string[],
  };
}

export function parsePortfolioConsultationModelOutput(
  value: unknown,
  request: PortfolioConsultationRequest,
): PortfolioConsultationModelOutput | null {
  if (!isRecord(value) || !hasExactKeys(value, MODEL_OUTPUT_KEYS)) {
    return null;
  }
  if (request.mode === "CHAT") {
    if (
      !Array.isArray(value.classifications) ||
      value.classifications.length !== 0 ||
      value.brief !== null
    ) {
      return null;
    }
    const answer = parseAnswer(
      value.answer,
      allowedEvidenceRefs(request, []),
      0,
      0,
    );
    return answer === null
      ? null
      : { classifications: [], brief: null, answer };
  }
  const classifications = parseClassifications(
    value.classifications,
    request.portfolio.positions,
  );
  if (
    classifications === null ||
    (request.priorClassifications !== null &&
      !classificationsMatch(classifications, request.priorClassifications))
  ) {
    return null;
  }
  const allowed = allowedEvidenceRefs(request, classifications);
  if (request.mode === "INITIAL_ANALYSIS") {
    if (value.answer !== null) {
      return null;
    }
    const brief = parseBrief(value.brief, allowed);
    return brief === null
      ? null
      : { classifications, brief, answer: null };
  }
  if (value.brief !== null) {
    return null;
  }
  const answer = parseAnswer(value.answer, allowed);
  return answer === null
    ? null
    : { classifications, brief: null, answer };
}

function isApiErrorCode(value: unknown): value is PortfolioConsultationApiErrorCode {
  return (
    value === "INVALID_REQUEST" ||
    value === "RATE_LIMITED" ||
    value === "AI_NOT_CONFIGURED" ||
    value === "AI_PROVIDER_UNAVAILABLE" ||
    value === "INVALID_MODEL_OUTPUT"
  );
}

export function parsePortfolioConsultationApiResponse(
  value: unknown,
  request: PortfolioConsultationRequest,
): PortfolioConsultationApiResponse | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "ERROR") {
    if (
      !hasExactKeys(value, ERROR_KEYS) ||
      !isApiErrorCode(value.code) ||
      typeof value.message !== "string" ||
      value.message.length < 1 ||
      value.message.length > 180
    ) {
      return null;
    }
    return {
      kind: "ERROR",
      code: value.code,
      message: value.message,
    };
  }
  if (
    value.kind !== "PORTFOLIO_CONSULTATION_RESULT" ||
    !hasExactKeys(value, SUCCESS_KEYS) ||
    value.schemaVersion !== PORTFOLIO_CONSULTATION_SCHEMA_VERSION ||
    value.promptVersion !== PORTFOLIO_CONSULTATION_PROMPT_VERSION ||
    value.mode !== request.mode ||
    !isRfc3339(value.generatedAt) ||
    typeof value.model !== "string" ||
    value.model.length < 1 ||
    value.model.length > 80
  ) {
    return null;
  }
  const output = parsePortfolioConsultationModelOutput(
    {
      classifications: value.classifications,
      brief: value.brief,
      answer: value.answer,
    },
    request,
  );
  if (output === null) {
    return null;
  }
  return {
    kind: "PORTFOLIO_CONSULTATION_RESULT",
    schemaVersion: PORTFOLIO_CONSULTATION_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    model: value.model,
    promptVersion: PORTFOLIO_CONSULTATION_PROMPT_VERSION,
    mode: request.mode,
    ...output,
  };
}
