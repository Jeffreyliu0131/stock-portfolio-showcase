import { Decimal } from "../../../domain/index.ts";
import type {
  BuffettEvidenceItem,
  BuffettOwnerEarningsAssessment,
  BuffettResearchMetric,
  BuffettResearchMetricKey,
} from "./buffett-research-api.ts";

const METRIC_LABELS: Readonly<Record<BuffettResearchMetricKey, string>> = {
  REVENUE: "营业收入",
  NET_INCOME: "净利润",
  OPERATING_CASH_FLOW: "经营现金流",
  CAPITAL_EXPENDITURES: "资本支出",
  FREE_CASH_FLOW_PROXY: "自由现金流代理",
  NET_MARGIN: "净利率",
  CASH_AND_EQUIVALENTS: "现金及等价物",
};

function observedMetric(
  evidence: BuffettEvidenceItem,
): BuffettResearchMetric | null {
  if (
    evidence.metric === null ||
    evidence.value === null ||
    evidence.unit === null ||
    evidence.periodEnd === null
  ) {
    return null;
  }
  return {
    key: evidence.metric,
    label: METRIC_LABELS[evidence.metric],
    value: evidence.value,
    unit: evidence.unit,
    periodEnd: evidence.periodEnd,
    status: "OBSERVED",
    evidenceRefs: [evidence.id],
  };
}

function evidenceFor(
  evidence: readonly BuffettEvidenceItem[],
  key: BuffettResearchMetricKey,
): BuffettEvidenceItem | null {
  return (
    evidence.find(
      (item) =>
        item.metric === key && item.value !== null && item.periodEnd !== null,
    ) ?? null
  );
}

function comparableAnnualFacts(left: BuffettEvidenceItem, right: BuffettEvidenceItem): boolean {
  if (left.sourceType !== "SEC_XBRL" || right.sourceType !== "SEC_XBRL" ||
      left.unit !== "USD" || right.unit !== "USD" ||
      !left.periodStart || left.periodStart !== right.periodStart ||
      !left.periodEnd || left.periodEnd !== right.periodEnd ||
      !left.filedAt || left.filedAt !== right.filedAt) return false;
  const days = (Date.parse(left.periodEnd) - Date.parse(left.periodStart)) / 86_400_000;
  return days >= 330 && days <= 400;
}

export interface BuffettResearchCalculations {
  readonly metrics: readonly BuffettResearchMetric[];
  readonly ownerEarnings: BuffettOwnerEarningsAssessment;
}

export function calculateBuffettResearchMetrics(
  evidence: readonly BuffettEvidenceItem[],
): BuffettResearchCalculations {
  const observed = evidence.flatMap((item) => {
    const metric = observedMetric(item);
    return metric === null ? [] : [metric];
  });
  const derived: BuffettResearchMetric[] = [];

  const revenue = evidenceFor(evidence, "REVENUE");
  const netIncome = evidenceFor(evidence, "NET_INCOME");
  if (
    revenue !== null &&
    netIncome !== null &&
    revenue.periodEnd !== null &&
    comparableAnnualFacts(revenue, netIncome) &&
    revenue.value !== null &&
    netIncome.value !== null &&
    !new Decimal(revenue.value).isZero()
  ) {
    derived.push({
      key: "NET_MARGIN",
      label: METRIC_LABELS.NET_MARGIN,
      value: new Decimal(netIncome.value).div(revenue.value).toString(),
      unit: "FRACTION",
      periodEnd: revenue.periodEnd,
      status: "DERIVED",
      evidenceRefs: [revenue.id, netIncome.id],
    });
  }

  const operatingCashFlow = evidenceFor(evidence, "OPERATING_CASH_FLOW");
  const capitalExpenditures = evidenceFor(evidence, "CAPITAL_EXPENDITURES");
  let freeCashFlowProxyUsd: string | null = null;
  let ownerEvidenceRefs: readonly string[] = [];
  if (
    operatingCashFlow !== null &&
    capitalExpenditures !== null &&
    operatingCashFlow.periodEnd !== null &&
    comparableAnnualFacts(operatingCashFlow, capitalExpenditures) &&
    operatingCashFlow.value !== null &&
    capitalExpenditures.value !== null
  ) {
    freeCashFlowProxyUsd = new Decimal(operatingCashFlow.value)
      .minus(capitalExpenditures.value)
      .toString();
    ownerEvidenceRefs = [operatingCashFlow.id, capitalExpenditures.id];
    derived.push({
      key: "FREE_CASH_FLOW_PROXY",
      label: METRIC_LABELS.FREE_CASH_FLOW_PROXY,
      value: freeCashFlowProxyUsd,
      unit: "USD",
      periodEnd: operatingCashFlow.periodEnd,
      status: "DERIVED",
      evidenceRefs: ownerEvidenceRefs,
    });
  }

  return {
    metrics: [...observed, ...derived],
    ownerEarnings: {
      status: "ASSUMPTION_REQUIRED",
      explanation:
        "当前只能计算经营现金流减总资本支出的代理值；维持竞争地位所需的资本支出与增量营运资本尚未被可靠拆分，因此不生成精确所有者收益。",
      freeCashFlowProxyUsd,
      evidenceRefs: ownerEvidenceRefs,
    },
  };
}
