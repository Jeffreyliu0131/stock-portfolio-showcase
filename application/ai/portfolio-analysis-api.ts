export const PORTFOLIO_AI_SCHEMA_VERSION = 1 as const;
export const PORTFOLIO_AI_PROMPT_VERSION = "portfolio-ai-v1" as const;
export const MAX_PORTFOLIO_AI_EVIDENCE = 220;

export type PortfolioAiInsightCategory =
  | "PORTFOLIO_OVERVIEW"
  | "TODAY_DRIVERS"
  | "DATA_QUALITY";

export type PortfolioAiCompleteness =
  | "COMPLETE"
  | "PARTIAL"
  | "UNAVAILABLE";

export type PortfolioAiDirection =
  | "POSITIVE"
  | "NEGATIVE"
  | "NEUTRAL"
  | "UNAVAILABLE";

export type PortfolioAiEvidenceMetric =
  | "STRUCTURE_STATUS"
  | "POSITION_WEIGHT"
  | "CASH_WEIGHT"
  | "TOP_CONCENTRATION"
  | "DAILY_CONTRIBUTION"
  | "DAILY_NET_DIRECTION"
  | "PRICING_COVERAGE"
  | "DAILY_COVERAGE";

interface PortfolioAiEvidenceBase {
  readonly id: string;
  readonly category: PortfolioAiInsightCategory;
  readonly subject: string;
}

export interface PortfolioAiFractionEvidence
  extends PortfolioAiEvidenceBase {
  readonly metric:
    | "POSITION_WEIGHT"
    | "CASH_WEIGHT"
    | "TOP_CONCENTRATION";
  /** Exact decimal fraction in [0, 1]. Never a rounded display percentage. */
  readonly fraction: string;
}

export interface PortfolioAiStructureStatusEvidence
  extends PortfolioAiEvidenceBase {
  readonly metric: "STRUCTURE_STATUS";
  readonly status: PortfolioAiCompleteness;
}

export interface PortfolioAiDailyContributionEvidence
  extends PortfolioAiEvidenceBase {
  readonly metric: "DAILY_CONTRIBUTION";
  readonly direction: Exclude<PortfolioAiDirection, "UNAVAILABLE">;
  /** Null only when the absolute daily-effect denominator is zero. */
  readonly fraction: string | null;
}

export interface PortfolioAiDailyNetEvidence
  extends PortfolioAiEvidenceBase {
  readonly metric: "DAILY_NET_DIRECTION";
  readonly direction: PortfolioAiDirection;
  readonly status: PortfolioAiCompleteness;
}

export interface PortfolioAiCoverageEvidence
  extends PortfolioAiEvidenceBase {
  readonly metric: "PRICING_COVERAGE" | "DAILY_COVERAGE";
  readonly availableCount: number;
  readonly totalCount: number;
  readonly status: PortfolioAiCompleteness;
}

export type PortfolioAiEvidence =
  | PortfolioAiStructureStatusEvidence
  | PortfolioAiFractionEvidence
  | PortfolioAiDailyContributionEvidence
  | PortfolioAiDailyNetEvidence
  | PortfolioAiCoverageEvidence;

/**
 * Privacy-minimized AI payload. It deliberately excludes quantities, costs,
 * prices, market values, cash balance, NAV, names, and account identifiers.
 */
export interface PortfolioAiFactsRequest {
  readonly kind: "PORTFOLIO_AI_FACTS";
  readonly schemaVersion: typeof PORTFOLIO_AI_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly locale: "zh-CN";
  readonly evidence: readonly PortfolioAiEvidence[];
}

export interface PortfolioAiHeadline {
  readonly text: string;
  readonly evidenceRefs: readonly string[];
}

export interface PortfolioAiObservation {
  readonly category: PortfolioAiInsightCategory;
  readonly title: string;
  readonly text: string;
  readonly evidenceRefs: readonly string[];
}

export interface PortfolioAiAnalysisSuccess {
  readonly kind: "PORTFOLIO_AI_ANALYSIS";
  readonly schemaVersion: typeof PORTFOLIO_AI_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly model: string;
  readonly promptVersion: typeof PORTFOLIO_AI_PROMPT_VERSION;
  readonly headline: PortfolioAiHeadline;
  readonly observations: readonly PortfolioAiObservation[];
  readonly questions: readonly string[];
}

export type PortfolioAiApiErrorCode =
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "AI_NOT_CONFIGURED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "INVALID_MODEL_OUTPUT";

export interface PortfolioAiApiError {
  readonly kind: "ERROR";
  readonly code: PortfolioAiApiErrorCode;
  readonly message: string;
}

export type PortfolioAiApiResponse =
  | PortfolioAiAnalysisSuccess
  | PortfolioAiApiError;

export interface PortfolioAiModelOutput {
  readonly headline: PortfolioAiHeadline;
  readonly observations: readonly PortfolioAiObservation[];
  readonly questions: readonly string[];
}

const REQUEST_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "locale",
  "evidence",
] as const;
const BASE_EVIDENCE_KEYS = ["id", "category", "subject", "metric"] as const;
const MODEL_OUTPUT_KEYS = ["headline", "observations", "questions"] as const;
const HEADLINE_KEYS = ["text", "evidenceRefs"] as const;
const OBSERVATION_KEYS = ["category", "title", "text", "evidenceRefs"] as const;
const SUCCESS_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "model",
  "promptVersion",
  "headline",
  "observations",
  "questions",
] as const;
const ERROR_KEYS = ["kind", "code", "message"] as const;
const EVIDENCE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const SUBJECT_PATTERN = /^(?:PORTFOLIO|CASH|[A-Z][A-Z0-9.-]{0,19})$/;
const FRACTION_PATTERN = /^(?:0(?:\.\d{1,80})?|1(?:\.0{1,80})?)$/;
const FORBIDDEN_NUMBER_PATTERN =
  /[0-9０-９%％$¥￥€£]|(?:百分之|千分之|万分之)[零〇一二两三四五六七八九十百千万亿]+|[零〇一二两三四五六七八九十百千万亿]+(?:成|倍|只|项|条|位|名|股|元|美元|人民币)|(?:第|前)[零〇一二两三四五六七八九十百千万亿]+|一半|过半/u;
const FORBIDDEN_CLAIM_PATTERN =
  /(买入|卖出|增持|减持|加仓|减仓|清仓|建仓|换仓|调仓|抄底|止盈|止损|继续持有|观望|回避|做多|做空|目标价|投资建议|建议调整|应该调整|应当调整|推荐|预测|预计|预期|看涨|看跌|可能上涨|可能下跌|将上涨|将下跌|必涨|必跌|保证收益|风险评级|新闻|财报|宏观|政策|基本面|被低估|被高估|估值过高|估值过低|因为|由于)/u;

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
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isCategory(value: unknown): value is PortfolioAiInsightCategory {
  return (
    value === "PORTFOLIO_OVERVIEW" ||
    value === "TODAY_DRIVERS" ||
    value === "DATA_QUALITY"
  );
}

function isCompleteness(value: unknown): value is PortfolioAiCompleteness {
  return value === "COMPLETE" || value === "PARTIAL" || value === "UNAVAILABLE";
}

function isDirection(value: unknown): value is PortfolioAiDirection {
  return (
    value === "POSITIVE" ||
    value === "NEGATIVE" ||
    value === "NEUTRAL" ||
    value === "UNAVAILABLE"
  );
}

function isFraction(value: unknown): value is string {
  return typeof value === "string" && FRACTION_PATTERN.test(value);
}

function validBaseEvidence(record: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof record.id === "string" &&
    EVIDENCE_ID_PATTERN.test(record.id) &&
    isCategory(record.category) &&
    typeof record.subject === "string" &&
    SUBJECT_PATTERN.test(record.subject)
  );
}

function parseEvidence(value: unknown): PortfolioAiEvidence | null {
  if (!isRecord(value) || !validBaseEvidence(value)) {
    return null;
  }
  if (
    value.metric === "STRUCTURE_STATUS"
  ) {
    if (
      !hasExactKeys(value, [...BASE_EVIDENCE_KEYS, "status"]) ||
      value.category !== "PORTFOLIO_OVERVIEW" ||
      value.id !== "structure.status" ||
      value.subject !== "PORTFOLIO" ||
      !isCompleteness(value.status)
    ) {
      return null;
    }
    return value as unknown as PortfolioAiStructureStatusEvidence;
  }
  if (
    value.metric === "POSITION_WEIGHT" ||
    value.metric === "CASH_WEIGHT" ||
    value.metric === "TOP_CONCENTRATION"
  ) {
    const identityIsValid =
      (value.metric === "POSITION_WEIGHT" &&
        /^structure\.position\.\d+\.weight$/u.test(String(value.id)) &&
        value.subject !== "PORTFOLIO" &&
        value.subject !== "CASH") ||
      (value.metric === "CASH_WEIGHT" &&
        value.id === "structure.cash.weight" &&
        value.subject === "CASH") ||
      (value.metric === "TOP_CONCENTRATION" &&
        (value.id === "structure.top1" ||
          value.id === "structure.top3" ||
          value.id === "structure.top5") &&
        value.subject === "PORTFOLIO");
    if (
      !hasExactKeys(value, [...BASE_EVIDENCE_KEYS, "fraction"]) ||
      value.category !== "PORTFOLIO_OVERVIEW" ||
      !identityIsValid ||
      !isFraction(value.fraction)
    ) {
      return null;
    }
    return value as unknown as PortfolioAiFractionEvidence;
  }
  if (value.metric === "DAILY_CONTRIBUTION") {
    if (
      !hasExactKeys(value, [
        ...BASE_EVIDENCE_KEYS,
        "direction",
        "fraction",
      ]) ||
      value.category !== "TODAY_DRIVERS" ||
      !/^daily\.position\.\d+\.contribution$/u.test(String(value.id)) ||
      value.subject === "PORTFOLIO" ||
      value.subject === "CASH" ||
      !isDirection(value.direction) ||
      value.direction === "UNAVAILABLE" ||
      (value.fraction !== null && !isFraction(value.fraction)) ||
      ((value.direction === "POSITIVE" || value.direction === "NEGATIVE") &&
        (value.fraction === null || value.fraction === "0"))
    ) {
      return null;
    }
    return value as unknown as PortfolioAiDailyContributionEvidence;
  }
  if (value.metric === "DAILY_NET_DIRECTION") {
    if (
      !hasExactKeys(value, [
        ...BASE_EVIDENCE_KEYS,
        "direction",
        "status",
      ]) ||
      value.category !== "TODAY_DRIVERS" ||
      value.id !== "daily.net" ||
      value.subject !== "PORTFOLIO" ||
      !isDirection(value.direction) ||
      !isCompleteness(value.status)
    ) {
      return null;
    }
    return value as unknown as PortfolioAiDailyNetEvidence;
  }
  if (value.metric === "PRICING_COVERAGE" || value.metric === "DAILY_COVERAGE") {
    if (
      !hasExactKeys(value, [
        ...BASE_EVIDENCE_KEYS,
        "availableCount",
        "totalCount",
        "status",
      ]) ||
      value.category !== "DATA_QUALITY" ||
      value.id !==
        (value.metric === "PRICING_COVERAGE"
          ? "quality.pricing"
          : "quality.daily") ||
      value.subject !== "PORTFOLIO" ||
      !Number.isSafeInteger(value.availableCount) ||
      !Number.isSafeInteger(value.totalCount) ||
      (value.availableCount as number) < 0 ||
      (value.totalCount as number) < 0 ||
      (value.totalCount as number) > 100 ||
      (value.availableCount as number) > (value.totalCount as number) ||
      !isCompleteness(value.status)
    ) {
      return null;
    }
    return value as unknown as PortfolioAiCoverageEvidence;
  }
  return null;
}

function evidenceSetIsConsistent(
  evidence: readonly PortfolioAiEvidence[],
): boolean {
  const structureStatuses = evidence.filter(
    (entry) => entry.metric === "STRUCTURE_STATUS",
  );
  const dailyNets = evidence.filter(
    (entry) => entry.metric === "DAILY_NET_DIRECTION",
  );
  const pricingCoverage = evidence.filter(
    (entry) => entry.metric === "PRICING_COVERAGE",
  );
  const dailyCoverage = evidence.filter(
    (entry) => entry.metric === "DAILY_COVERAGE",
  );
  const cashWeights = evidence.filter(
    (entry) => entry.metric === "CASH_WEIGHT",
  );
  if (
    structureStatuses.length !== 1 ||
    dailyNets.length !== 1 ||
    pricingCoverage.length !== 1 ||
    dailyCoverage.length !== 1 ||
    cashWeights.length > 1
  ) {
    return false;
  }
  const dailyNet = dailyNets[0];
  const pricing = pricingCoverage[0];
  const daily = dailyCoverage[0];
  if (
    dailyNet === undefined ||
    pricing === undefined ||
    daily === undefined ||
    dailyNet.metric !== "DAILY_NET_DIRECTION" ||
    pricing.metric !== "PRICING_COVERAGE" ||
    daily.metric !== "DAILY_COVERAGE"
  ) {
    return false;
  }
  const calculableContributions = evidence.filter(
    (entry) => entry.metric === "DAILY_CONTRIBUTION",
  ).length;
  return (
    pricing.totalCount === daily.totalCount &&
    daily.availableCount === calculableContributions &&
    dailyNet.status === daily.status &&
    (dailyNet.status === "COMPLETE"
      ? dailyNet.direction !== "UNAVAILABLE"
      : dailyNet.direction === "UNAVAILABLE")
  );
}

export function parsePortfolioAiFactsRequest(
  value: unknown,
): PortfolioAiFactsRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REQUEST_KEYS) ||
    value.kind !== "PORTFOLIO_AI_FACTS" ||
    value.schemaVersion !== PORTFOLIO_AI_SCHEMA_VERSION ||
    value.locale !== "zh-CN" ||
    !isRfc3339(value.generatedAt) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length < 3 ||
    value.evidence.length > MAX_PORTFOLIO_AI_EVIDENCE
  ) {
    return null;
  }
  const evidence: PortfolioAiEvidence[] = [];
  const ids = new Set<string>();
  for (const candidate of value.evidence) {
    const parsed = parseEvidence(candidate);
    if (parsed === null || ids.has(parsed.id)) {
      return null;
    }
    ids.add(parsed.id);
    evidence.push(parsed);
  }
  const categories = new Set(evidence.map((entry) => entry.category));
  if (
    !categories.has("PORTFOLIO_OVERVIEW") ||
    !categories.has("TODAY_DRIVERS") ||
    !categories.has("DATA_QUALITY") ||
    !evidenceSetIsConsistent(evidence)
  ) {
    return null;
  }
  return {
    kind: "PORTFOLIO_AI_FACTS",
    schemaVersion: PORTFOLIO_AI_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    locale: "zh-CN",
    evidence,
  };
}

function safeModelText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  if (typeof value !== "string" || value !== value.trim()) {
    return false;
  }
  const length = [...value].length;
  return (
    length >= minimumLength &&
    length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !FORBIDDEN_NUMBER_PATTERN.test(value) &&
    !FORBIDDEN_CLAIM_PATTERN.test(value)
  );
}

function parseEvidenceRefs(
  value: unknown,
  evidenceById: ReadonlyMap<string, PortfolioAiEvidence>,
  category?: PortfolioAiInsightCategory,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    return null;
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const ref of value) {
    if (typeof ref !== "string" || seen.has(ref)) {
      return null;
    }
    const evidence = evidenceById.get(ref);
    if (evidence === undefined || (category !== undefined && evidence.category !== category)) {
      return null;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

export function parsePortfolioAiModelOutput(
  value: unknown,
  evidence: readonly PortfolioAiEvidence[],
): PortfolioAiModelOutput | null {
  if (!isRecord(value) || !hasExactKeys(value, MODEL_OUTPUT_KEYS)) {
    return null;
  }
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  if (!isRecord(value.headline) || !hasExactKeys(value.headline, HEADLINE_KEYS)) {
    return null;
  }
  const headlineRefs = parseEvidenceRefs(value.headline.evidenceRefs, evidenceById);
  if (!safeModelText(value.headline.text, 8, 48) || headlineRefs === null) {
    return null;
  }
  if (!Array.isArray(value.observations) || value.observations.length !== 3) {
    return null;
  }
  const observations: PortfolioAiObservation[] = [];
  const seenCategories = new Set<PortfolioAiInsightCategory>();
  for (const candidate of value.observations) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, OBSERVATION_KEYS) ||
      !isCategory(candidate.category) ||
      seenCategories.has(candidate.category) ||
      !safeModelText(candidate.title, 2, 18) ||
      !safeModelText(candidate.text, 8, 96)
    ) {
      return null;
    }
    const refs = parseEvidenceRefs(
      candidate.evidenceRefs,
      evidenceById,
      candidate.category,
    );
    if (refs === null) {
      return null;
    }
    seenCategories.add(candidate.category);
    observations.push({
      category: candidate.category,
      title: candidate.title,
      text: candidate.text,
      evidenceRefs: refs,
    });
  }
  if (
    seenCategories.size !== 3 ||
    !Array.isArray(value.questions) ||
    value.questions.length !== 2 ||
    value.questions.some((question) => !safeModelText(question, 6, 72))
  ) {
    return null;
  }
  return {
    headline: {
      text: value.headline.text,
      evidenceRefs: headlineRefs,
    },
    observations,
    questions: value.questions as readonly string[],
  };
}

function isApiErrorCode(value: unknown): value is PortfolioAiApiErrorCode {
  return (
    value === "INVALID_REQUEST" ||
    value === "RATE_LIMITED" ||
    value === "AI_NOT_CONFIGURED" ||
    value === "AI_PROVIDER_UNAVAILABLE" ||
    value === "INVALID_MODEL_OUTPUT"
  );
}

export function parsePortfolioAiApiResponse(
  value: unknown,
  evidence: readonly PortfolioAiEvidence[],
): PortfolioAiApiResponse | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "ERROR") {
    if (
      !hasExactKeys(value, ERROR_KEYS) ||
      !isApiErrorCode(value.code) ||
      typeof value.message !== "string" ||
      value.message.length < 1 ||
      value.message.length > 160
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
    value.kind !== "PORTFOLIO_AI_ANALYSIS" ||
    !hasExactKeys(value, SUCCESS_KEYS) ||
    value.schemaVersion !== PORTFOLIO_AI_SCHEMA_VERSION ||
    value.promptVersion !== PORTFOLIO_AI_PROMPT_VERSION ||
    !isRfc3339(value.generatedAt) ||
    typeof value.model !== "string" ||
    value.model.length < 1 ||
    value.model.length > 80
  ) {
    return null;
  }
  const output = parsePortfolioAiModelOutput(
    {
      headline: value.headline,
      observations: value.observations,
      questions: value.questions,
    },
    evidence,
  );
  if (output === null) {
    return null;
  }
  return {
    kind: "PORTFOLIO_AI_ANALYSIS",
    schemaVersion: PORTFOLIO_AI_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    model: value.model,
    promptVersion: PORTFOLIO_AI_PROMPT_VERSION,
    ...output,
  };
}
