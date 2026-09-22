"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  IndexedDbPortfolioHistoryRepository,
  parseHistoryImportFiles,
  parseHistoryImportText,
  type HistoryAssetClass,
  type HistoryImportCandidate,
  type PortfolioHistoryEvent,
  type PortfolioHistorySummary,
} from "../application/history/index.ts";

type ManualEventKind = "BUY" | "SELL" | "DEPOSIT" | "WITHDRAWAL";

const EMPTY_SUMMARY: PortfolioHistorySummary = {
  importCount: 0,
  navCount: 0,
  externalFlowCount: 0,
  tradeCount: 0,
  firstEventAt: null,
  lastEventAt: null,
};

function localDateTimeValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function eventId(): string {
  const value =
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `manual:${value}`;
}

function asRfc3339(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("请选择有效日期和时间。");
  }
  return parsed.toISOString();
}

function positiveDecimal(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) {
    throw new Error(`${label}必须是正数，最多 8 位小数。`);
  }
  const decimal = new Decimal(normalized);
  if (!decimal.isPositive()) {
    throw new Error(`${label}必须大于 0。`);
  }
  return decimal.toString();
}

function nonNegativeDecimal(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) {
    throw new Error(`${label}必须是非负数，最多 8 位小数。`);
  }
  return new Decimal(normalized).toString();
}

function dateLabel(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function candidateCounts(candidate: HistoryImportCandidate) {
  return {
    nav: candidate.events.filter((event) => event.type === "NAV_SNAPSHOT").length,
    flows: candidate.events.filter((event) => event.type === "EXTERNAL_FLOW").length,
    trades: candidate.events.filter((event) => event.type === "TRADE").length,
  };
}

const MAX_HISTORY_FRAGMENT_TEXT_BYTES = 128 * 1024;

function historyTextFromFragment(hash: string): string | null {
  const encoded = new URLSearchParams(hash.replace(/^#/, "")).get("history-text");
  if (encoded === null) {
    return null;
  }
  if (encoded.length > MAX_HISTORY_FRAGMENT_TEXT_BYTES * 2) {
    throw new Error("history fragment is too large");
  }
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > MAX_HISTORY_FRAGMENT_TEXT_BYTES) {
    throw new Error("history fragment is too large");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.trim().length === 0) {
    throw new Error("history fragment is empty");
  }
  return text;
}

function isStandaloneDisplay(): boolean {
  const navigatorWithStandalone = globalThis.navigator as Navigator & {
    readonly standalone?: boolean;
  };
  return (
    navigatorWithStandalone.standalone === true ||
    globalThis.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

export function PortfolioHistoryCenter() {
  const repositoryRef = useRef<IndexedDbPortfolioHistoryRepository | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fragmentTextRef = useRef<string | null | undefined>(undefined);
  const [summary, setSummary] = useState<PortfolioHistorySummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [candidates, setCandidates] = useState<readonly HistoryImportCandidate[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [manualKind, setManualKind] = useState<ManualEventKind>("BUY");
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue);
  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<HistoryAssetClass>("STOCK");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("0");
  const [optionExpiration, setOptionExpiration] = useState("");
  const [optionStrike, setOptionStrike] = useState("");
  const [optionRight, setOptionRight] = useState<"CALL" | "PUT">("CALL");
  const [amount, setAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const repository = () => {
    repositoryRef.current ??= new IndexedDbPortfolioHistoryRepository();
    return repositoryRef.current;
  };

  const refreshSummary = async () => {
    setSummary(await repository().getSummary());
  };

  useEffect(() => {
    let active = true;
    void repository()
      .getSummary()
      .then((value) => {
        if (active) {
          setSummary(value);
        }
      })
      .catch(() => {
        if (active) {
          setNotice("无法读取独立历史库；当前持仓没有被修改。");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const hasBlockingIssues = useMemo(
    () =>
      candidates.some((candidate) =>
        candidate.issues.some((issue) => issue.severity === "BLOCKING"),
      ),
    [candidates],
  );

  const showPreview = (
    parsed: readonly HistoryImportCandidate[],
    readyNotice = "本机预览完成；确认前没有写入 IndexedDB。",
  ) => {
    setCandidates(parsed);
    const blocked = parsed.some((candidate) =>
      candidate.issues.some((issue) => issue.severity === "BLOCKING"),
    );
    setNotice(
      blocked
        ? "预览发现阻断问题，尚未写入任何历史数据。"
        : readyNotice,
    );
  };

  useEffect(() => {
    let active = true;
    if (fragmentTextRef.current === undefined) {
      const hash = globalThis.location.hash;
      const hasHistoryText = new URLSearchParams(hash.replace(/^#/, "")).has(
        "history-text",
      );
      try {
        fragmentTextRef.current = historyTextFromFragment(hash);
      } catch {
        fragmentTextRef.current = null;
        setNotice("一次性历史链接无效或已损坏，没有写入任何数据。");
      } finally {
        if (hasHistoryText) {
          globalThis.history.replaceState(
            globalThis.history.state,
            "",
            `${globalThis.location.pathname}${globalThis.location.search}`,
          );
        }
      }
    }
    const text = fragmentTextRef.current;
    if (text === null) {
      return () => {
        active = false;
      };
    }
    setPastedText(text);
    setIsParsing(true);
    setNotice(null);
    void parseHistoryImportText(text)
      .then((parsed) => {
        if (active) {
          showPreview(
            [parsed],
            isStandaloneDisplay()
              ? "一次性资料已在本机预览；确认前没有写入历史库。"
              : "一次性资料已在浏览器中预览。iPhone 浏览器与主屏幕 App 的存储可能分开；请只在能看到当前持仓的那个窗口中确认。",
          );
        }
      })
      .catch(() => {
        if (active) {
          setNotice("一次性历史链接无法可靠解析，没有写入任何数据。");
        }
      })
      .finally(() => {
        if (active) {
          setIsParsing(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    if (files.length === 0 || isParsing || isImporting) {
      return;
    }
    setIsParsing(true);
    setNotice(null);
    setCandidates([]);
    try {
      const parsed = await parseHistoryImportFiles(files);
      setPastedText("");
      showPreview(parsed);
    } catch {
      setNotice("文件解析失败，尚未写入任何历史数据。请改用 CSV 或文本层 PDF。");
    } finally {
      setIsParsing(false);
    }
  };

  const readClipboard = async () => {
    if (isParsing || isImporting) {
      return;
    }
    setNotice(null);
    try {
      if (typeof globalThis.navigator.clipboard?.readText !== "function") {
        throw new Error("clipboard read is unavailable");
      }
      const value = await globalThis.navigator.clipboard.readText();
      if (value.trim().length === 0) {
        setNotice("剪贴板里没有可导入的文字，请先复制月结单原文。");
        return;
      }
      setPastedText(value);
      setCandidates([]);
      setNotice("已从剪贴板读取到本页内存；尚未解析或写入历史库。");
    } catch {
      setNotice("浏览器没有允许读取剪贴板，请长按下方文本框并选择“粘贴”。");
    }
  };

  const previewPastedText = async () => {
    if (pastedText.trim().length === 0 || isParsing || isImporting) {
      if (pastedText.trim().length === 0) {
        setNotice("请先粘贴包含 Starting/Ending NAV 的券商月结单文字。");
      }
      return;
    }
    setIsParsing(true);
    setNotice(null);
    setCandidates([]);
    try {
      const parsed = await parseHistoryImportText(pastedText);
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
      showPreview([parsed]);
    } catch {
      setNotice("文字解析失败，尚未写入任何历史数据。请粘贴完整的月结单文本。");
    } finally {
      setIsParsing(false);
    }
  };

  const confirmImport = async () => {
    if (candidates.length === 0 || hasBlockingIssues || isImporting) {
      return;
    }
    setIsImporting(true);
    setNotice(null);
    try {
      const result = await repository().importCandidates(candidates);
      await refreshSummary();
      setNotice(
        `已导入 ${result.importedDocuments} 份资料、${result.insertedEvents} 条新记录；${result.duplicateDocuments + result.duplicateEvents} 项重复已跳过。`,
      );
      setCandidates([]);
      setPastedText("");
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    } catch {
      setNotice("整批导入未完成，历史库已回滚；当前持仓没有被修改。");
    } finally {
      setIsImporting(false);
    }
  };

  const saveManualEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const eventAt = asRfc3339(occurredAt);
      let value: PortfolioHistoryEvent;
      if (manualKind === "DEPOSIT" || manualKind === "WITHDRAWAL") {
        const inputAmount = new Decimal(positiveDecimal(amount, "金额"));
        const signed = manualKind === "DEPOSIT" ? inputAmount : inputAmount.neg();
        value = {
          id: eventId(),
          type: "EXTERNAL_FLOW",
          source: "MANUAL",
          sourceScopeHash: "MANUAL_PORTFOLIO",
          occurredAt: eventAt,
          recordedAt: now,
          amountUsd: signed.toString(),
          direction: manualKind,
          classification:
            manualKind === "DEPOSIT"
              ? "EXTERNAL_DEPOSIT"
              : "EXTERNAL_WITHDRAWAL",
        };
      } else {
        const normalizedSymbol = symbol.trim().toUpperCase();
        if (!/^[A-Z0-9.\-]{1,32}$/.test(normalizedSymbol)) {
          throw new Error("请输入有效股票或期权标的代码。");
        }
        const option = assetClass === "OPTION"
          ? {
              expiration: optionExpiration,
              strike: positiveDecimal(optionStrike, "行权价"),
              right: optionRight,
            }
          : undefined;
        if (
          option !== undefined &&
          !/^\d{4}-\d{2}-\d{2}$/.test(option.expiration)
        ) {
          throw new Error("请选择有效期权到期日。");
        }
        value = {
          id: eventId(),
          type: "TRADE",
          source: "MANUAL",
          sourceScopeHash: "MANUAL_PORTFOLIO",
          occurredAt: eventAt,
          recordedAt: now,
          assetClass,
          side: manualKind,
          symbol: normalizedSymbol,
          quantity: positiveDecimal(quantity, "数量"),
          price: nonNegativeDecimal(price, "成交价"),
          multiplier: assetClass === "OPTION" ? "100" : "1",
          feesUsd: nonNegativeDecimal(fees, "费用"),
          currency: "USD",
          ...(option === undefined ? {} : { option }),
        };
      }
      await repository().putManualEvent(value);
      await refreshSummary();
      setNotice(
        manualKind === "DEPOSIT" || manualKind === "WITHDRAWAL"
          ? "外部现金流已记录，会进入长期收益调整；当前持仓未被修改。"
          : "交易已记录用于历史审计；当前持仓未被自动修改。",
      );
      setAmount("");
      setQuantity("");
      setPrice("");
      setFees("0");
      setOptionExpiration("");
      setOptionStrike("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "历史事件保存失败，当前持仓未被修改。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="app-shell app-shell--form precision-form history-center">
      <header className="form-header">
        <Link className="icon-link" href="/" aria-label="返回总仓位">
          返回
        </Link>
        <div>
          <p className="eyebrow">本机历史</p>
          <h1>组合收益历史</h1>
        </div>
        <span className="form-header__spacer" aria-hidden="true" />
      </header>

      {notice ? (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="history-summary" aria-busy={isLoading} aria-label="历史数据概览">
        <div><span>导入批次</span><strong className="numeric">{summary.importCount}</strong></div>
        <div><span>NAV 点</span><strong className="numeric">{summary.navCount}</strong></div>
        <div><span>外部现金流</span><strong className="numeric">{summary.externalFlowCount}</strong></div>
        <div><span>交易</span><strong className="numeric">{summary.tradeCount}</strong></div>
      </section>

      <section className="form-section" aria-labelledby="history-import-title">
        <div className="form-section__heading">
          <span>1</span>
          <div>
            <h2 id="history-import-title">导入券商历史</h2>
            <p>最简单的方式是直接粘贴月结单文字；也可以选择 IBKR/moomoo 的 CSV、文本层 PDF 或 TXT。</p>
          </div>
        </div>
        <p className="history-import-guidance">
          完整组合的长期线需要每个账户在同一周期都有 Starting/Ending NAV。当前持仓摘要只支持当前估值与 1D；交易确认可用于审计，但不能替代 NAV。
        </p>
        <div className="history-paste-import">
          <label htmlFor="history-pasted-text">
            <strong>直接粘贴月结单文字</strong>
            <span>每次粘贴同一券商、同一账户的完整原文；确认导入后原文会从文本框清除。</span>
          </label>
          <textarea
            id="history-pasted-text"
            rows={8}
            value={pastedText}
            disabled={isParsing || isImporting}
            placeholder="粘贴包含 Starting Net Asset Value / Ending Net Asset Value 的月结单原文"
            onChange={(event) => {
              setPastedText(event.target.value);
              setCandidates([]);
            }}
          />
          <div className="history-paste-actions">
            <button
              className="button button--secondary"
              type="button"
              disabled={isParsing || isImporting}
              onClick={() => void readClipboard()}
            >
              从剪贴板读取
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={pastedText.trim().length === 0 || isParsing || isImporting}
              onClick={() => void previewPastedText()}
            >
              {isParsing ? "正在本机解析…" : "预览粘贴内容"}
            </button>
          </div>
        </div>
        <div className="history-import-divider" aria-hidden="true"><span>或选择文件</span></div>
        <label className="history-file-picker">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.pdf,.txt,text/csv,text/plain,application/pdf"
            disabled={isParsing || isImporting}
            onChange={(event) => void selectFiles(event)}
          />
          <strong>{isParsing ? "正在本机解析…" : "选择一个或多个文件"}</strong>
          <span>单个 ≤ 16 MB，一批 ≤ 80 MB；扫描件不会进行 OCR 猜测</span>
        </label>
        <p className="field-help history-privacy-note">
          原始文件、粘贴或提取文字、姓名和完整账户号不会上传或持久化；只保存不可逆来源指纹与规范化记录。
        </p>

        {candidates.length > 0 ? (
          <div className="history-preview-list" aria-label="导入预览">
            {candidates.map((candidate, index) => {
              const counts = candidateCounts(candidate);
              return (
                <article className="history-preview-card" key={candidate.document.fileSha256}>
                  <header>
                    <div>
                      <span>资料 {index + 1}</span>
                      <strong>{candidate.document.broker} · {candidate.document.detectedFormat}</strong>
                    </div>
                    <span>{dateLabel(candidate.document.periodStart)} – {dateLabel(candidate.document.periodEnd)}</span>
                  </header>
                  <dl>
                    <div><dt>NAV</dt><dd>{counts.nav}</dd></div>
                    <div><dt>外部现金流</dt><dd>{counts.flows}</dd></div>
                    <div><dt>交易</dt><dd>{counts.trades}</dd></div>
                  </dl>
                  {candidate.issues.length > 0 ? (
                    <ul>
                      {candidate.issues.map((issue, issueIndex) => (
                        <li data-severity={issue.severity} key={`${issue.code}-${issueIndex}`}>
                          {issue.severity === "BLOCKING" ? "阻断：" : "提示："}{issue.message}
                        </li>
                      ))}
                    </ul>
                  ) : <p>结构检查通过。</p>}
                </article>
              );
            })}
            <button
              className="button button--primary"
              type="button"
              disabled={hasBlockingIssues || isImporting}
              aria-busy={isImporting}
              onClick={() => void confirmImport()}
            >
              {isImporting ? "正在原子写入…" : "确认导入这批历史"}
            </button>
          </div>
        ) : null}
      </section>

      <form className="entry-form" noValidate onSubmit={(event) => void saveManualEvent(event)}>
        <section className="form-section" aria-labelledby="history-manual-title">
          <div className="form-section__heading">
            <span>2</span>
            <div>
              <h2 id="history-manual-title">记录之后的每笔变动</h2>
              <p>买卖用于审计；只有入金/出金调整长期收益。这里不会自动改写当前持仓。</p>
            </div>
          </div>
          <div className="history-kind-switch" role="group" aria-label="历史事件类型">
            {(["BUY", "SELL", "DEPOSIT", "WITHDRAWAL"] as const).map((kind) => (
              <button
                type="button"
                aria-pressed={manualKind === kind}
                key={kind}
                onClick={() => setManualKind(kind)}
              >
                {{ BUY: "买入", SELL: "卖出", DEPOSIT: "入金", WITHDRAWAL: "出金" }[kind]}
              </button>
            ))}
          </div>
          <div className="field-grid history-manual-fields">
            <div className="field">
              <label htmlFor="history-event-at">发生时间</label>
              <input
                id="history-event-at"
                type="datetime-local"
                value={occurredAt}
                required
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </div>
            {manualKind === "DEPOSIT" || manualKind === "WITHDRAWAL" ? (
              <div className="field">
                <label htmlFor="history-flow-amount">USD 金额</label>
                <input
                  id="history-flow-amount"
                  inputMode="decimal"
                  placeholder="例如 5000"
                  value={amount}
                  required
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="history-symbol">
                    {assetClass === "OPTION" ? "期权标的代码" : "标的代码"}
                  </label>
                  <input
                    id="history-symbol"
                    autoCapitalize="characters"
                    placeholder="例如 AAPL"
                    value={symbol}
                    required
                    onChange={(event) => setSymbol(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="history-asset-class">资产类型</label>
                  <select
                    id="history-asset-class"
                    value={assetClass}
                    onChange={(event) => setAssetClass(event.target.value as HistoryAssetClass)}
                  >
                    <option value="STOCK">股票</option>
                    <option value="ETF">ETF</option>
                    <option value="OPTION">期权</option>
                  </select>
                </div>
                {assetClass === "OPTION" ? (
                  <>
                    <div className="field">
                      <label htmlFor="history-option-expiration">到期日</label>
                      <input
                        id="history-option-expiration"
                        type="date"
                        value={optionExpiration}
                        required
                        onChange={(event) => setOptionExpiration(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="history-option-strike">行权价 USD</label>
                      <input
                        id="history-option-strike"
                        inputMode="decimal"
                        value={optionStrike}
                        required
                        onChange={(event) => setOptionStrike(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="history-option-right">期权类型</label>
                      <select
                        id="history-option-right"
                        value={optionRight}
                        onChange={(event) => setOptionRight(event.target.value as "CALL" | "PUT")}
                      >
                        <option value="CALL">看涨 Call</option>
                        <option value="PUT">看跌 Put</option>
                      </select>
                    </div>
                  </>
                ) : null}
                <div className="field">
                  <label htmlFor="history-quantity">数量</label>
                  <input
                    id="history-quantity"
                    inputMode="decimal"
                    value={quantity}
                    required
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="history-price">成交价 USD</label>
                  <input
                    id="history-price"
                    inputMode="decimal"
                    value={price}
                    required
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="history-fees">费用 USD</label>
                  <input
                    id="history-fees"
                    inputMode="decimal"
                    value={fees}
                    required
                    onChange={(event) => setFees(event.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <button className="button button--primary history-save-button" type="submit" disabled={isSaving}>
            {isSaving ? "正在保存…" : "保存历史事件"}
          </button>
        </section>
      </form>

      <section className="history-method-note" aria-labelledby="history-method-title">
        <p className="eyebrow">收益口径</p>
        <h2 id="history-method-title">排除外部资金影响</h2>
        <p>长期线使用月结/Activity Statement 的真实 NAV 与入出金做 Modified Dietz。股息、利息、税费、佣金和交易结果继续留在收益里；缺口会断线。</p>
      </section>
    </main>
  );
}
