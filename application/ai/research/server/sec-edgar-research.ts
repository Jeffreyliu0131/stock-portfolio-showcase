import type {
  BuffettEvidenceItem,
  BuffettResearchMetricKey,
} from "../buffett-research-api.ts";
import type { BuffettResearchIssuer } from "../supported-issuers.ts";

const SEC_BASE_URL = "https://data.sec.gov";
const MAX_SEC_RESPONSE_BYTES = 8_000_000;

type SecFlowMetricKey = Exclude<
  BuffettResearchMetricKey,
  "FREE_CASH_FLOW_PROXY" | "NET_MARGIN" | "CASH_AND_EQUIVALENTS"
>;

const FLOW_TAGS: Readonly<
  Record<SecFlowMetricKey, readonly string[]>
> = {
  REVENUE: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ],
  NET_INCOME: ["NetIncomeLoss", "ProfitLoss"],
  OPERATING_CASH_FLOW: ["NetCashProvidedByUsedInOperatingActivities"],
  CAPITAL_EXPENDITURES: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsForProceedsFromOtherPropertyPlantAndEquipment",
  ],
};

const CASH_TAGS = [
  "CashAndCashEquivalentsAtCarryingValue",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
] as const;

export type SecEdgarResearchErrorCode =
  | "SEC_UNAVAILABLE"
  | "INVALID_SEC_RESPONSE";

export class SecEdgarResearchError extends Error {
  readonly code: SecEdgarResearchErrorCode;

  constructor(code: SecEdgarResearchErrorCode, message: string) {
    super(message);
    this.name = "SecEdgarResearchError";
    this.code = code;
  }
}

export interface SecEdgarResearchConfig {
  readonly userAgent: string;
  readonly retrievedAt: string;
}

interface SecRecentFilings {
  readonly accessionNumber?: readonly string[];
  readonly filingDate?: readonly string[];
  readonly reportDate?: readonly string[];
  readonly form?: readonly string[];
  readonly primaryDocument?: readonly string[];
}

interface SecSubmissionsResponse {
  readonly name?: unknown;
  readonly filings?: { readonly recent?: SecRecentFilings };
}

interface SecFactEntry {
  readonly val?: unknown;
  readonly accn?: unknown;
  readonly fy?: unknown;
  readonly fp?: unknown;
  readonly form?: unknown;
  readonly filed?: unknown;
  readonly start?: unknown;
  readonly end?: unknown;
}

interface SecFactConcept {
  readonly label?: unknown;
  readonly units?: Readonly<Record<string, readonly SecFactEntry[]>>;
}

interface SecCompanyFactsResponse {
  readonly entityName?: unknown;
  readonly facts?: Readonly<
    Record<string, Readonly<Record<string, SecFactConcept>>>
  >;
}

interface FilingRecord {
  readonly accessionNumber: string;
  readonly filingDate: string;
  readonly reportDate: string | null;
  readonly form: string;
  readonly primaryDocument: string | null;
}

interface SelectedFact {
  readonly tag: string;
  readonly label: string;
  readonly value: string;
  readonly accessionNumber: string;
  readonly filedAt: string;
  readonly periodStart: string | null;
  readonly periodEnd: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function fetchJson(
  url: string,
  userAgent: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    throw new SecEdgarResearchError(
      "SEC_UNAVAILABLE",
      "SEC EDGAR 暂时无法连接。",
    );
  }
  if (!response.ok) {
    throw new SecEdgarResearchError(
      "SEC_UNAVAILABLE",
      "SEC EDGAR 暂时不可用。",
    );
  }
  const raw = await response.text();
  if (textByteLength(raw) > MAX_SEC_RESPONSE_BYTES) {
    throw new SecEdgarResearchError(
      "INVALID_SEC_RESPONSE",
      "SEC EDGAR 返回内容超出边界。",
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new SecEdgarResearchError(
      "INVALID_SEC_RESPONSE",
      "SEC EDGAR 返回内容无效。",
    );
  }
}

function filingRecords(value: unknown): readonly FilingRecord[] {
  if (!isRecord(value)) return [];
  const response = value as unknown as SecSubmissionsResponse;
  const recent = response.filings?.recent;
  const accessions = recent?.accessionNumber ?? [];
  const records: FilingRecord[] = [];
  for (let index = 0; index < accessions.length; index += 1) {
    const accessionNumber = accessions[index];
    const filingDate = recent?.filingDate?.[index];
    const form = recent?.form?.[index];
    if (
      typeof accessionNumber !== "string" ||
      typeof filingDate !== "string" ||
      typeof form !== "string"
    ) {
      continue;
    }
    records.push({
      accessionNumber,
      filingDate,
      reportDate:
        typeof recent?.reportDate?.[index] === "string"
          ? recent.reportDate[index]!
          : null,
      form,
      primaryDocument:
        typeof recent?.primaryDocument?.[index] === "string"
          ? recent.primaryDocument[index]!
          : null,
    });
  }
  return records;
}

function filingUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string | null,
): string {
  const directory = accessionNumber.replaceAll("-", "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${directory}/`;
  return primaryDocument === null ? base : `${base}${primaryDocument}`;
}

function filingEvidence(
  issuer: BuffettResearchIssuer,
  records: readonly FilingRecord[],
  form: "10-K" | "10-Q",
  retrievedAt: string,
): BuffettEvidenceItem | null {
  const record = records.find((candidate) => candidate.form === form);
  if (record === undefined) return null;
  return {
    id: `sec.filing.${form.toLowerCase().replace("-", "")}.${record.accessionNumber.replaceAll("-", "")}`,
    sourceType: "SEC_FILING",
    authority: "PRIMARY",
    title: `${issuer.companyName} ${form}`,
    url: filingUrl(issuer.cik, record.accessionNumber, record.primaryDocument),
    retrievedAt,
    filedAt: record.filingDate,
    periodStart: null,
    periodEnd: record.reportDate,
    metric: null,
    value: null,
    unit: null,
    summary: null,
    sourcePath: record.accessionNumber,
  };
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime())
  );
}

function selectedFact(
  facts: SecCompanyFactsResponse,
  tags: readonly string[],
  kind: "FLOW" | "INSTANT",
): SelectedFact | null {
  const candidates = tags.flatMap(tag => {
    const found = { tag, concept: facts.facts?.["us-gaap"]?.[tag] };
    const entries = found.concept?.units?.USD;
    if (!found.concept || !Array.isArray(entries)) return [];
    const label = typeof found.concept.label === "string" ? found.concept.label : tag;
    return entries.flatMap((entry) => {
    if (
      typeof entry.val !== "number" ||
      !Number.isFinite(entry.val) ||
      typeof entry.accn !== "string" ||
      typeof entry.form !== "string" ||
      !validDate(entry.filed) ||
      !validDate(entry.end) ||
      (kind === "FLOW" && !validDate(entry.start))
    ) {
      return [];
    }
    if (
      kind === "FLOW" &&
      ((entry.form !== "10-K" && entry.form !== "10-K/A") ||
        (entry.fp !== undefined && entry.fp !== "FY") ||
        (Date.parse(entry.end as string) - Date.parse(entry.start as string)) / 86_400_000 < 330 ||
        (Date.parse(entry.end as string) - Date.parse(entry.start as string)) / 86_400_000 > 400)
    ) {
      return [];
    }
    if (
      kind === "INSTANT" &&
      entry.form !== "10-K" && entry.form !== "10-K/A" &&
      entry.form !== "10-Q" && entry.form !== "10-Q/A"
    ) {
      return [];
    }
    return [
      {
        tag: found.tag,
        label,
        value: String(entry.val),
        accessionNumber: entry.accn,
        filedAt: entry.filed,
        periodStart: kind === "FLOW" ? (entry.start as string) : null,
        periodEnd: entry.end,
      },
    ];
    });
  });
  return (
    candidates.toSorted((left, right) => {
      const end = right.periodEnd.localeCompare(left.periodEnd);
      return end || right.filedAt.localeCompare(left.filedAt)
        || tags.indexOf(left.tag) - tags.indexOf(right.tag)
        || right.accessionNumber.localeCompare(left.accessionNumber);
    })[0] ?? null
  );
}

function metricEvidence(
  issuer: BuffettResearchIssuer,
  records: readonly FilingRecord[],
  metric: BuffettResearchMetricKey,
  fact: SelectedFact,
  retrievedAt: string,
): BuffettEvidenceItem {
  const filing = records.find(
    (record) => record.accessionNumber === fact.accessionNumber,
  );
  return {
    id: `sec.xbrl.${metric.toLowerCase()}.${fact.periodEnd}`,
    sourceType: "SEC_XBRL",
    authority: "PRIMARY",
    title: `${issuer.companyName} · ${fact.label}`,
    url: filingUrl(
      issuer.cik,
      fact.accessionNumber,
      filing?.primaryDocument ?? null,
    ),
    retrievedAt,
    filedAt: fact.filedAt,
    periodStart: fact.periodStart,
    periodEnd: fact.periodEnd,
    metric,
    value: fact.value,
    unit: "USD",
    summary: null,
    sourcePath: `us-gaap.${fact.tag}`,
  };
}

export interface SecEdgarResearchResult {
  readonly companyName: string;
  readonly evidence: readonly BuffettEvidenceItem[];
}

export async function researchIssuerWithSec(
  issuer: BuffettResearchIssuer,
  config: SecEdgarResearchConfig,
  signal: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SecEdgarResearchResult> {
  if (config.userAgent.trim().length < 8) {
    throw new SecEdgarResearchError(
      "SEC_UNAVAILABLE",
      "SEC EDGAR User-Agent 未配置。",
    );
  }
  const [submissionsRaw, companyFactsRaw] = await Promise.all([
    fetchJson(
      `${SEC_BASE_URL}/submissions/CIK${issuer.cik}.json`,
      config.userAgent,
      signal,
      fetchImpl,
    ),
    fetchJson(
      `${SEC_BASE_URL}/api/xbrl/companyfacts/CIK${issuer.cik}.json`,
      config.userAgent,
      signal,
      fetchImpl,
    ),
  ]);
  if (!isRecord(companyFactsRaw)) {
    throw new SecEdgarResearchError(
      "INVALID_SEC_RESPONSE",
      "SEC 公司事实结构无效。",
    );
  }
  const companyFacts = companyFactsRaw as unknown as SecCompanyFactsResponse;
  const records = filingRecords(submissionsRaw);
  const evidence: BuffettEvidenceItem[] = [];
  for (const form of ["10-K", "10-Q"] as const) {
    const filing = filingEvidence(
      issuer,
      records,
      form,
      config.retrievedAt,
    );
    if (filing !== null) evidence.push(filing);
  }
  for (const [metric, tags] of Object.entries(FLOW_TAGS) as readonly [
    SecFlowMetricKey,
    readonly string[],
  ][]) {
    const fact = selectedFact(companyFacts, tags, "FLOW");
    if (fact !== null) {
      evidence.push(
        metricEvidence(issuer, records, metric, fact, config.retrievedAt),
      );
    }
  }
  const cash = selectedFact(companyFacts, CASH_TAGS, "INSTANT");
  if (cash !== null) {
    evidence.push(
      metricEvidence(
        issuer,
        records,
        "CASH_AND_EQUIVALENTS",
        cash,
        config.retrievedAt,
      ),
    );
  }
  if (evidence.length < 3) {
    throw new SecEdgarResearchError(
      "INVALID_SEC_RESPONSE",
      "SEC 资料不足以建立研究证据。",
    );
  }
  return {
    companyName:
      typeof companyFacts.entityName === "string"
        ? companyFacts.entityName
        : issuer.companyName,
    evidence,
  };
}
