import type {
  PortfolioAiCompleteness,
  PortfolioAiDirection,
  PortfolioAiEvidence,
  PortfolioAiFactsRequest,
} from "../application/ai/portfolio-analysis-api.ts";
import {
  PORTFOLIO_AI_SCHEMA_VERSION,
} from "../application/ai/portfolio-analysis-api.ts";
import { Decimal } from "../domain/index.ts";
import type { PortfolioInsights } from "./portfolio-insights.ts";

export interface PortfolioAiLocalEvidence {
  readonly evidence: PortfolioAiEvidence;
  /** Exact local-only amount. It is never included in the API request. */
  readonly amountUsd?: string | null;
}

export interface PortfolioAiFactBundle {
  readonly request: PortfolioAiFactsRequest;
  readonly localEvidence: ReadonlyMap<string, PortfolioAiLocalEvidence>;
}

function structureStatus(insights: PortfolioInsights): PortfolioAiCompleteness {
  const denominator = insights.structure.totalPricedAssetsUsd;
  if (denominator === null || new Decimal(denominator).isZero()) {
    return "UNAVAILABLE";
  }
  return insights.structure.pricingComplete ? "COMPLETE" : "PARTIAL";
}

function amountDirection(value: string | null): PortfolioAiDirection {
  if (value === null) {
    return "UNAVAILABLE";
  }
  const amount = new Decimal(value);
  if (amount.isZero()) {
    return "NEUTRAL";
  }
  return amount.isPositive() ? "POSITIVE" : "NEGATIVE";
}

function addEvidence(
  evidence: PortfolioAiEvidence[],
  localEvidence: Map<string, PortfolioAiLocalEvidence>,
  value: PortfolioAiEvidence,
  amountUsd?: string | null,
): void {
  evidence.push(value);
  localEvidence.set(value.id, {
    evidence: value,
    ...(amountUsd === undefined ? {} : { amountUsd }),
  });
}

export function createPortfolioAiFactBundle(
  insights: PortfolioInsights,
  generatedAt: string = new Date().toISOString(),
): PortfolioAiFactBundle {
  const evidence: PortfolioAiEvidence[] = [];
  const localEvidence = new Map<string, PortfolioAiLocalEvidence>();
  const currentStructureStatus = structureStatus(insights);

  addEvidence(evidence, localEvidence, {
    id: "structure.status",
    category: "PORTFOLIO_OVERVIEW",
    subject: "PORTFOLIO",
    metric: "STRUCTURE_STATUS",
    status: currentStructureStatus,
  });

  const concentrationEntries = [
    ["structure.top1", insights.structure.concentration.top1],
    ["structure.top3", insights.structure.concentration.top3],
    ["structure.top5", insights.structure.concentration.top5],
  ] as const;
  for (const [id, metric] of concentrationEntries) {
    if (metric === null) {
      continue;
    }
    addEvidence(evidence, localEvidence, {
      id,
      category: "PORTFOLIO_OVERVIEW",
      subject: "PORTFOLIO",
      metric: "TOP_CONCENTRATION",
      fraction: metric.assetWeight,
    });
  }

  insights.structure.positions.forEach((position, index) => {
    if (position.assetWeight === null) {
      return;
    }
    addEvidence(evidence, localEvidence, {
      id: `structure.position.${index}.weight`,
      category: "PORTFOLIO_OVERVIEW",
      subject: position.symbol,
      metric: "POSITION_WEIGHT",
      fraction: position.assetWeight,
    });
  });

  const cash = insights.structure.cash;
  if (cash !== null && cash.assetWeight !== null) {
    addEvidence(evidence, localEvidence, {
      id: "structure.cash.weight",
      category: "PORTFOLIO_OVERVIEW",
      subject: "CASH",
      metric: "CASH_WEIGHT",
      fraction: cash.assetWeight,
    });
  }

  addEvidence(
    evidence,
    localEvidence,
    {
      id: "daily.net",
      category: "TODAY_DRIVERS",
      subject: "PORTFOLIO",
      metric: "DAILY_NET_DIRECTION",
      direction: amountDirection(insights.daily.netEffectUsd),
      status: insights.daily.status,
    },
    insights.daily.netEffectUsd,
  );

  insights.daily.contributions.forEach((contribution, index) => {
    if (contribution.amountUsd === null) {
      return;
    }
    const direction = amountDirection(contribution.amountUsd);
    if (direction === "UNAVAILABLE") {
      return;
    }
    addEvidence(
      evidence,
      localEvidence,
      {
        id: `daily.position.${index}.contribution`,
        category: "TODAY_DRIVERS",
        subject: contribution.symbol,
        metric: "DAILY_CONTRIBUTION",
        direction,
        fraction: contribution.absoluteContributionShare,
      },
      contribution.amountUsd,
    );
  });

  addEvidence(evidence, localEvidence, {
    id: "quality.pricing",
    category: "DATA_QUALITY",
    subject: "PORTFOLIO",
    metric: "PRICING_COVERAGE",
    availableCount: insights.structure.pricedPositionCount,
    totalCount: insights.structure.positions.length,
    status: currentStructureStatus,
  });
  addEvidence(evidence, localEvidence, {
    id: "quality.daily",
    category: "DATA_QUALITY",
    subject: "PORTFOLIO",
    metric: "DAILY_COVERAGE",
    availableCount: insights.daily.calculablePositionCount,
    totalCount: insights.daily.totalPositionCount,
    status: insights.daily.status,
  });

  return {
    request: {
      kind: "PORTFOLIO_AI_FACTS",
      schemaVersion: PORTFOLIO_AI_SCHEMA_VERSION,
      generatedAt,
      locale: "zh-CN",
      evidence,
    },
    localEvidence,
  };
}
