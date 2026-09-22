import type {
  BuffettEvidenceItem,
  BuffettResearchModelOutput,
  BuffettResearchRequest,
  BuffettResearchSuccess,
} from "../application/ai/research/buffett-research-api.ts";

export const RESEARCH_NOW = "2026-08-28T08:00:00.000Z";

export function aaplResearchRequest(): BuffettResearchRequest {
  return {
    kind: "BUFFETT_RESEARCH_REQUEST",
    schemaVersion: 1,
    generatedAt: RESEARCH_NOW,
    locale: "zh-CN",
    symbol: "AAPL",
    question: "现金创造与资本配置有哪些证据与反证？",
  };
}

export function syntheticSecSubmissions() {
  return {
    name: "Apple Inc.",
    filings: {
      recent: {
        accessionNumber: [
          "0000320193-25-000079",
          "0000320193-25-000057",
        ],
        filingDate: ["2025-10-31", "2025-08-01"],
        reportDate: ["2025-09-27", "2025-06-28"],
        form: ["10-K", "10-Q"],
        primaryDocument: ["aapl-20250927.htm", "aapl-20250628.htm"],
      },
    },
  };
}

function annualFact(val: number) {
  return {
    val,
    accn: "0000320193-25-000079",
    fy: 2025,
    fp: "FY",
    form: "10-K",
    filed: "2025-10-31",
    start: "2024-09-29",
    end: "2025-09-27",
  };
}

export function syntheticSecCompanyFacts() {
  return {
    entityName: "Apple Inc.",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          label: "Revenue",
          units: { USD: [annualFact(416_161_000_000)] },
        },
        NetIncomeLoss: {
          label: "Net income",
          units: { USD: [annualFact(112_010_000_000)] },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          label: "Operating cash flow",
          units: { USD: [annualFact(133_475_000_000)] },
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          label: "Capital expenditures",
          units: { USD: [annualFact(12_715_000_000)] },
        },
        CashAndCashEquivalentsAtCarryingValue: {
          label: "Cash and equivalents",
          units: {
            USD: [
              {
                val: 35_934_000_000,
                accn: "0000320193-25-000079",
                form: "10-K",
                filed: "2025-10-31",
                end: "2025-09-27",
              },
            ],
          },
        },
      },
    },
  };
}

export function officialWebSearchResponse() {
  const text =
    "公司官方材料描述了持续的现金返还与业务风险。SEC 定期报告提供了资本配置与风险的一手披露。";
  return {
    status: "completed",
    output: [
      {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          sources: [
            {
              type: "url",
              url: "https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/",
            },
            {
              type: "url",
              url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
            },
          ],
        },
      },
      {
        type: "message",
        status: "completed",
        content: [
          {
            type: "output_text",
            text,
            annotations: [
              {
                type: "url_citation",
                url: "https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/",
                title: "Apple reports results",
                start_index: 0,
                end_index: 27,
              },
              {
                type: "url_citation",
                url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
                title: "Apple Form 10-K",
                start_index: 27,
                end_index: text.length,
              },
            ],
          },
        ],
      },
    ],
  };
}

export function aaplModelOutput(): BuffettResearchModelOutput {
  return {
    headline: "现金创造有一手数据支撑，维持性投入仍是关键未知",
    summary:
      "SEC 事实显示经营现金流与资本支出可建立稳定桥接，但公开资料尚不足以把总资本支出拆成维持与增长部分。",
    claims: [
      {
        kind: "FACT",
        text: "定期报告提供了经营现金流和资本支出的可复核事实。",
        evidenceRefs: [
          "sec.xbrl.operating_cash_flow.2025-09-27",
          "sec.xbrl.capital_expenditures.2025-09-27",
        ],
      },
      {
        kind: "INFERENCE",
        text: "现金创造能力值得继续追踪，但不能仅凭现金流代理值代替所有者收益。",
        evidenceRefs: [
          "sec.xbrl.operating_cash_flow.2025-09-27",
          "sec.xbrl.capital_expenditures.2025-09-27",
        ],
      },
    ],
    findings: [
      {
        lens: "OWNER_EARNINGS",
        title: "所有者收益桥接",
        assessment:
          "经营现金流与总资本支出已可复核，但维持性投入与增量营运资本仍需额外假设。",
        confidence: "MEDIUM",
        evidenceRefs: [
          "sec.xbrl.operating_cash_flow.2025-09-27",
          "sec.xbrl.capital_expenditures.2025-09-27",
        ],
      },
      {
        lens: "EVIDENCE_GAP",
        title: "维持性投入缺口",
        assessment:
          "公开数据没有直接标记为保持竞争位置所必需的支出，应保留为假设而非事实。",
        confidence: "HIGH",
        evidenceRefs: ["sec.filing.10k.000032019325000079"],
      },
    ],
    unknowns: ["维持现有竞争地位所需的资本支出尚未被可靠拆分。"],
    counterEvidence: ["总资本支出可能包含大量增长性投入，也可能低估未来维持需求。"],
    nextQuestions: ["公司是否披露能区分维持与增长投入的资本支出口径？"],
  };
}

export function synthesisResponse(
  output: BuffettResearchModelOutput = aaplModelOutput(),
) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(output),
            annotations: [],
          },
        ],
      },
    ],
  };
}

export function aaplEvidenceForContract(): readonly BuffettEvidenceItem[] {
  return [
    {
      id: "sec.filing.10k.000032019325000079",
      sourceType: "SEC_FILING",
      authority: "PRIMARY",
      title: "Apple Inc. 10-K",
      url: "https://www.sec.gov/example",
      retrievedAt: RESEARCH_NOW,
      filedAt: "2025-10-31",
      periodStart: null,
      periodEnd: "2025-09-27",
      metric: null,
      value: null,
      unit: null,
      summary: null,
      sourcePath: "0000320193-25-000079",
    },
    {
      id: "sec.xbrl.operating_cash_flow.2025-09-27",
      sourceType: "SEC_XBRL",
      authority: "PRIMARY",
      title: "Operating cash flow",
      url: "https://www.sec.gov/example",
      retrievedAt: RESEARCH_NOW,
      filedAt: "2025-10-31",
      periodStart: "2024-09-29",
      periodEnd: "2025-09-27",
      metric: "OPERATING_CASH_FLOW",
      value: "133475000000",
      unit: "USD",
      summary: null,
      sourcePath: "us-gaap.NetCashProvidedByUsedInOperatingActivities",
    },
    {
      id: "sec.xbrl.capital_expenditures.2025-09-27",
      sourceType: "SEC_XBRL",
      authority: "PRIMARY",
      title: "Capital expenditures",
      url: "https://www.sec.gov/example",
      retrievedAt: RESEARCH_NOW,
      filedAt: "2025-10-31",
      periodStart: "2024-09-29",
      periodEnd: "2025-09-27",
      metric: "CAPITAL_EXPENDITURES",
      value: "12715000000",
      unit: "USD",
      summary: null,
      sourcePath: "us-gaap.PaymentsToAcquirePropertyPlantAndEquipment",
    },
  ];
}

export function aaplResearchSuccess(): BuffettResearchSuccess {
  const evidence = aaplEvidenceForContract();
  return {
    kind: "BUFFETT_RESEARCH_RESULT",
    schemaVersion: 1,
    generatedAt: RESEARCH_NOW,
    symbol: "AAPL",
    companyName: "Apple Inc.",
    model: "gpt-5.5",
    promptVersion: "buffett-research-v1",
    ...aaplModelOutput(),
    evidence,
    metrics: [
      {
        key: "OPERATING_CASH_FLOW",
        label: "经营现金流",
        value: "133475000000",
        unit: "USD",
        periodEnd: "2025-09-27",
        status: "OBSERVED",
        evidenceRefs: ["sec.xbrl.operating_cash_flow.2025-09-27"],
      },
      {
        key: "CAPITAL_EXPENDITURES",
        label: "资本支出",
        value: "12715000000",
        unit: "USD",
        periodEnd: "2025-09-27",
        status: "OBSERVED",
        evidenceRefs: ["sec.xbrl.capital_expenditures.2025-09-27"],
      },
      {
        key: "FREE_CASH_FLOW_PROXY",
        label: "自由现金流代理",
        value: "120760000000",
        unit: "USD",
        periodEnd: "2025-09-27",
        status: "DERIVED",
        evidenceRefs: [
          "sec.xbrl.operating_cash_flow.2025-09-27",
          "sec.xbrl.capital_expenditures.2025-09-27",
        ],
      },
    ],
    ownerEarnings: {
      status: "ASSUMPTION_REQUIRED",
      explanation:
        "当前只能计算现金流代理，维持性资本支出仍需假设。",
      freeCashFlowProxyUsd: "120760000000",
      evidenceRefs: [
        "sec.xbrl.operating_cash_flow.2025-09-27",
        "sec.xbrl.capital_expenditures.2025-09-27",
      ],
    },
    trace: [
      { stage: "PLAN", status: "COMPLETED", detail: "已锁定官方来源。" },
      {
        stage: "SEC_RETRIEVAL",
        status: "COMPLETED",
        detail: "已取得 SEC 事实。",
      },
      {
        stage: "WEB_SEARCH",
        status: "COMPLETED",
        detail: "已完成受限 Web Search。",
      },
      {
        stage: "CALCULATION",
        status: "COMPLETED",
        detail: "已完成确定性计算。",
      },
      {
        stage: "SYNTHESIS",
        status: "COMPLETED",
        detail: "已完成框架综合。",
      },
      {
        stage: "EVIDENCE_GATE",
        status: "COMPLETED",
        detail: "证据门禁通过。",
      },
    ],
  };
}
