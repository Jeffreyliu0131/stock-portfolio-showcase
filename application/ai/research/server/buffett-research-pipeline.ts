import {
  BUFFETT_RESEARCH_PROMPT_VERSION,
  BUFFETT_RESEARCH_SCHEMA_VERSION,
  type BuffettEvidenceItem,
  type BuffettResearchRequest,
  type BuffettResearchSuccess,
  type BuffettResearchTraceStep,
} from "../buffett-research-api.ts";
import { calculateBuffettResearchMetrics } from "../buffett-research-calculations.ts";
import { buffettResearchIssuer } from "../supported-issuers.ts";
import {
  researchOfficialWebWithOpenAi,
  synthesizeBuffettResearchWithOpenAi,
  type OpenAiBuffettResearchConfig,
} from "./openai-buffett-research.ts";
import {
  researchIssuerWithSec,
  type SecEdgarResearchConfig,
} from "./sec-edgar-research.ts";

export const BUFFETT_RESEARCH_TIMEOUT_MS = 45_000;

export interface BuffettResearchPipelineConfig {
  readonly openAi: OpenAiBuffettResearchConfig;
  readonly sec: SecEdgarResearchConfig;
  readonly timeoutMs?: number;
  readonly generatedAt: string;
}

function assertUniqueEvidence(
  evidence: readonly BuffettEvidenceItem[],
): void {
  const ids = new Set<string>();
  for (const item of evidence) {
    if (ids.has(item.id)) {
      throw new Error(`duplicate research evidence id: ${item.id}`);
    }
    ids.add(item.id);
  }
}

export async function runBuffettResearchPipeline(
  request: BuffettResearchRequest,
  config: BuffettResearchPipelineConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<BuffettResearchSuccess> {
  const issuer = buffettResearchIssuer(request.symbol);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? BUFFETT_RESEARCH_TIMEOUT_MS,
  );
  try {
    const trace: BuffettResearchTraceStep[] = [
      {
        stage: "PLAN",
        status: "COMPLETED",
        detail: "已锁定受支持发行人、SEC 与公司官方来源。",
      },
    ];
    const [sec, web] = await Promise.all([
      researchIssuerWithSec(
        issuer,
        config.sec,
        controller.signal,
        fetchImpl,
      ),
      researchOfficialWebWithOpenAi(
        request,
        issuer,
        config.openAi,
        controller.signal,
        fetchImpl,
      ),
    ]);
    trace.push(
      {
        stage: "SEC_RETRIEVAL",
        status: "COMPLETED",
        detail: "已取得最新定期报告元数据与 XBRL 事实。",
      },
      {
        stage: "WEB_SEARCH",
        status: "COMPLETED",
        detail: "已限定 SEC 与公司官方域名完成 Web Search。",
      },
    );
    const evidence = [...sec.evidence, ...web.evidence];
    assertUniqueEvidence(evidence);
    const calculations = calculateBuffettResearchMetrics(evidence);
    trace.push({
      stage: "CALCULATION",
      status: "COMPLETED",
      detail:
        "已在服务端从 SEC 事实派生指标，所有者收益保留必需假设缺口。",
    });
    const output = await synthesizeBuffettResearchWithOpenAi(
      {
        request,
        companyName: issuer.companyName,
        evidence,
        metrics: calculations.metrics,
        ownerEarnings: calculations.ownerEarnings,
        webResearchSummary: web.summary,
      },
      config.openAi,
      controller.signal,
      fetchImpl,
    );
    trace.push(
      {
        stage: "SYNTHESIS",
        status: "COMPLETED",
        detail: "已仅使用通过边界的 Evidence Ledger 应用价值投资框架。",
      },
      {
        stage: "EVIDENCE_GATE",
        status: "COMPLETED",
        detail: "所有事实、推断与 lens finding 均引用当前证据 id。",
      },
    );
    return {
      kind: "BUFFETT_RESEARCH_RESULT",
      schemaVersion: BUFFETT_RESEARCH_SCHEMA_VERSION,
      generatedAt: config.generatedAt,
      symbol: issuer.symbol,
      companyName: issuer.companyName,
      model: config.openAi.model,
      promptVersion: BUFFETT_RESEARCH_PROMPT_VERSION,
      ...output,
      evidence,
      metrics: calculations.metrics,
      ownerEarnings: calculations.ownerEarnings,
      trace,
    };
  } finally {
    clearTimeout(timeout);
  }
}
