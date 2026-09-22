import {
  parseBuffettResearchModelOutput,
  type BuffettEvidenceItem,
  type BuffettOwnerEarningsAssessment,
  type BuffettResearchMetric,
  type BuffettResearchModelOutput,
  type BuffettResearchRequest,
} from "../buffett-research-api.ts";
import {
  buffettSynthesisInput,
  buffettSynthesisInstructions,
  officialWebResearchInput,
  officialWebResearchInstructions,
} from "../buffett-research-prompts.ts";
import {
  VALUE_INVESTING_FRAMEWORK_LENSES,
} from "../../value-investing-framework.ts";
import type { BuffettResearchIssuer } from "../supported-issuers.ts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_OPENAI_RESPONSE_BYTES = 1_048_576;

export type OpenAiBuffettResearchErrorCode =
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_OUTPUT";

export class OpenAiBuffettResearchError extends Error {
  readonly code: OpenAiBuffettResearchErrorCode;

  constructor(code: OpenAiBuffettResearchErrorCode, message: string) {
    super(message);
    this.name = "OpenAiBuffettResearchError";
    this.code = code;
  }
}

export interface OpenAiBuffettResearchConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly retrievedAt: string;
}

interface OpenAiAnnotation {
  readonly type?: unknown;
  readonly url?: unknown;
  readonly title?: unknown;
  readonly start_index?: unknown;
  readonly end_index?: unknown;
  readonly url_citation?: {
    readonly url?: unknown;
    readonly title?: unknown;
    readonly start_index?: unknown;
    readonly end_index?: unknown;
  };
}

interface OpenAiContentPart {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly annotations?: readonly OpenAiAnnotation[];
}

interface OpenAiOutputItem {
  readonly type?: unknown;
  readonly action?: {
    readonly sources?: readonly {
      readonly type?: unknown;
      readonly url?: unknown;
    }[];
  };
  readonly content?: readonly OpenAiContentPart[];
}

interface OpenAiResponseBody {
  readonly status?: unknown;
  readonly output?: readonly OpenAiOutputItem[];
}

interface CitationRecord {
  readonly url: string;
  readonly title: string | null;
  readonly summary: string | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function requestOpenAi(
  body: Readonly<Record<string, unknown>>,
  config: OpenAiBuffettResearchConfig,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    throw new OpenAiBuffettResearchError(
      "PROVIDER_UNAVAILABLE",
      "OpenAI 研究服务暂时无法连接。",
    );
  }
  if (response.status === 429) {
    throw new OpenAiBuffettResearchError(
      "RATE_LIMITED",
      "OpenAI 研究请求较多，请稍后重试。",
    );
  }
  if (!response.ok) {
    throw new OpenAiBuffettResearchError(
      "PROVIDER_UNAVAILABLE",
      "OpenAI 研究服务暂时不可用。",
    );
  }
  const raw = await response.text();
  if (byteLength(raw) > MAX_OPENAI_RESPONSE_BYTES) {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI 研究返回内容超出边界。",
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI 研究返回内容无效。",
    );
  }
}

function isAllowedUrl(
  value: string,
  allowedDomains: readonly string[],
): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      allowedDomains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

function outputText(response: OpenAiResponseBody): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter(
      (part): part is OpenAiContentPart & { readonly text: string } =>
        part.type === "output_text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function citationValue(
  annotation: OpenAiAnnotation,
): {
  readonly url: string | null;
  readonly title: string | null;
  readonly start: number | null;
  readonly end: number | null;
} {
  const nested = annotation.url_citation;
  const urlValue = nested?.url ?? annotation.url;
  const titleValue = nested?.title ?? annotation.title;
  const startValue = nested?.start_index ?? annotation.start_index;
  const endValue = nested?.end_index ?? annotation.end_index;
  return {
    url: typeof urlValue === "string" ? urlValue : null,
    title: typeof titleValue === "string" ? titleValue : null,
    start: Number.isSafeInteger(startValue) ? (startValue as number) : null,
    end: Number.isSafeInteger(endValue) ? (endValue as number) : null,
  };
}

function citations(
  response: OpenAiResponseBody,
  text: string,
  allowedDomains: readonly string[],
): readonly CitationRecord[] {
  const byUrl = new Map<string, CitationRecord>();
  for (const item of response.output ?? []) {
    for (const source of item.action?.sources ?? []) {
      if (
        source.type === "url" &&
        typeof source.url === "string" &&
        isAllowedUrl(source.url, allowedDomains)
      ) {
        byUrl.set(source.url, {
          url: source.url,
          title: null,
          summary: null,
        });
      }
    }
    for (const part of item.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== "url_citation") continue;
        const value = citationValue(annotation);
        if (
          value.url === null ||
          !isAllowedUrl(value.url, allowedDomains)
        ) {
          continue;
        }
        const summary =
          value.start !== null &&
          value.end !== null &&
          value.start >= 0 &&
          value.end > value.start &&
          value.end <= text.length
            ? text.slice(value.start, value.end).trim()
            : null;
        byUrl.set(value.url, {
          url: value.url,
          title: value.title,
          summary: summary === "" ? null : summary,
        });
      }
    }
  }
  return [...byUrl.values()].toSorted((left, right) =>
    left.url.localeCompare(right.url),
  );
}

function webEvidence(
  issuer: BuffettResearchIssuer,
  records: readonly CitationRecord[],
  retrievedAt: string,
): readonly BuffettEvidenceItem[] {
  return records.map((record, index) => ({
    id: `web.official.${issuer.symbol.toLowerCase()}.${index + 1}`,
    sourceType: "OFFICIAL_WEB" as const,
    authority: "DISCOVERY" as const,
    title: record.title ?? new URL(record.url).hostname,
    url: record.url,
    retrievedAt,
    filedAt: null,
    periodStart: null,
    periodEnd: null,
    metric: null,
    value: null,
    unit: null,
    summary: record.summary,
    sourcePath: null,
  }));
}

export interface OfficialWebResearchResult {
  readonly summary: string;
  readonly evidence: readonly BuffettEvidenceItem[];
}

export async function researchOfficialWebWithOpenAi(
  request: BuffettResearchRequest,
  issuer: BuffettResearchIssuer,
  config: OpenAiBuffettResearchConfig,
  signal: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OfficialWebResearchResult> {
  const raw = await requestOpenAi(
    {
      model: config.model,
      store: false,
      reasoning: { effort: "medium" },
      instructions: officialWebResearchInstructions(issuer),
      input: officialWebResearchInput(request, issuer),
      tools: [
        {
          type: "web_search",
          external_web_access: true,
          search_context_size: "high",
          filters: { allowed_domains: issuer.allowedWebDomains },
        },
      ],
      tool_choice: { type: "web_search" },
      include: ["web_search_call.action.sources"],
      max_output_tokens: 1_800,
    },
    config,
    signal,
    fetchImpl,
  );
  if (!isRecord(raw)) {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI Web Search 返回结构无效。",
    );
  }
  const response = raw as unknown as OpenAiResponseBody;
  const summary = outputText(response);
  const sourceRecords = citations(
    response,
    summary,
    issuer.allowedWebDomains,
  );
  if (response.status !== "completed" || summary === "" || sourceRecords.length < 1) {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI Web Search 没有返回可验证官方来源。",
    );
  }
  return {
    summary,
    evidence: webEvidence(issuer, sourceRecords, config.retrievedAt),
  };
}

function synthesisSchema(evidenceRefs: readonly string[]) {
  const text = { type: "string" } as const;
  const refs = {
    type: "array",
    items: { type: "string", enum: evidenceRefs },
  } as const;
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: text,
      summary: text,
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["FACT", "INFERENCE"] },
            text,
            evidenceRefs: refs,
          },
          required: ["kind", "text", "evidenceRefs"],
        },
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            lens: { type: "string", enum: VALUE_INVESTING_FRAMEWORK_LENSES },
            title: text,
            assessment: text,
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            evidenceRefs: refs,
          },
          required: [
            "lens",
            "title",
            "assessment",
            "confidence",
            "evidenceRefs",
          ],
        },
      },
      unknowns: { type: "array", items: text },
      counterEvidence: { type: "array", items: text },
      nextQuestions: { type: "array", items: text },
    },
    required: [
      "headline",
      "summary",
      "claims",
      "findings",
      "unknowns",
      "counterEvidence",
      "nextQuestions",
    ],
  } as const;
}

export async function synthesizeBuffettResearchWithOpenAi(
  args: {
    readonly request: BuffettResearchRequest;
    readonly companyName: string;
    readonly evidence: readonly BuffettEvidenceItem[];
    readonly metrics: readonly BuffettResearchMetric[];
    readonly ownerEarnings: BuffettOwnerEarningsAssessment;
    readonly webResearchSummary: string;
  },
  config: OpenAiBuffettResearchConfig,
  signal: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<BuffettResearchModelOutput> {
  const raw = await requestOpenAi(
    {
      model: config.model,
      store: false,
      reasoning: { effort: "medium" },
      instructions: buffettSynthesisInstructions(),
      input: buffettSynthesisInput(args),
      text: {
        format: {
          type: "json_schema",
          name: "buffett_research_result",
          strict: true,
          schema: synthesisSchema(args.evidence.map((item) => item.id)),
        },
      },
      max_output_tokens: 2_800,
    },
    config,
    signal,
    fetchImpl,
  );
  if (!isRecord(raw)) {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI 综合返回结构无效。",
    );
  }
  const response = raw as unknown as OpenAiResponseBody;
  const content = outputText(response);
  if (response.status !== "completed" || content === "") {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI 综合未返回完整结果。",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI 综合返回内容无效。",
    );
  }
  const output = parseBuffettResearchModelOutput(parsed, args.evidence);
  if (output === null) {
    throw new OpenAiBuffettResearchError(
      "INVALID_PROVIDER_OUTPUT",
      "OpenAI 综合结果未通过证据约束。",
    );
  }
  return output;
}
