"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  BUFFETT_RESEARCH_SCHEMA_VERSION,
  MAX_BUFFETT_RESEARCH_QUESTION_CHARS,
  type BuffettResearchMetric,
  type BuffettResearchSuccess,
} from "../application/ai/research/buffett-research-api.ts";
import {
  BuffettResearchClientError,
  requestBuffettResearch,
} from "../application/ai/research/browser/buffett-research-client.ts";
import {
  BUFFETT_RESEARCH_SYMBOLS,
  type BuffettResearchSymbol,
} from "../application/ai/research/supported-issuers.ts";
import { VALUE_INVESTING_FRAMEWORK_LENS_LABELS } from "../application/ai/value-investing-framework.ts";
import { Decimal } from "../domain/index.ts";
import { containModalFocus } from "./modal-accessibility.ts";

interface PortfolioAiResearchDialogProps {
  readonly onClose: () => void;
}

function metricValue(metric: BuffettResearchMetric): string {
  if (metric.unit === "FRACTION") {
    return `${new Decimal(metric.value).mul(100).toFixed(1)}%`;
  }
  const numeric = Number(metric.value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

function researchErrorMessage(error: unknown): string {
  if (error instanceof BuffettResearchClientError) {
    if (error.code === "RESEARCH_NOT_CONFIGURED") {
      return "研究服务尚未配置 OpenAI 与 SEC 服务端参数。";
    }
    if (error.code === "RATE_LIMITED") {
      return "研究请求较多，请稍后重试。";
    }
    if (error.code === "SEC_UNAVAILABLE") {
      return "SEC 一手资料暂时不可用。";
    }
  }
  return "研究未完成，未展示部分结果。";
}

export function PortfolioAiResearchDialog({
  onClose,
}: PortfolioAiResearchDialogProps) {
  const dialog = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const generation = useRef(0);
  const [symbol, setSymbol] = useState<BuffettResearchSymbol>("AAPL");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<BuffettResearchSuccess | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const current = dialog.current;
    if (current === null) return;
    const releaseFocus = containModalFocus(current);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      generation.current += 1;
      document.removeEventListener("keydown", closeOnEscape);
      releaseFocus();
    };
  }, [onClose]);

  const submit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmed = question.trim();
      if (trimmed.length < 2 || isResearching) {
        input.current?.focus();
        return;
      }
      const currentGeneration = generation.current + 1;
      generation.current = currentGeneration;
      setIsResearching(true);
      setResult(null);
      setError(null);
      try {
        const response = await requestBuffettResearch({
          kind: "BUFFETT_RESEARCH_REQUEST",
          schemaVersion: BUFFETT_RESEARCH_SCHEMA_VERSION,
          generatedAt: new Date().toISOString(),
          locale: "zh-CN",
          symbol,
          question: trimmed,
        });
        if (generation.current === currentGeneration) setResult(response);
      } catch (caught) {
        if (generation.current === currentGeneration) {
          setError(researchErrorMessage(caught));
        }
      } finally {
        if (generation.current === currentGeneration) {
          setIsResearching(false);
        }
      }
    },
    [isResearching, question, symbol],
  );

  const onQuestionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    [],
  );

  return (
    <div
      className="action-sheet-backdrop portfolio-ai-research-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="portfolio-ai-research-dialog"
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="portfolio-ai-research-title"
      >
        <header className="portfolio-ai-research-dialog__header">
          <div>
            <h2 id="portfolio-ai-research-title">巴菲特研究系统</h2>
            <p>SEC · 官方 Web Search · 证据门禁</p>
          </div>
          <button type="button" onClick={onClose}>完成</button>
        </header>

        <form
          className="portfolio-ai-research-form"
          onSubmit={(event) => void submit(event)}
        >
          <fieldset disabled={isResearching}>
            <legend>研究公司</legend>
            <div className="portfolio-ai-research-symbols">
              {BUFFETT_RESEARCH_SYMBOLS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={symbol === candidate}
                  onClick={() => {
                    setSymbol(candidate);
                    setResult(null);
                    setError(null);
                  }}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </fieldset>
          <label htmlFor="buffett-research-question">研究问题</label>
          <div className="portfolio-ai-research-form__composer">
            <textarea
              id="buffett-research-question"
              ref={input}
              data-autofocus
              rows={2}
              maxLength={MAX_BUFFETT_RESEARCH_QUESTION_CHARS}
              value={question}
              disabled={isResearching}
              placeholder="例如：这家公司的现金创造和资本配置有哪些证据与反证？"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onQuestionKeyDown}
            />
            <button
              type="submit"
              disabled={isResearching || question.trim().length < 2}
            >
              {isResearching ? "研究中" : "开始"}
            </button>
          </div>
          <p className="portfolio-ai-research-form__privacy">
            只发送代码与本次问题；不发送持仓数量、成本、现金、账号或历史库。
          </p>
        </form>

        <div className="portfolio-ai-research-content" aria-live="polite">
          {isResearching ? (
            <div className="portfolio-ai-research-loading" role="status">
              <span className="portfolio-ai-loading__mark" aria-hidden="true" />
              <div>
                <strong>正在建立证据链</strong>
                <p>检索 SEC 与公司官方来源，完成确定性计算后才生成回答。</p>
              </div>
            </div>
          ) : null}
          {error !== null ? (
            <p className="portfolio-ai-research-error" role="alert">{error}</p>
          ) : null}
          {result !== null ? <ResearchResult result={result} /> : null}
        </div>
      </section>
    </div>
  );
}

function ResearchResult({ result }: { readonly result: BuffettResearchSuccess }) {
  return (
    <article className="portfolio-ai-research-result">
      <header>
        <span>{result.symbol} · {result.companyName}</span>
        <h3>{result.headline}</h3>
        <p>{result.summary}</p>
      </header>

      <section aria-labelledby="research-metrics-title">
        <h4 id="research-metrics-title">确定性指标</h4>
        <div className="portfolio-ai-research-metrics" role="list">
          {result.metrics.map((metric) => (
            <div key={metric.key} role="listitem">
              <span>{metric.label}</span>
              <strong>{metricValue(metric)}</strong>
              <small>{metric.periodEnd} · {metric.status === "DERIVED" ? "派生" : "SEC"}</small>
            </div>
          ))}
        </div>
        <p className="portfolio-ai-research-assumption">
          <strong>所有者收益：需要假设</strong>
          {result.ownerEarnings.explanation}
        </p>
      </section>

      <section aria-labelledby="research-findings-title">
        <h4 id="research-findings-title">框架判断</h4>
        <div className="portfolio-ai-research-findings">
          {result.findings.map((finding) => (
            <article key={finding.lens}>
              <div>
                <span>{VALUE_INVESTING_FRAMEWORK_LENS_LABELS[finding.lens]}</span>
                <small>{finding.confidence}</small>
              </div>
              <h5>{finding.title}</h5>
              <p>{finding.assessment}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="portfolio-ai-research-two-column">
        <div>
          <h4>反证</h4>
          <ul>{result.counterEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div>
          <h4>未知</h4>
          <ul>{result.unknowns.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </section>

      <section aria-labelledby="research-sources-title">
        <h4 id="research-sources-title">一手来源</h4>
        <ol className="portfolio-ai-research-sources">
          {result.evidence.map((item) => (
            <li key={item.id}>
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
              <span>{item.sourceType} · {item.authority}</span>
            </li>
          ))}
        </ol>
      </section>

      <details className="portfolio-ai-research-trace">
        <summary>Research Trace</summary>
        <ol>
          {result.trace.map((step) => (
            <li key={step.stage}>
              <strong>{step.stage}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}
