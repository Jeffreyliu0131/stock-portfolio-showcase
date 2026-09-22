"use client";

import { productionExperience } from "../application/runtime/build-target.ts";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type PortfolioConsultationDimensionKind,
  type PortfolioConsultationRequest,
  type PortfolioConsultationSuccess,
} from "../application/ai/portfolio-consultation-api.ts";
import {
  PortfolioConsultationClientError,
  requestPortfolioConsultation,
} from "../application/ai/browser/portfolio-consultation-client.ts";
import { Decimal, deriveCnyAmount } from "../domain/index.ts";
import {
  createPortfolioConsultationRequest,
  summarizePortfolioConsultationExposures,
} from "../ui/portfolio-consultation-context.ts";
import type { PortfolioCopySource } from "../ui/portfolio-copy-text.ts";
import type { PortfolioInsights } from "../ui/portfolio-insights.ts";
import { formatCny, formatUsd } from "../ui/position-preview.ts";

interface PortfolioAiConsultationPanelProps {
  readonly insights: PortfolioInsights;
  readonly portfolioSource: PortfolioCopySource | null;
  readonly displayCurrency: "USD" | "CNY";
  readonly usdCnyRate: string | null;
}

interface PortfolioAnalysisSession {
  readonly request: PortfolioConsultationRequest;
  readonly result: PortfolioConsultationSuccess;
  readonly usdCnyRateAtStart: string | null;
  readonly sourceFingerprint: string;
}

type PortfolioAnalysisState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly session: PortfolioAnalysisSession };

const DIMENSION_ORDER: readonly PortfolioConsultationDimensionKind[] = [
  "ASSET_ALLOCATION",
  "CONCENTRATION",
  "SECTOR_THEME",
  "VEHICLE_OVERLAP",
  "PERFORMANCE_CONTRIBUTION",
  "DATA_LIMITS",
];

function percent(value: string | null, digits = 2): string {
  return value === null
    ? "—"
    : `${new Decimal(value).mul(100).toFixed(digits)}%`;
}

function displayAmount(
  valueUsd: string | null,
  currency: "USD" | "CNY",
  usdCnyRate: string | null,
): string {
  if (valueUsd === null) {
    return "—";
  }
  if (currency === "CNY" && usdCnyRate !== null) {
    return formatCny(deriveCnyAmount(valueUsd, usdCnyRate).cnyAmount);
  }
  return formatUsd(valueUsd);
}

function signedDisplayAmount(
  valueUsd: string | null,
  currency: "USD" | "CNY",
  usdCnyRate: string | null,
): string {
  if (valueUsd === null) {
    return "—";
  }
  const value = new Decimal(valueUsd);
  if (value.isZero()) {
    return displayAmount("0", currency, usdCnyRate);
  }
  return `${value.isPositive() ? "+" : "−"}${displayAmount(
    value.abs().toString(),
    currency,
    usdCnyRate,
  )}`;
}

function completenessLabel(value: "COMPLETE" | "PARTIAL" | "UNAVAILABLE") {
  return value === "COMPLETE"
    ? "完整"
    : value === "PARTIAL"
      ? "部分口径"
      : "暂不可用";
}

function confidenceLabel(value: "HIGH" | "MEDIUM" | "LOW") {
  return value === "HIGH" ? "高置信" : value === "MEDIUM" ? "中置信" : "低置信";
}

function analysisErrorMessage(error: unknown): string {
  if (
    error instanceof PortfolioConsultationClientError &&
    error.code === "RATE_LIMITED"
  ) {
    return "请求较多，请稍后重试。";
  }
  return "AI 分析暂时不可用。";
}

export function PortfolioAiConsultationPanel({
  insights,
  portfolioSource,
  displayCurrency,
  usdCnyRate,
}: PortfolioAiConsultationPanelProps) {
  const generation = useRef(0);
  const current = useRef({ portfolioSource, insights, usdCnyRate });
  current.current = { portfolioSource, insights, usdCnyRate };
  const [state, setState] = useState<PortfolioAnalysisState>({ kind: "idle" });

  const startAnalysis = useCallback(async () => {
    const { portfolioSource: source, insights: currentInsights, usdCnyRate: rate } = current.current;
    const sourceFingerprint = JSON.stringify({ source, insights: currentInsights, rate });
    if (source === null) {
      setState({ kind: "error", message: "当前组合暂不可用。" });
      return;
    }
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    setState({ kind: "loading" });
    let request: PortfolioConsultationRequest;
    try {
      request = createPortfolioConsultationRequest(
        source,
        currentInsights,
        { mode: "INITIAL_ANALYSIS" },
      );
    } catch {
      if (generation.current === currentGeneration) {
        setState({ kind: "error", message: "当前组合暂不可用。" });
      }
      return;
    }
    try {
      const result = await requestPortfolioConsultation(request);
      if (generation.current === currentGeneration && result.brief !== null) {
        setState({
          kind: "ready",
          session: {
            request,
            result,
            usdCnyRateAtStart: rate,
            sourceFingerprint,
          },
        });
      } else if (generation.current === currentGeneration) {
        setState({ kind: "error", message: "AI 分析暂时不可用。" });
      }
    } catch (error) {
      if (generation.current === currentGeneration) {
        setState({ kind: "error", message: analysisErrorMessage(error) });
      }
    }
  }, []);

  useEffect(() => {
    // Opening the production analysis dialog is the explicit user trigger.
    let disposed = false;
    queueMicrotask(() => { if (!disposed && productionExperience()) void startAnalysis(); });
    return () => {
      disposed = true;
      generation.current += 1;
    };
  }, [startAnalysis]);

  const presentation = useMemo(() => {
    if (state.kind !== "ready") {
      return null;
    }
    const { request, result, usdCnyRateAtStart: rate } = state.session;
    const exposures = summarizePortfolioConsultationExposures(
      request.portfolio,
      result.classifications,
    );
    const classificationById = new Map(
      result.classifications.map((classification) => [
        classification.positionId,
        classification,
      ]),
    );
    const exposureEvidence = new Map<string, string>();
    for (const exposure of exposures.sectors) {
      exposureEvidence.set(
        `sector.${exposure.key}`,
        `${exposure.label} ${percent(exposure.assetWeight)} · AI 推断`,
      );
    }
    for (const exposure of exposures.instrumentTypes) {
      exposureEvidence.set(
        `role.${exposure.key}`,
        `${exposure.label} ${percent(exposure.assetWeight)}`,
      );
    }
    const { portfolio } = request;
    const { summary } = portfolio;
    const evidenceLabel = (ref: string): string | null => {
      const exposure = exposureEvidence.get(ref);
      if (exposure !== undefined) {
        return exposure;
      }
      if (ref.startsWith("position.")) {
        const positionId = ref.slice("position.".length);
        const position = portfolio.positions.find(
          (candidate) => candidate.positionId === positionId,
        );
        if (position === undefined) {
          return null;
        }
        if (position.marketValueUsd === null) {
          return `${position.symbol} · 未计价`;
        }
        return `${position.symbol} · 仓位 ${percent(
          position.assetWeight,
        )} · 浮动盈亏 ${signedDisplayAmount(
          position.unrealizedPnlUsd,
          displayCurrency,
          rate,
        )}`;
      }
      switch (ref) {
        case "portfolio.structure":
          return `总资产 ${displayAmount(
            summary.totalAssetsUsd,
            displayCurrency,
            rate,
          )} · 股票 ${summary.stockPositionCount} 只`;
        case "portfolio.concentration":
          return `Top 1 ${percent(summary.top1Weight)} · Top 3 ${percent(
            summary.top3Weight,
          )} · Top 5 ${percent(summary.top5Weight)}`;
        case "portfolio.performance":
          return `累计浮动盈亏 ${signedDisplayAmount(
            summary.pricedUnrealizedPnlUsd,
            displayCurrency,
            rate,
          )} · ${percent(summary.pricedUnrealizedReturn)}`;
        case "portfolio.daily":
          return summary.dailyStatus === "COMPLETE"
            ? `今日净贡献 ${signedDisplayAmount(
                summary.dailyNetEffectUsd,
                displayCurrency,
                rate,
              )}`
            : `今日覆盖 ${summary.dailyCalculablePositionCount}/${summary.stockPositionCount} 只 · ${completenessLabel(
                summary.dailyStatus,
              )}`;
        case "portfolio.cash":
          return summary.cashBalanceUsd === null
            ? "当前未记录 USD 现金"
            : `USD 现金 ${displayAmount(
                summary.cashBalanceUsd,
                displayCurrency,
                rate,
              )} · ${percent(summary.cashWeight)}`;
        case "portfolio.data":
          return `估值覆盖 ${summary.pricedPositionCount}/${summary.stockPositionCount} 只 · 今日覆盖 ${summary.dailyCalculablePositionCount}/${summary.stockPositionCount} 只`;
        default:
          return null;
      }
    };
    return { exposures, classificationById, evidenceLabel };
  }, [displayCurrency, state]);

  if (state.kind === "idle" && !productionExperience()) {
    return <section className="insight-section insight-section--ai" aria-label="AI 组合体检">
      <h3>需要进一步解释？</h3>
      <p>AI 可补充行业分类和组合解读。开始后，当前持仓、数量、成本、估值、盈亏、现金与行情元数据会经服务端发送给配置的模型；不发送身份、券商账号、历史库或备份。</p>
      <button className="portfolio-ai-action" type="button" onClick={() => void startAnalysis()}>开始 AI 解读</button>
    </section>;
  }

  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <section className="insight-section insight-section--ai" aria-label="AI 组合体检">
        <div className="portfolio-ai-loading" role="status" aria-live="polite">
          <span className="portfolio-ai-loading__mark" aria-hidden="true" />
          <strong>分析中…</strong>
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="insight-section insight-section--ai" aria-label="AI 组合体检">
        <div className="portfolio-ai-analysis-error">
          <p className="portfolio-ai-error" role="alert">{state.message}</p>
          <button className="portfolio-ai-action" type="button" onClick={() => void startAnalysis()}>
            重试
          </button>
        </div>
      </section>
    );
  }

  const brief = state.session.result.brief;
  if (brief === null || presentation === null) {
    return null;
  }
  const orderedDimensions = DIMENSION_ORDER.flatMap((kind) => {
    const dimension = brief.dimensions.find((candidate) => candidate.kind === kind);
    return dimension === undefined ? [] : [dimension];
  });

  return (
    <section className="insight-section insight-section--ai" aria-labelledby="portfolio-ai-title">
      <div className="portfolio-ai-result portfolio-ai-consultation">
        <div className="portfolio-ai-result__headline">
          <span>AI 体检</span>
          {!productionExperience() ? <>
          <p>分析快照：{new Date(state.session.request.generatedAt).toLocaleString("zh-CN")}（截取时间，非行情时间）。</p>
          <p role="status">{state.session.sourceFingerprint !== JSON.stringify({ source: portfolioSource, insights, rate: usdCnyRate }) ? "当前数据已变化；下方仍基于上次快照。" : "本次解读固定使用开始时的快照。"}</p>
          <button className="portfolio-ai-action" type="button" onClick={() => void startAnalysis()}>用当前数据重新解读</button>
          </> : null}
          <h3 id="portfolio-ai-title">{brief.headline}</h3>
          <p>{brief.summary}</p>
        </div>

        <section className="portfolio-ai-exposure" aria-labelledby="ai-sector-title">
          <div className="portfolio-ai-subheading">
            <h4 id="ai-sector-title">行业暴露</h4>
            <span>AI 推断 · {completenessLabel(presentation.exposures.status)}</span>
          </div>
          {presentation.exposures.sectors.length === 0 ? (
            <p className="portfolio-ai-exposure__empty">暂无可分类持仓</p>
          ) : (
            <div className="portfolio-ai-exposure-list" role="list">
              {presentation.exposures.sectors.map((exposure) => (
                <div className="portfolio-ai-exposure-row" role="listitem" key={exposure.key}>
                  <div>
                    <strong>{exposure.label}</strong>
                    <span>{exposure.symbols.join(" · ")}</span>
                  </div>
                  <strong className="numeric">{percent(exposure.assetWeight)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="portfolio-ai-exposure" aria-labelledby="ai-role-title">
          <div className="portfolio-ai-subheading">
            <h4 id="ai-role-title">工具角色</h4>
          </div>
          <div className="portfolio-ai-role-chips" role="list">
            {presentation.exposures.instrumentTypes.map((exposure) => (
              <span role="listitem" key={exposure.key}>
                {exposure.label} · {percent(exposure.assetWeight)}
              </span>
            ))}
          </div>
        </section>

        <div className="portfolio-ai-observations">
          {orderedDimensions.map((dimension) => (
            <article
              className="portfolio-ai-observation"
              data-category={dimension.kind.toLowerCase()}
              key={dimension.kind}
            >
              <h4>{dimension.title}</h4>
              <p>{dimension.text}</p>
              <div className="portfolio-ai-evidence-list" aria-label={`${dimension.title}的本机依据`}>
                {dimension.evidenceRefs.flatMap((ref) => {
                  const label = presentation.evidenceLabel(ref);
                  return label === null
                    ? []
                    : [
                        <span className="portfolio-ai-evidence" key={ref}>
                          {label}
                        </span>,
                      ];
                })}
              </div>
            </article>
          ))}
        </div>

        <details className="portfolio-ai-classifications">
          <summary>逐只分类</summary>
          <div role="list">
            {state.session.request.portfolio.positions.map((position) => {
              const classification = presentation.classificationById.get(position.positionId);
              if (classification === undefined) {
                return null;
              }
              const sector = presentation.exposures.sectors.find(
                (entry) => entry.key === classification.sector,
              );
              const role = presentation.exposures.instrumentTypes.find(
                (entry) => entry.key === classification.instrumentType,
              );
              return (
                <div role="listitem" key={position.positionId}>
                  <div>
                    <strong>{position.symbol}</strong>
                    <span>
                      {sector?.label ?? classification.sector} · {role?.label ?? classification.instrumentType}
                    </span>
                  </div>
                  <div>
                    <span>{confidenceLabel(classification.confidence)}</span>
                    <p>{classification.rationale}</p>
                    {classification.themes.length > 0 ? (
                      <small>{classification.themes.join(" · ")}</small>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </section>
  );
}
