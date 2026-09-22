import {
  VALUE_INVESTING_FRAMEWORK_LENSES,
  type ValueInvestingFrameworkLens,
} from "../value-investing-framework.ts";
import {
  buffettResearchIssuer,
  isBuffettResearchSymbol,
  type BuffettResearchSymbol,
} from "./supported-issuers.ts";

export const BUFFETT_RESEARCH_SCHEMA_VERSION = 1 as const;
export const BUFFETT_RESEARCH_PROMPT_VERSION = "buffett-research-v1" as const;
export const MAX_BUFFETT_RESEARCH_QUESTION_CHARS = 800;

export type BuffettEvidenceSourceType =
  | "SEC_FILING"
  | "SEC_XBRL"
  | "OFFICIAL_WEB";

export type BuffettEvidenceAuthority = "PRIMARY" | "DISCOVERY";

export type BuffettResearchMetricKey =
  | "REVENUE"
  | "NET_INCOME"
  | "OPERATING_CASH_FLOW"
  | "CAPITAL_EXPENDITURES"
  | "FREE_CASH_FLOW_PROXY"
  | "NET_MARGIN"
  | "CASH_AND_EQUIVALENTS";

export type BuffettResearchMetricUnit = "USD" | "FRACTION";

export type BuffettResearchStage =
  | "PLAN"
  | "SEC_RETRIEVAL"
  | "WEB_SEARCH"
  | "CALCULATION"
  | "SYNTHESIS"
  | "EVIDENCE_GATE";

export interface BuffettResearchRequest {
  readonly kind: "BUFFETT_RESEARCH_REQUEST";
  readonly schemaVersion: typeof BUFFETT_RESEARCH_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly locale: "zh-CN";
  readonly symbol: BuffettResearchSymbol;
  readonly question: string;
}

export interface BuffettEvidenceItem {
  readonly id: string;
  readonly sourceType: BuffettEvidenceSourceType;
  readonly authority: BuffettEvidenceAuthority;
  readonly title: string;
  readonly url: string;
  readonly retrievedAt: string;
  readonly filedAt: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly metric: BuffettResearchMetricKey | null;
  readonly value: string | null;
  readonly unit: BuffettResearchMetricUnit | null;
  readonly summary: string | null;
  readonly sourcePath: string | null;
}

export interface BuffettResearchMetric {
  readonly key: BuffettResearchMetricKey;
  readonly label: string;
  readonly value: string;
  readonly unit: BuffettResearchMetricUnit;
  readonly periodEnd: string;
  readonly status: "OBSERVED" | "DERIVED";
  readonly evidenceRefs: readonly string[];
}

export interface BuffettOwnerEarningsAssessment {
  readonly status: "ASSUMPTION_REQUIRED";
  readonly explanation: string;
  readonly freeCashFlowProxyUsd: string | null;
  readonly evidenceRefs: readonly string[];
}

export interface BuffettResearchClaim {
  readonly kind: "FACT" | "INFERENCE";
  readonly text: string;
  readonly evidenceRefs: readonly string[];
}

export interface BuffettResearchFinding {
  readonly lens: ValueInvestingFrameworkLens;
  readonly title: string;
  readonly assessment: string;
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
  readonly evidenceRefs: readonly string[];
}

export interface BuffettResearchModelOutput {
  readonly headline: string;
  readonly summary: string;
  readonly claims: readonly BuffettResearchClaim[];
  readonly findings: readonly BuffettResearchFinding[];
  readonly unknowns: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly nextQuestions: readonly string[];
}

export interface BuffettResearchTraceStep {
  readonly stage: BuffettResearchStage;
  readonly status: "COMPLETED" | "PARTIAL" | "FAILED";
  readonly detail: string;
}

export interface BuffettResearchSuccess extends BuffettResearchModelOutput {
  readonly kind: "BUFFETT_RESEARCH_RESULT";
  readonly schemaVersion: typeof BUFFETT_RESEARCH_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly symbol: BuffettResearchSymbol;
  readonly companyName: string;
  readonly model: string;
  readonly promptVersion: typeof BUFFETT_RESEARCH_PROMPT_VERSION;
  readonly evidence: readonly BuffettEvidenceItem[];
  readonly metrics: readonly BuffettResearchMetric[];
  readonly ownerEarnings: BuffettOwnerEarningsAssessment;
  readonly trace: readonly BuffettResearchTraceStep[];
}

export type BuffettResearchApiErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_ISSUER"
  | "RATE_LIMITED"
  | "RESEARCH_NOT_CONFIGURED"
  | "SEC_UNAVAILABLE"
  | "AI_PROVIDER_UNAVAILABLE"
  | "INVALID_RESEARCH_OUTPUT";

export interface BuffettResearchApiError {
  readonly kind: "ERROR";
  readonly code: BuffettResearchApiErrorCode;
  readonly message: string;
}

export type BuffettResearchApiResponse =
  | BuffettResearchSuccess
  | BuffettResearchApiError;

const REQUEST_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "locale",
  "symbol",
  "question",
] as const;
const MODEL_OUTPUT_KEYS = [
  "headline",
  "summary",
  "claims",
  "findings",
  "unknowns",
  "counterEvidence",
  "nextQuestions",
] as const;
const CLAIM_KEYS = ["kind", "text", "evidenceRefs"] as const;
const FINDING_KEYS = [
  "lens",
  "title",
  "assessment",
  "confidence",
  "evidenceRefs",
] as const;
const SUCCESS_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "symbol",
  "companyName",
  "model",
  "promptVersion",
  "headline",
  "summary",
  "claims",
  "findings",
  "unknowns",
  "counterEvidence",
  "nextQuestions",
  "evidence",
  "metrics",
  "ownerEarnings",
  "trace",
] as const;
const ERROR_KEYS = ["kind", "code", "message"] as const;
const EVIDENCE_KEYS = [
  "id",
  "sourceType",
  "authority",
  "title",
  "url",
  "retrievedAt",
  "filedAt",
  "periodStart",
  "periodEnd",
  "metric",
  "value",
  "unit",
  "summary",
  "sourcePath",
] as const;
const METRIC_KEYS = [
  "key",
  "label",
  "value",
  "unit",
  "periodEnd",
  "status",
  "evidenceRefs",
] as const;
const OWNER_EARNINGS_KEYS = [
  "status",
  "explanation",
  "freeCashFlowProxyUsd",
  "evidenceRefs",
] as const;
const TRACE_KEYS = ["stage", "status", "detail"] as const;
const EVIDENCE_ID_PATTERN = /^[a-z][a-z0-9._:-]{2,119}$/;
const FORBIDDEN_NUMBER_PATTERN = /[0-9０-９%％$¥￥€£]/u;
const FORBIDDEN_CLAIM_PATTERN =
  /(买入|卖出|增持|减持|加仓|减仓|清仓|建仓|换仓|调仓|目标价|保证收益|必涨|必跌|我是巴菲特|作为巴菲特|巴菲特会说|巴菲特会做|I am Warren Buffett|Warren Buffett would)/iu;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const METRIC_KEYS_SET = new Set<BuffettResearchMetricKey>([
  "REVENUE",
  "NET_INCOME",
  "OPERATING_CASH_FLOW",
  "CAPITAL_EXPENDITURES",
  "FREE_CASH_FLOW_PROXY",
  "NET_MARGIN",
  "CASH_AND_EQUIVALENTS",
]);
const TRACE_STAGES: readonly BuffettResearchStage[] = [
  "PLAN",
  "SEC_RETRIEVAL",
  "WEB_SEARCH",
  "CALCULATION",
  "SYNTHESIS",
  "EVIDENCE_GATE",
];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).toSorted();
  const wanted = [...expected].toSorted();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function safeText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    [...value].length >= minimum &&
    [...value].length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !FORBIDDEN_NUMBER_PATTERN.test(value) &&
    !FORBIDDEN_CLAIM_PATTERN.test(value) &&
    !/(?:https?:\/\/|www\.)/iu.test(value)
  );
}

function safeQuestion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    [...value].length >= 2 &&
    [...value].length <= MAX_BUFFETT_RESEARCH_QUESTION_CHARS &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value)
  );
}

function safeSourceText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    [...value].length >= minimum &&
    [...value].length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function dateOnly(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime())
  );
}

function nullableDateOnly(value: unknown): value is string | null {
  return value === null || dateOnly(value);
}

function decimal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    DECIMAL_PATTERN.test(value) &&
    value !== "-0"
  );
}

function allowedSourceUrl(
  value: unknown,
  symbol: BuffettResearchSymbol,
): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      buffettResearchIssuer(symbol).allowedWebDomains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

function parseEvidenceItems(
  value: unknown,
  symbol: BuffettResearchSymbol,
): readonly BuffettEvidenceItem[] | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 30) {
    return null;
  }
  const seen = new Set<string>();
  const parsed: BuffettEvidenceItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, EVIDENCE_KEYS) ||
      typeof item.id !== "string" ||
      !EVIDENCE_ID_PATTERN.test(item.id) ||
      seen.has(item.id) ||
      (item.sourceType !== "SEC_FILING" &&
        item.sourceType !== "SEC_XBRL" &&
        item.sourceType !== "OFFICIAL_WEB") ||
      (item.authority !== "PRIMARY" && item.authority !== "DISCOVERY") ||
      !safeSourceText(item.title, 2, 200) ||
      !allowedSourceUrl(item.url, symbol) ||
      !isRfc3339(item.retrievedAt) ||
      !nullableDateOnly(item.filedAt) ||
      !nullableDateOnly(item.periodStart) ||
      !nullableDateOnly(item.periodEnd) ||
      (item.metric !== null &&
        !METRIC_KEYS_SET.has(item.metric as BuffettResearchMetricKey)) ||
      (item.value !== null && !decimal(item.value)) ||
      (item.unit !== null && item.unit !== "USD" && item.unit !== "FRACTION") ||
      (item.summary !== null && !safeSourceText(item.summary, 1, 800)) ||
      (item.sourcePath !== null && !safeSourceText(item.sourcePath, 1, 240)) ||
      ((item.value === null) !== (item.unit === null)) ||
      (item.sourceType === "SEC_XBRL" &&
        (item.metric === null || item.value === null || item.periodEnd === null)) ||
      (item.sourceType !== "SEC_XBRL" &&
        (item.metric !== null || item.value !== null || item.unit !== null))
    ) {
      return null;
    }
    seen.add(item.id);
    parsed.push(item as unknown as BuffettEvidenceItem);
  }
  return parsed;
}

function parseMetrics(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): readonly BuffettResearchMetric[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const keys = new Set<BuffettResearchMetricKey>();
  const metrics: BuffettResearchMetric[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, METRIC_KEYS) ||
      !METRIC_KEYS_SET.has(item.key as BuffettResearchMetricKey) ||
      keys.has(item.key as BuffettResearchMetricKey) ||
      !safeSourceText(item.label, 2, 80) ||
      !decimal(item.value) ||
      (item.unit !== "USD" && item.unit !== "FRACTION") ||
      !dateOnly(item.periodEnd) ||
      (item.status !== "OBSERVED" && item.status !== "DERIVED")
    ) {
      return null;
    }
    const refs = parseEvidenceRefs(item.evidenceRefs, evidenceIds, 1);
    if (refs === null) return null;
    keys.add(item.key as BuffettResearchMetricKey);
    metrics.push({
      key: item.key as BuffettResearchMetricKey,
      label: item.label,
      value: item.value,
      unit: item.unit,
      periodEnd: item.periodEnd,
      status: item.status,
      evidenceRefs: refs,
    });
  }
  return metrics;
}

function parseOwnerEarnings(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): BuffettOwnerEarningsAssessment | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, OWNER_EARNINGS_KEYS) ||
    value.status !== "ASSUMPTION_REQUIRED" ||
    !safeSourceText(value.explanation, 8, 500) ||
    (value.freeCashFlowProxyUsd !== null &&
      !decimal(value.freeCashFlowProxyUsd))
  ) {
    return null;
  }
  const refs = parseEvidenceRefs(value.evidenceRefs, evidenceIds, 0);
  return refs === null
    ? null
    : {
        status: "ASSUMPTION_REQUIRED",
        explanation: value.explanation,
        freeCashFlowProxyUsd: value.freeCashFlowProxyUsd as string | null,
        evidenceRefs: refs,
      };
}

function parseTrace(value: unknown): readonly BuffettResearchTraceStep[] | null {
  if (!Array.isArray(value) || value.length !== TRACE_STAGES.length) return null;
  const parsed: BuffettResearchTraceStep[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (
      !isRecord(item) ||
      !hasExactKeys(item, TRACE_KEYS) ||
      item.stage !== TRACE_STAGES[index] ||
      (item.status !== "COMPLETED" &&
        item.status !== "PARTIAL" &&
        item.status !== "FAILED") ||
      !safeSourceText(item.detail, 4, 240)
    ) {
      return null;
    }
    parsed.push(item as unknown as BuffettResearchTraceStep);
  }
  return parsed;
}

function parseEvidenceRefs(
  value: unknown,
  allowed: ReadonlySet<string>,
  minimum: number,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > 6) {
    return null;
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const ref of value) {
    if (
      typeof ref !== "string" ||
      !EVIDENCE_ID_PATTERN.test(ref) ||
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

export function parseBuffettResearchRequest(
  value: unknown,
): BuffettResearchRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REQUEST_KEYS) ||
    value.kind !== "BUFFETT_RESEARCH_REQUEST" ||
    value.schemaVersion !== BUFFETT_RESEARCH_SCHEMA_VERSION ||
    value.locale !== "zh-CN" ||
    !isRfc3339(value.generatedAt) ||
    !isBuffettResearchSymbol(value.symbol) ||
    !safeQuestion(value.question)
  ) {
    return null;
  }
  return value as unknown as BuffettResearchRequest;
}

export function parseBuffettResearchModelOutput(
  value: unknown,
  evidence: readonly BuffettEvidenceItem[],
): BuffettResearchModelOutput | null {
  if (!isRecord(value) || !hasExactKeys(value, MODEL_OUTPUT_KEYS)) return null;
  const allowed = new Set(evidence.map((item) => item.id));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  if (
    !safeText(value.headline, 6, 80) ||
    !safeText(value.summary, 16, 320) ||
    !Array.isArray(value.claims) ||
    value.claims.length < 1 ||
    value.claims.length > 8 ||
    !Array.isArray(value.findings) ||
    value.findings.length < 2 ||
    value.findings.length > 6 ||
    !Array.isArray(value.unknowns) ||
    value.unknowns.length < 1 ||
    value.unknowns.length > 6 ||
    value.unknowns.some((item) => !safeText(item, 6, 180)) ||
    !Array.isArray(value.counterEvidence) ||
    value.counterEvidence.length < 1 ||
    value.counterEvidence.length > 5 ||
    value.counterEvidence.some((item) => !safeText(item, 6, 180)) ||
    !Array.isArray(value.nextQuestions) ||
    value.nextQuestions.length < 1 ||
    value.nextQuestions.length > 4 ||
    value.nextQuestions.some((item) => !safeText(item, 6, 120))
  ) {
    return null;
  }

  const claims: BuffettResearchClaim[] = [];
  for (const item of value.claims) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, CLAIM_KEYS) ||
      (item.kind !== "FACT" && item.kind !== "INFERENCE") ||
      !safeText(item.text, 8, 220)
    ) {
      return null;
    }
    const refs = parseEvidenceRefs(item.evidenceRefs, allowed, 1);
    if (
      refs === null ||
      (item.kind === "FACT" &&
        !refs.some((ref) => evidenceById.get(ref)?.authority === "PRIMARY"))
    ) {
      return null;
    }
    claims.push({ kind: item.kind, text: item.text, evidenceRefs: refs });
  }

  const findings: BuffettResearchFinding[] = [];
  const seenLenses = new Set<ValueInvestingFrameworkLens>();
  for (const item of value.findings) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, FINDING_KEYS) ||
      !VALUE_INVESTING_FRAMEWORK_LENSES.includes(
        item.lens as ValueInvestingFrameworkLens,
      ) ||
      seenLenses.has(item.lens as ValueInvestingFrameworkLens) ||
      !safeText(item.title, 2, 40) ||
      !safeText(item.assessment, 10, 260) ||
      (item.confidence !== "HIGH" &&
        item.confidence !== "MEDIUM" &&
        item.confidence !== "LOW")
    ) {
      return null;
    }
    const refs = parseEvidenceRefs(item.evidenceRefs, allowed, 1);
    if (
      refs === null ||
      !refs.some((ref) => evidenceById.get(ref)?.authority === "PRIMARY")
    ) {
      return null;
    }
    seenLenses.add(item.lens as ValueInvestingFrameworkLens);
    findings.push({
      lens: item.lens as ValueInvestingFrameworkLens,
      title: item.title,
      assessment: item.assessment,
      confidence: item.confidence,
      evidenceRefs: refs,
    });
  }

  return {
    headline: value.headline,
    summary: value.summary,
    claims,
    findings,
    unknowns: value.unknowns as readonly string[],
    counterEvidence: value.counterEvidence as readonly string[],
    nextQuestions: value.nextQuestions as readonly string[],
  };
}

function isApiErrorCode(value: unknown): value is BuffettResearchApiErrorCode {
  return (
    value === "INVALID_REQUEST" ||
    value === "UNSUPPORTED_ISSUER" ||
    value === "RATE_LIMITED" ||
    value === "RESEARCH_NOT_CONFIGURED" ||
    value === "SEC_UNAVAILABLE" ||
    value === "AI_PROVIDER_UNAVAILABLE" ||
    value === "INVALID_RESEARCH_OUTPUT"
  );
}

export function parseBuffettResearchApiResponse(
  value: unknown,
  request: BuffettResearchRequest,
): BuffettResearchApiResponse | null {
  if (!isRecord(value)) return null;
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
    return value as unknown as BuffettResearchApiError;
  }
  if (
    value.kind !== "BUFFETT_RESEARCH_RESULT" ||
    !hasExactKeys(value, SUCCESS_KEYS) ||
    value.schemaVersion !== BUFFETT_RESEARCH_SCHEMA_VERSION ||
    value.promptVersion !== BUFFETT_RESEARCH_PROMPT_VERSION ||
    value.symbol !== request.symbol ||
    !isRfc3339(value.generatedAt) ||
    value.companyName !== buffettResearchIssuer(request.symbol).companyName ||
    !safeSourceText(value.model, 2, 100)
  ) {
    return null;
  }
  const evidence = parseEvidenceItems(value.evidence, request.symbol);
  if (evidence === null) return null;
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const metrics = parseMetrics(value.metrics, evidenceIds);
  const ownerEarnings = parseOwnerEarnings(value.ownerEarnings, evidenceIds);
  const trace = parseTrace(value.trace);
  if (metrics === null || ownerEarnings === null || trace === null) return null;
  const output = parseBuffettResearchModelOutput(
    {
      headline: value.headline,
      summary: value.summary,
      claims: value.claims,
      findings: value.findings,
      unknowns: value.unknowns,
      counterEvidence: value.counterEvidence,
      nextQuestions: value.nextQuestions,
    },
    evidence,
  );
  if (output === null) return null;
  return {
    ...(value as unknown as BuffettResearchSuccess),
    evidence,
    metrics,
    ownerEarnings,
    trace,
  };
}
