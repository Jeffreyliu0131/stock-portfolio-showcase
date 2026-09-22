"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { requestInstrumentResolution } from "../application/instruments/browser/instrument-client.ts";
import { resolveSupportedInstrument } from "../application/instruments/supported-instruments.ts";
import {
  PositionRepositoryError,
} from "../application/positions/index.ts";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "../application/portfolio-repository.ts";
import {
  Decimal,
  brokerPositionFor,
  instrumentKeyId,
  totalBrokerCashBalance,
  type BrokerCode,
  type BrokerPortfolioBook,
  type InstrumentKey,
  type TradeSide,
} from "../domain/index.ts";
import { formatQuantity, formatUsd } from "../ui/position-preview.ts";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d{1,8})?$/;

function parseInstrument(value: string | undefined): InstrumentKey | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      parsed.some((part) => typeof part !== "string")
    ) {
      return null;
    }
    const [listingMarket, symbol, currency] = parsed;
    const supported = resolveSupportedInstrument({ listingMarket, symbol, currency });
    return supported.ok ? supported.instrument : null;
  } catch {
    return null;
  }
}

function tradeId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? `trade-${globalThis.crypto.randomUUID()}`
    : `trade-${Date.now()}`;
}

export function BrokerTradeForm({
  initialSide,
  initialInstrumentKey,
  repository: repositoryInput,
}: {
  initialSide: TradeSide;
  initialInstrumentKey?: string;
  repository?: PortfolioRepository;
}) {
  const repositoryRef = useRef<PortfolioRepository | null>(null);
  repositoryRef.current ??= repositoryInput ?? createPortfolioRepository();
  const repository = repositoryRef.current;
  const router = useRouter();
  const initialInstrument = useMemo(
    () => parseInstrument(initialInstrumentKey),
    [initialInstrumentKey],
  );
  const [book, setBook] = useState<BrokerPortfolioBook | null>(null);
  const [side] = useState<TradeSide>(initialSide);
  const [instrument, setInstrument] = useState<InstrumentKey | null>(
    initialInstrument,
  );
  const [displayName, setDisplayName] = useState("");
  const [symbol, setSymbol] = useState(initialInstrument?.symbol ?? "");
  const [broker, setBroker] = useState<BrokerCode>("IBKR");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [cashStatus, setCashStatus] = useState<"PENDING" | "SETTLED">(
    "PENDING",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void repository.getBrokerPortfolioBook().then(
      (current) => {
        if (!active) return;
        setBook(current);
        if (current !== null && initialInstrument !== null) {
          const matching = current.positions.filter(
            (position) =>
              instrumentKeyId(position.instrument) ===
              instrumentKeyId(initialInstrument),
          );
          setDisplayName(
            matching.find((position) => position.displayName !== undefined)
              ?.displayName ?? initialInstrument.symbol,
          );
          if (matching.length === 1) setBroker(matching[0]!.broker);
        }
        setIsLoading(false);
      },
      () => {
        if (active) {
          setMessage("无法读取双券商账本；没有修改任何资产。");
          setIsLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [initialInstrument, repository]);

  useEffect(() => {
    if (side !== "BUY" || initialInstrument !== null) return;
    const normalized = symbol.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(normalized)) {
      setInstrument(null);
      setDisplayName("");
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setIsResolving(true);
      void requestInstrumentResolution(normalized).then(
        (resolved) => {
          if (!active) return;
          setInstrument(resolved.instrument);
          setDisplayName(resolved.displayName);
          setMessage(null);
          setIsResolving(false);
        },
        () => {
          if (!active) return;
          setInstrument(null);
          setDisplayName("");
          setMessage("无法识别该股票代码，请检查后重试。");
          setIsResolving(false);
        },
      );
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [initialInstrument, side, symbol]);

  const sourcePosition = useMemo(
    () =>
      book === null || instrument === null
        ? null
        : brokerPositionFor(book, broker, instrument),
    [book, broker, instrument],
  );
  const preview = useMemo(() => {
    if (
      instrument === null ||
      !DECIMAL_PATTERN.test(quantity.trim()) ||
      !DECIMAL_PATTERN.test(unitPrice.trim()) ||
      !DECIMAL_PATTERN.test(fee.trim()) ||
      new Decimal(quantity).lte(0) ||
      new Decimal(unitPrice).lte(0) ||
      new Decimal(fee).lt(0)
    ) {
      return null;
    }
    const gross = new Decimal(quantity).mul(unitPrice);
    const cashDelta =
      side === "BUY" ? gross.add(fee).negated() : gross.sub(fee);
    const beforeQuantity = new Decimal(sourcePosition?.quantity ?? "0");
    const afterQuantity =
      side === "BUY"
        ? beforeQuantity.add(quantity)
        : beforeQuantity.sub(quantity);
    const beforeCash = new Decimal(
      book === null ? "0" : totalBrokerCashBalance(book),
    );
    return {
      gross: gross.toString(),
      cashDelta: cashDelta.toString(),
      beforeQuantity: beforeQuantity.toString(),
      afterQuantity: afterQuantity.toString(),
      beforeCash: beforeCash.toString(),
      afterCash: beforeCash.add(cashDelta).toString(),
    };
  }, [book, fee, instrument, quantity, side, sourcePosition, unitPrice]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (book === null || instrument === null || preview === null || isSubmitting) {
      return;
    }
    if (side === "SELL" && new Decimal(preview.afterQuantity).lt(0)) {
      setMessage(`${broker} 最多可卖 ${formatQuantity(preview.beforeQuantity)} 股。`);
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      await repository.applyBrokerTrade(
        {
          id: tradeId(),
          side,
          broker,
          instrument,
          ...(displayName.trim().length === 0 ? {} : { displayName }),
          quantity: new Decimal(quantity).toString(),
          unitPrice: new Decimal(unitPrice).toString(),
          fee: new Decimal(fee).toString(),
          cashStatus,
          effectiveAt: new Date().toISOString(),
        },
        { expectedRevision: book.revision },
      );
      router.push("/");
    } catch (caught) {
      setMessage(
        caught instanceof PositionRepositoryError &&
          caught.code === "BROKER_PORTFOLIO_CONFLICT"
          ? "另一页面刚更新了组合；本次交易没有写入，请刷新后重试。"
          : caught instanceof Error
            ? caught.message
            : "交易保存失败；股票与现金均未改变。",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <main className="app-shell app-shell--centered">正在读取双券商账本…</main>;
  }
  if (book === null) {
    return (
      <main className="app-shell app-shell--form precision-form">
        <header className="form-header">
          <Link className="icon-link" href="/">返回</Link>
          <h1>先启用双券商账本</h1>
          <span />
        </header>
        <section className="form-alert" role="alert">
          <p>买入和卖出需要先校准 IBKR 与 moomoo 的当前持仓和现金。</p>
        </section>
        <Link className="button button--primary button--full" href="/portfolio-setup">
          开始校准
        </Link>
      </main>
    );
  }

  return (
    <main className="app-shell app-shell--form precision-form broker-trade-form">
      <header className="form-header">
        <Link className="icon-link" href="/">返回</Link>
        <div>
          <p className="eyebrow">统一组合现金联动</p>
          <h1>{side === "BUY" ? "买入股票" : "卖出股票"}</h1>
        </div>
        <span className="form-header__spacer" aria-hidden="true" />
      </header>

      {message ? <p className="form-alert" role="alert">{message}</p> : null}

      <form className="entry-form" onSubmit={(event) => void submit(event)}>
        <section className="form-section">
          <div className="form-section__heading"><span>1</span><div><h2>选择标的和持仓券商</h2><p>券商只用于确认股票来源；现金统一计入组合现金。</p></div></div>
          {initialInstrument === null && side === "BUY" ? (
            <label className="field">
              股票代码
              <input
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                autoCapitalize="characters"
                placeholder="AAPL"
              />
              <span className="field-help">
                {isResolving ? "正在识别…" : instrument === null ? "输入后自动识别" : `${displayName} · ${instrument.listingMarket}`}
              </span>
            </label>
          ) : (
            <div className="selected-instrument">
              <strong>{instrument?.symbol ?? "无法识别"}</strong>
              <span>{displayName || instrument?.listingMarket}</span>
            </div>
          )}
          <fieldset className="row-mode-fieldset">
            <legend>交易券商</legend>
            <div className="segmented-control segmented-control--row">
              {(["IBKR", "MOOMOO"] as const).map((brokerCode) => (
                <label key={brokerCode}>
                  <input type="radio" name="broker" checked={broker === brokerCode} onChange={() => setBroker(brokerCode)} />
                  <span>{brokerCode}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {side === "SELL" ? (
            <p className="replacement-notice">
              {broker} 当前持有 {formatQuantity(sourcePosition?.quantity ?? "0")} 股 · 剩余成本 {formatUsd(sourcePosition?.totalOpenCost ?? "0")}
            </p>
          ) : null}
        </section>

        <section className="form-section">
          <div className="form-section__heading"><span>2</span><div><h2>填写成交</h2><p>手续费买入时计入成本，卖出时从现金净收入扣除。</p></div></div>
          <div className="field-grid">
            <label className="field">数量<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" /></label>
            <label className="field">成交均价（USD）<input inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="0" /></label>
            <label className="field">手续费（USD）<input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0" /></label>
          </div>
          <fieldset className="row-mode-fieldset">
            <legend>现金状态</legend>
            <div className="segmented-control segmented-control--row">
              <label><input type="radio" name="cash-status" checked={cashStatus === "PENDING"} onChange={() => setCashStatus("PENDING")} /><span>待结算</span></label>
              <label><input type="radio" name="cash-status" checked={cashStatus === "SETTLED"} onChange={() => setCashStatus("SETTLED")} /><span>已结算</span></label>
            </div>
          </fieldset>
        </section>

        <section className="preview-card">
          <p className="eyebrow">保存前预览</p>
          <h2>{broker} {side === "BUY" ? "买入" : "卖出"}</h2>
          {preview === null ? <p className="preview-card__empty">填写有效数量、价格和手续费后生成预览。</p> : (
            <dl className="preview-metrics">
              <div><dt>成交总额</dt><dd>{formatUsd(preview.gross)}</dd></div>
              <div><dt>现金变化</dt><dd>{formatUsd(preview.cashDelta)}</dd></div>
              <div><dt>该券商股数</dt><dd>{formatQuantity(preview.beforeQuantity)} → {formatQuantity(preview.afterQuantity)}</dd></div>
              <div><dt>组合现金</dt><dd>{formatUsd(preview.beforeCash)} → {formatUsd(preview.afterCash)}</dd></div>
            </dl>
          )}
          <p>任一校验或写入失败时，股票和现金都保持原值。</p>
        </section>

        <div className="form-actions">
          <Link className="button button--quiet button--full" href="/">取消</Link>
          <button className="button button--primary button--full" type="submit" disabled={preview === null || instrument === null || isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "保存中…" : side === "BUY" ? "确认买入" : "确认卖出"}
          </button>
        </div>
      </form>
    </main>
  );
}
