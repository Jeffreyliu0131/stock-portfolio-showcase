"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  PositionRepositoryError,
  projectBrokerPortfolioSnapshots,
  type PositionSnapshot,
} from "../application/positions/index.ts";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "../application/portfolio-repository.ts";
import { requestInstrumentResolution } from "../application/instruments/browser/instrument-client.ts";
import {
  Decimal,
  aggregatePositionInputs,
  instrumentKeyId,
  type BrokerCode,
  type BrokerPortfolioBook,
  type InstrumentKey,
} from "../domain/index.ts";
import { formatQuantity, formatUsd } from "../ui/position-preview.ts";

type SourceValues = {
  quantity: string;
  totalOpenCost: string;
};

type SetupRow = {
  instrument: InstrumentKey;
  displayName: string;
  previousQuantity: string;
  previousOpenCost: string;
  IBKR: SourceValues;
  MOOMOO: SourceValues;
};

type CashValues = {
  settled: string;
  pending: string;
};

type SetupError = {
  message: string;
  fieldId?: string;
};

type Preview = {
  positionCount: number;
  totalQuantity: string;
  totalOpenCost: string;
  totalCash: string;
};

const PLAIN_DECIMAL = /^-?\d+(?:\.\d{1,8})?$/;
const NON_NEGATIVE_DECIMAL = /^\d+(?:\.\d{1,8})?$/;

function eventId(prefix: string): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}`;
}

function sourceValues(): SourceValues {
  return { quantity: "", totalOpenCost: "" };
}

function fromBook(
  book: BrokerPortfolioBook,
  snapshots: readonly PositionSnapshot[],
): SetupRow[] {
  const rows = new Map<string, SetupRow>();
  for (const snapshot of snapshots) {
    const [position] = aggregatePositionInputs(snapshot.batch.inputs);
    if (position === undefined) {
      continue;
    }
    rows.set(instrumentKeyId(position.instrument), {
      instrument: position.instrument,
      displayName: snapshot.batch.displayName ?? position.instrument.symbol,
      previousQuantity: position.quantity,
      previousOpenCost: position.openCost,
      IBKR: sourceValues(),
      MOOMOO: sourceValues(),
    });
  }
  for (const position of book.positions) {
    const key = instrumentKeyId(position.instrument);
    const row = rows.get(key) ?? {
      instrument: position.instrument,
      displayName: position.displayName ?? position.instrument.symbol,
      previousQuantity: "0",
      previousOpenCost: "0",
      IBKR: sourceValues(),
      MOOMOO: sourceValues(),
    };
    row[position.broker] = {
      quantity: position.quantity,
      totalOpenCost: position.totalOpenCost,
    };
    rows.set(key, row);
  }
  return [...rows.values()];
}

function fromLegacy(snapshots: readonly PositionSnapshot[]): SetupRow[] {
  return snapshots.flatMap((snapshot) => {
    const [position] = aggregatePositionInputs(snapshot.batch.inputs);
    if (position === undefined) {
      return [];
    }
    return [
      {
        instrument: position.instrument,
        displayName: snapshot.batch.displayName ?? position.instrument.symbol,
        previousQuantity: position.quantity,
        previousOpenCost: position.openCost,
        IBKR: sourceValues(),
        MOOMOO: sourceValues(),
      },
    ];
  });
}

function normalizedNonNegative(value: string, field: string): string {
  const normalized = value.trim() || "0";
  if (!NON_NEGATIVE_DECIMAL.test(normalized)) {
    throw new Error(`${field}必须是非负数，最多 8 位小数。`);
  }
  return new Decimal(normalized).toString();
}

function normalizedSigned(value: string, field: string): string {
  const normalized = value.trim() || "0";
  if (!PLAIN_DECIMAL.test(normalized)) {
    throw new Error(`${field}必须是数字，最多 8 位小数。`);
  }
  return new Decimal(normalized).toString();
}

export function BrokerPortfolioSetup({
  repository: repositoryInput,
}: {
  repository?: PortfolioRepository;
}) {
  const repositoryRef = useRef<PortfolioRepository | null>(null);
  repositoryRef.current ??= repositoryInput ?? createPortfolioRepository();
  const repository = repositoryRef.current;
  const router = useRouter();
  const [book, setBook] = useState<BrokerPortfolioBook | null>(null);
  const [rows, setRows] = useState<SetupRow[]>([]);
  const [cash, setCash] = useState<Record<BrokerCode, CashValues>>({
    IBKR: { settled: "", pending: "" },
    MOOMOO: { settled: "", pending: "" },
  });
  const [pricingPlan, setPricingPlan] = useState<"IBKR_PRO" | "IBKR_LITE">(
    "IBKR_PRO",
  );
  const [netAssetValue, setNetAssetValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [isAddingSymbol, setIsAddingSymbol] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [currentBook, legacySnapshots, legacyCash] = await Promise.all([
          repository.getBrokerPortfolioBook(),
          repository.listSnapshots(),
          repository.getCashSnapshot(),
        ]);
        if (!active) return;
        setBook(currentBook);
        setRows(
          currentBook === null
            ? fromLegacy(legacySnapshots)
            : fromBook(
                currentBook,
                projectBrokerPortfolioSnapshots(currentBook),
              ),
        );
        if (currentBook !== null) {
          const nextCash = { ...cash };
          for (const account of currentBook.cashAccounts) {
            nextCash[account.broker] = {
              settled: account.settledBalance,
              pending: account.pendingBalance,
            };
            if (account.broker === "IBKR") {
              if (account.pricingPlan !== undefined) {
                setPricingPlan(account.pricingPlan);
              }
              setNetAssetValue(
                account.navSource === "USER_ENTERED"
                  ? account.netAssetValue ?? ""
                  : "",
              );
            }
          }
          setCash(nextCash);
        } else if (legacyCash !== null) {
          setCash({
            IBKR: { settled: legacyCash.account.balance, pending: "0" },
            MOOMOO: { settled: "", pending: "" },
          });
          setPricingPlan(legacyCash.account.pricingPlan);
          setNetAssetValue(
            legacyCash.account.navSource === "USER_ENTERED"
              ? legacyCash.account.netAssetValue
              : "",
          );
        }
      } catch {
        if (active) {
          setError({ message: "无法读取账号资产；没有修改任何数据。" });
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // Initial cash defaults are intentionally captured once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const previousSummary = useMemo(() => {
    return rows.reduce(
      (summary, row) => ({
        quantity: summary.quantity.add(row.previousQuantity),
        openCost: summary.openCost.add(row.previousOpenCost),
      }),
      { quantity: new Decimal(0), openCost: new Decimal(0) },
    );
  }, [rows]);

  const updateSource = (
    rowIndex: number,
    broker: BrokerCode,
    field: keyof SourceValues,
    value: string,
  ) => {
    setRows((current) =>
      current.map((row, index) =>
        index === rowIndex
          ? { ...row, [broker]: { ...row[broker], [field]: value } }
          : row,
      ),
    );
    setPreview(null);
    setError(null);
  };

  const assignWholePosition = (rowIndex: number, broker: BrokerCode) => {
    setRows((current) =>
      current.map((row, index) =>
        index !== rowIndex
          ? row
          : {
              ...row,
              IBKR: broker === "IBKR"
                ? {
                    quantity: row.previousQuantity,
                    totalOpenCost: row.previousOpenCost,
                  }
                : sourceValues(),
              MOOMOO: broker === "MOOMOO"
                ? {
                    quantity: row.previousQuantity,
                    totalOpenCost: row.previousOpenCost,
                  }
                : sourceValues(),
            },
      ),
    );
    setPreview(null);
    setError(null);
  };

  const addCalibrationInstrument = async () => {
    const normalized = newSymbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(normalized) || isAddingSymbol) {
      setError({ message: "请输入有效的美国上市股票代码。" });
      return;
    }
    setIsAddingSymbol(true);
    setError(null);
    try {
      const resolved = await requestInstrumentResolution(normalized);
      const key = instrumentKeyId(resolved.instrument);
      if (rows.some((row) => instrumentKeyId(row.instrument) === key)) {
        setError({ message: `${resolved.instrument.symbol} 已在校准列表中。` });
        return;
      }
      setRows((current) => [
        ...current,
        {
          instrument: resolved.instrument,
          displayName: resolved.displayName,
          previousQuantity: "0",
          previousOpenCost: "0",
          IBKR: sourceValues(),
          MOOMOO: sourceValues(),
        },
      ]);
      setNewSymbol("");
      setPreview(null);
    } catch {
      setError({ message: "无法识别该股票代码，请检查后重试。" });
    } finally {
      setIsAddingSymbol(false);
    }
  };

  const buildBaseline = () => {
    const positions = rows.flatMap((row, rowIndex) =>
      (["IBKR", "MOOMOO"] as const).flatMap((brokerCode) => {
        const source = row[brokerCode];
        const quantity = normalizedNonNegative(
          source.quantity,
          `${row.instrument.symbol} ${brokerCode} 数量`,
        );
        const totalOpenCost = normalizedNonNegative(
          source.totalOpenCost,
          `${row.instrument.symbol} ${brokerCode} 剩余总成本`,
        );
        if (new Decimal(quantity).isZero()) {
          if (!new Decimal(totalOpenCost).isZero()) {
            const fieldId = `position-${rowIndex}-${brokerCode}-quantity`;
            const invalid = new Error("数量为 0 时，剩余总成本也必须为 0。") as Error & {
              fieldId?: string;
            };
            invalid.fieldId = fieldId;
            throw invalid;
          }
          return [];
        }
        return [
          {
            broker: brokerCode,
            instrument: row.instrument,
            displayName: row.displayName,
            quantity,
            totalOpenCost,
          },
        ];
      }),
    );
    const ibkrSettled = normalizedSigned(cash.IBKR.settled, "IBKR 已结算现金");
    const ibkrPending = normalizedSigned(cash.IBKR.pending, "IBKR 待结算现金");
    const moomooSettled = normalizedSigned(
      cash.MOOMOO.settled,
      "moomoo 已结算现金",
    );
    const moomooPending = normalizedSigned(
      cash.MOOMOO.pending,
      "moomoo 待结算现金",
    );
    const fallbackNav = Decimal.max(new Decimal(ibkrSettled), 0).toString();
    const normalizedNav =
      netAssetValue.trim().length === 0
        ? fallbackNav
        : normalizedNonNegative(netAssetValue, "IBKR NAV");
    if (
      netAssetValue.trim().length > 0 &&
      new Decimal(normalizedNav).lte(0)
    ) {
      throw new Error("IBKR NAV 必须大于 0。");
    }
    const hasPositiveIbkrCash = new Decimal(ibkrSettled).gt(0);
    return {
      positions,
      cashAccounts: [
        {
          broker: "IBKR" as const,
          currency: "USD" as const,
          settledBalance: ibkrSettled,
          pendingBalance: ibkrPending,
          ...(hasPositiveIbkrCash || netAssetValue.trim().length > 0
            ? {
                pricingPlan,
                netAssetValue: normalizedNav,
                navSource:
                  netAssetValue.trim().length > 0
                    ? ("USER_ENTERED" as const)
                    : ("CASH_BALANCE_FALLBACK" as const),
              }
            : {}),
        },
        {
          broker: "MOOMOO" as const,
          currency: "USD" as const,
          settledBalance: moomooSettled,
          pendingBalance: moomooPending,
        },
      ],
      effectiveAt: new Date().toISOString(),
      reason: book === null ? "建立双券商当前基线" : "按券商当前值校准",
    };
  };

  const createPreview = () => {
    try {
      const baseline = buildBaseline();
      if (
        baseline.positions.length === 0 &&
        baseline.cashAccounts.every((account) =>
          new Decimal(account.settledBalance)
            .add(account.pendingBalance)
            .isZero(),
        )
      ) {
        throw new Error("校准结果为空；请至少填写一项当前资产。 ");
      }
      const totalQuantity = baseline.positions.reduce(
        (total, position) => total.add(position.quantity),
        new Decimal(0),
      );
      const totalOpenCost = baseline.positions.reduce(
        (total, position) => total.add(position.totalOpenCost),
        new Decimal(0),
      );
      const totalCash = baseline.cashAccounts.reduce(
        (total, account) =>
          total.add(account.settledBalance).add(account.pendingBalance),
        new Decimal(0),
      );
      setPreview({
        positionCount: baseline.positions.length,
        totalQuantity: totalQuantity.toString(),
        totalOpenCost: totalOpenCost.toString(),
        totalCash: totalCash.toString(),
      });
      setError(null);
    } catch (caught) {
      const fieldId =
        caught instanceof Error && "fieldId" in caught
          ? (caught as Error & { fieldId?: string }).fieldId
          : undefined;
      setError({
        message: caught instanceof Error ? caught.message : "校准内容无效。",
        ...(fieldId === undefined ? {} : { fieldId }),
      });
      setPreview(null);
      if (fieldId !== undefined) {
        requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      }
    }
  };

  const confirm = async () => {
    if (preview === null || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await repository.replaceBrokerPortfolioBaseline(buildBaseline(), {
        expectedRevision: book?.revision ?? null,
        eventId: eventId("reconciliation"),
      });
      router.push("/");
    } catch (caught) {
      setPreview(null);
      setError({
        message:
          caught instanceof PositionRepositoryError &&
          caught.code === "BROKER_PORTFOLIO_CONFLICT"
            ? "另一页面刚更新了组合。没有覆盖最新数据，请返回首页刷新后重试。"
            : "校准保存失败；新账本没有部分生效，旧数据也没有被改写。",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <main className="app-shell app-shell--centered">正在读取账号组合…</main>;
  }

  return (
    <main className="app-shell app-shell--form precision-form broker-setup">
      <header className="form-header">
        <Link className="icon-link" href="/">返回</Link>
        <div>
          <p className="eyebrow">统一展示 · 分券商记账</p>
          <h1>{book === null ? "启用双券商账本" : "校准双券商组合"}</h1>
        </div>
        <span className="form-header__spacer" aria-hidden="true" />
      </header>

      <section className="form-alert form-alert--info">
        <strong>旧持仓不会被迁移或删除</strong>
        <p>
          确认后首页读取新的 IBKR/moomoo 基线；旧 v3 current 原样保留。股票仍按代码合并展示，买卖只影响所选券商。
        </p>
      </section>

      {error ? <p className="form-alert" role="alert">{error.message}</p> : null}

      <section className="form-section" aria-labelledby="broker-stock-heading">
        <div className="form-section__heading">
          <span>1</span>
          <div>
            <h2 id="broker-stock-heading">按券商核对当前股票</h2>
            <p>填写卖出后的当前数量和剩余总成本；不用回放过去交易。</p>
          </div>
        </div>
        <div className="broker-setup__add-instrument">
          <label>
            添加旧组合中没有的当前持仓
            <input
              value={newSymbol}
              onChange={(event) => setNewSymbol(event.target.value.toUpperCase())}
              placeholder="股票代码，例如 BOXX"
              autoCapitalize="characters"
            />
          </label>
          <button
            className="button button--secondary"
            type="button"
            disabled={isAddingSymbol}
            onClick={() => void addCalibrationInstrument()}
          >
            {isAddingSymbol ? "识别中…" : "添加到校准"}
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="preview-card__empty">旧组合没有股票；启用后可从首页直接买入。</p>
        ) : (
          <div className="broker-setup__positions">
            {rows.map((row, rowIndex) => (
              <article className="broker-setup__position" key={instrumentKeyId(row.instrument)}>
                <header>
                  <div>
                    <strong>{row.instrument.symbol}</strong>
                    <span>{row.displayName}</span>
                  </div>
                  <p>
                    旧值 {formatQuantity(row.previousQuantity)} 股 · 成本 {formatUsd(row.previousOpenCost)}
                  </p>
                </header>
                {(["IBKR", "MOOMOO"] as const).map((brokerCode) => (
                  <fieldset className="broker-setup__source" key={brokerCode}>
                    <legend>{brokerCode}</legend>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => assignWholePosition(rowIndex, brokerCode)}
                    >
                      旧值全部归这里
                    </button>
                    <label>
                      当前数量
                      <input
                        id={`position-${rowIndex}-${brokerCode}-quantity`}
                        inputMode="decimal"
                        value={row[brokerCode].quantity}
                        onChange={(event) =>
                          updateSource(rowIndex, brokerCode, "quantity", event.target.value)
                        }
                        placeholder="0"
                      />
                    </label>
                    <label>
                      剩余总成本（USD）
                      <input
                        inputMode="decimal"
                        value={row[brokerCode].totalOpenCost}
                        onChange={(event) =>
                          updateSource(rowIndex, brokerCode, "totalOpenCost", event.target.value)
                        }
                        placeholder="0"
                      />
                    </label>
                  </fieldset>
                ))}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="form-section" aria-labelledby="broker-cash-heading">
        <div className="form-section__heading">
          <span>2</span>
          <div>
            <h2 id="broker-cash-heading">核对两边 USD 现金</h2>
            <p>待结算款计入总资产，但不进入 IBKR 利息估算。</p>
          </div>
        </div>
        <div className="broker-setup__cash-grid">
          {(["IBKR", "MOOMOO"] as const).map((brokerCode) => (
            <fieldset key={brokerCode}>
              <legend>{brokerCode} USD</legend>
              <label>
                已结算现金
                <input
                  inputMode="decimal"
                  value={cash[brokerCode].settled}
                  onChange={(event) => {
                    setCash((current) => ({
                      ...current,
                      [brokerCode]: { ...current[brokerCode], settled: event.target.value },
                    }));
                    setPreview(null);
                  }}
                  placeholder="0"
                />
              </label>
              <label>
                待结算净额
                <input
                  inputMode="decimal"
                  value={cash[brokerCode].pending}
                  onChange={(event) => {
                    setCash((current) => ({
                      ...current,
                      [brokerCode]: { ...current[brokerCode], pending: event.target.value },
                    }));
                    setPreview(null);
                  }}
                  placeholder="0"
                />
              </label>
            </fieldset>
          ))}
        </div>
        <div className="field-grid">
          <label>
            IBKR 方案
            <select value={pricingPlan} onChange={(event) => {
              setPricingPlan(event.target.value as "IBKR_PRO" | "IBKR_LITE");
              setPreview(null);
            }}>
              <option value="IBKR_PRO">IBKR Pro</option>
              <option value="IBKR_LITE">IBKR Lite</option>
            </select>
          </label>
          <label>
            IBKR NAV（可选）
            <input
              inputMode="decimal"
              value={netAssetValue}
              onChange={(event) => {
                setNetAssetValue(event.target.value);
                setPreview(null);
              }}
              placeholder="留空则按正已结算现金"
            />
          </label>
        </div>
      </section>

      <section className="preview-card" aria-labelledby="broker-preview-heading">
        <p className="eyebrow">确认前预览</p>
        <h2 id="broker-preview-heading">新双券商基线</h2>
        {preview === null ? (
          <p className="preview-card__empty">先检查输入，再生成预览；此时不会写入。</p>
        ) : (
          <dl className="preview-metrics">
            <div><dt>券商持仓分项</dt><dd>{preview.positionCount}</dd></div>
            <div><dt>总股数</dt><dd>{formatQuantity(preview.totalQuantity)}</dd></div>
            <div><dt>股票剩余成本</dt><dd>{formatUsd(preview.totalOpenCost)}</dd></div>
            <div><dt>两边账面现金</dt><dd>{formatUsd(preview.totalCash)}</dd></div>
          </dl>
        )}
        <p>
          旧聚合参考：{formatQuantity(previousSummary.quantity.toString())} 股 · 成本 {formatUsd(previousSummary.openCost.toString())}。
        </p>
      </section>

      <div className="form-actions">
        <button className="button button--secondary button--full" type="button" onClick={createPreview} disabled={isSaving}>
          检查并生成预览
        </button>
        <button className="button button--primary button--full" type="button" onClick={() => void confirm()} disabled={preview === null || isSaving} aria-busy={isSaving}>
          {isSaving ? "正在建立…" : book === null ? "确认启用双券商账本" : "确认本次校准"}
        </button>
      </div>
    </main>
  );
}
