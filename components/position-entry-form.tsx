"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  PositionRepositoryError,
  type PositionSnapshot,
} from "../application/positions/index.ts";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "../application/portfolio-repository.ts";
import {
  resolveSupportedInstrument,
} from "../application/instruments/index.ts";
import {
  InstrumentClientError,
  requestInstrumentResolution,
} from "../application/instruments/browser/instrument-client.ts";
import {
  instrumentKeyId,
  type InstrumentKey,
} from "../domain/instrument.ts";
import { aggregatePositionInputs } from "../domain/positions.ts";
import {
  calculatePositionPreview,
  formatQuantity,
  formatUsd,
  isNonNegativeDecimalInput,
  isPositiveDecimalInput,
  type CostMode,
  type PositionInputRow,
} from "../ui/position-preview";

type EntryRow = PositionInputRow & {
  id: string;
};

type PositionEntryFormProps = {
  initialInstrumentKey?: string;
  initialMode?: "edit" | "add";
};

type LoadedSnapshotBaseline = {
  instrumentId: string;
  revision: number;
};

type RowErrors = {
  quantity?: string;
  cost?: string;
};

type FormErrors = {
  symbol?: string;
  name?: string;
  rows: Record<string, RowErrors>;
};

const INITIAL_ROW: EntryRow = {
  id: "position-input-1",
  quantity: "",
  cost: "",
  costMode: "average",
};

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;
const AUTO_RESOLVE_DELAY_MS = 500;
const DEFAULT_CURRENCY = "USD";
const EditDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
});

function listingMarketLabel(market: string): string {
  switch (market) {
    case "NASDAQ":
      return "纳斯达克（NASDAQ）";
    case "NYSE":
      return "纽约证券交易所（NYSE）";
    case "AMEX":
      return "纽交所美国市场（AMEX）";
    case "ARCA":
    case "NYSEARCA":
      return "纽交所 Arca";
    case "BATS":
      return "Cboe BZX（BATS）";
    default:
      return market;
  }
}

function nextAvailableRowNumber(rows: readonly EntryRow[]): number {
  const ids = new Set(rows.map((row) => row.id));
  let candidate = 1;
  while (ids.has(`position-input-${candidate}`)) {
    candidate += 1;
  }
  return candidate;
}

function parseInitialInstrumentKey(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
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
    const resolved = resolveSupportedInstrument({
      listingMarket,
      symbol,
      currency,
    });
    return resolved.ok ? resolved.instrument : null;
  } catch {
    return null;
  }
}

function rowsFromSnapshot(snapshot: PositionSnapshot): EntryRow[] {
  return snapshot.batch.inputs.map((input) => ({
    id: input.id,
    quantity: input.quantity,
    cost: input.costInput.value,
    costMode:
      input.costInput.mode === "TOTAL_OPEN_COST"
        ? ("total" as const)
        : ("average" as const),
  }));
}

function aggregateRowFromSnapshot(
  snapshot: PositionSnapshot,
): EntryRow[] {
  const position =
    aggregatePositionInputs(snapshot.batch.inputs)[0];
  if (position === undefined) {
    return [INITIAL_ROW];
  }
  const editableAverageCost = new EditDecimal(
    position.averageCost,
  )
    .toDecimalPlaces(8)
    .toFixed();
  return [
    {
      id: "position-input-1",
      quantity: position.quantity,
      cost: editableAverageCost,
      costMode: "average",
    },
  ];
}

function validateRows(rows: readonly EntryRow[]): Record<string, RowErrors> {
  const rowErrors: Record<string, RowErrors> = {};

  for (const row of rows) {
    const errors: RowErrors = {};

    if (!isPositiveDecimalInput(row.quantity)) {
      errors.quantity = "请输入大于 0、最多 8 位小数的数量。";
    }

    if (!isNonNegativeDecimalInput(row.cost)) {
      errors.cost = "请输入大于或等于 0、最多 8 位小数的成本。";
    }

    if (errors.quantity || errors.cost) {
      rowErrors[row.id] = errors;
    }
  }

  return rowErrors;
}

export function PositionEntryForm({
  initialInstrumentKey,
  initialMode,
}: PositionEntryFormProps = {}) {
  const entryMode =
    initialInstrumentKey === undefined
      ? ("create" as const)
      : (initialMode ?? "edit");
  const isAdditiveMode = entryMode !== "edit";
  const isTargetedMode = entryMode !== "create";
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const repositoryRef = useRef<PortfolioRepository | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instrumentRequestSequence = useRef(0);
  const verifiedSymbol = useRef("");
  const submissionInFlight = useRef(false);
  const submitted = useRef(false);
  const nextRowId = useRef(2);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [market, setMarket] = useState("");
  const [rows, setRows] = useState<EntryRow[]>([INITIAL_ROW]);
  const [errors, setErrors] = useState<FormErrors>({ rows: {} });
  const [isHydrated, setIsHydrated] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [instrumentState, setInstrumentState] = useState<
    "idle" | "checking" | "verified" | "error"
  >("idle");
  const [instrumentMessage, setInstrumentMessage] = useState<string | null>(
    null,
  );
  const [existingSnapshot, setExistingSnapshot] =
    useState<PositionSnapshot | null>(null);
  const [loadedSnapshotBaseline, setLoadedSnapshotBaseline] =
    useState<LoadedSnapshotBaseline | null>(null);
  const [preserveEntryDraft, setPreserveEntryDraft] =
    useState(false);
  const [rowChangeNotice, setRowChangeNotice] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "error">(
    "idle",
  );

  const repository = () => {
    repositoryRef.current ??= createPortfolioRepository();
    return repositoryRef.current;
  };

  function applySnapshot(
    snapshot: PositionSnapshot,
    notice = `已载入 ${snapshot.batch.instrument.symbol} 当前合并数量与均价。`,
  ) {
    const restoredRows = aggregateRowFromSnapshot(snapshot);
    setSymbol(snapshot.batch.instrument.symbol);
    setName(
      snapshot.batch.displayName ?? snapshot.batch.instrument.symbol,
    );
    setMarket(snapshot.batch.instrument.listingMarket);
    verifiedSymbol.current = snapshot.batch.instrument.symbol;
    setRows(restoredRows);
    nextRowId.current = nextAvailableRowNumber(restoredRows);
    setExistingSnapshot(snapshot);
    setLoadedSnapshotBaseline({
      instrumentId: instrumentKeyId(snapshot.batch.instrument),
      revision: snapshot.revision,
    });
    setErrors({ rows: {} });
    setInstrumentState("verified");
    setInstrumentMessage(
      `已载入当前持仓：${
        snapshot.batch.displayName ?? snapshot.batch.instrument.symbol
      } · ${snapshot.batch.instrument.listingMarket} · USD`,
    );
    setSubmitState("idle");
    setDraftNotice(notice);
  }

  useEffect(() => {
    let active = true;
    submissionInFlight.current = false;
    submitted.current = false;
    setIsHydrated(false);
    setSymbol("");
    setName("");
    setMarket("");
    verifiedSymbol.current = "";
    setRows([INITIAL_ROW]);
    setErrors({ rows: {} });
    setDraftNotice(null);
    setInstrumentState("idle");
    setInstrumentMessage(null);
    setExistingSnapshot(null);
    setLoadedSnapshotBaseline(null);
    setPreserveEntryDraft(false);
    setRowChangeNotice("");
    setSubmitState("idle");
    nextRowId.current = 2;
    const hydrate = async () => {
      try {
        const currentRepository = repository();
        const brokerReader = currentRepository as unknown as {
          getBrokerPortfolioBook?: () => Promise<unknown>;
        };
        const brokerBook =
          typeof brokerReader.getBrokerPortfolioBook === "function"
            ? await brokerReader.getBrokerPortfolioBook()
            : null;
        if (brokerBook !== null) {
          const destination =
            initialMode === "edit"
              ? "/portfolio-setup"
              : initialInstrumentKey === undefined
                ? "/trades/new?side=BUY"
                : `/trades/new?side=BUY&instrument=${encodeURIComponent(initialInstrumentKey)}`;
          router.replace(destination);
          return;
        }
        const initialInstrument = parseInitialInstrumentKey(
          initialInstrumentKey,
        );
        if (initialInstrumentKey !== undefined) {
          if (initialInstrument === null) {
            if (active) {
              setDraftNotice(
                "无法识别要编辑的持仓；正式持仓没有被更改。",
              );
            }
            return;
          }
          const snapshot = await repository().getSnapshot(
            initialInstrument,
          );
          if (!active) {
            return;
          }
          if (snapshot === null) {
            setSymbol(initialInstrument.symbol);
            setMarket(initialInstrument.listingMarket);
            setDraftNotice(
              "没有找到该标的的当前持仓，请返回首页后重试。",
            );
            return;
          }
          setPreserveEntryDraft(true);
          if (entryMode === "add") {
            setSymbol(snapshot.batch.instrument.symbol);
            setName(
              snapshot.batch.displayName ??
                snapshot.batch.instrument.symbol,
            );
            setMarket(snapshot.batch.instrument.listingMarket);
            verifiedSymbol.current =
              snapshot.batch.instrument.symbol;
            setRows([INITIAL_ROW]);
            setExistingSnapshot(snapshot);
            setLoadedSnapshotBaseline({
              instrumentId: instrumentKeyId(
                snapshot.batch.instrument,
              ),
              revision: snapshot.revision,
            });
            setInstrumentState("verified");
            setInstrumentMessage(
              `已选择：${
                snapshot.batch.displayName ??
                snapshot.batch.instrument.symbol
              } · ${snapshot.batch.instrument.listingMarket} · USD`,
            );
            setDraftNotice(
              `准备为 ${snapshot.batch.instrument.symbol} 加仓。`,
            );
          } else {
            applySnapshot(snapshot);
          }
          return;
        }

        const draft = await repository().getEntryDraft();
        if (!active || draft === null) {
          return;
        }
        setSymbol(draft.symbol);
        setName(draft.displayName);
        setMarket(
          draft.listingMarket === "NYSE_ARCA"
            ? "NYSEARCA"
            : draft.listingMarket,
        );
        if (draft.rows.length > 0) {
          const legacyCostMode: CostMode =
            draft.costMode === "total" ? "total" : "average";
          const restoredRows = draft.rows.map((row) => ({
            id: row.id,
            quantity: row.quantity,
            cost: row.costValue,
            costMode:
              row.costMode === "total"
                ? ("total" as const)
                : row.costMode === "average"
                  ? ("average" as const)
                  : legacyCostMode,
          }));
          setRows(restoredRows);
          nextRowId.current =
            nextAvailableRowNumber(restoredRows);
        }
        setDraftNotice("已恢复上次未保存的输入。");
      } catch {
        if (active) {
          setDraftNotice(
            initialInstrumentKey === undefined
              ? "无法恢复上次草稿；正式持仓没有被更改。"
              : "无法载入当前持仓；正式持仓没有被更改。",
          );
        }
      } finally {
        if (active) {
          setIsHydrated(true);
        }
      }
    };
    void hydrate();

    return () => {
      active = false;
      instrumentRequestSequence.current += 1;
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
      }
    };
  }, [entryMode, initialInstrumentKey, initialMode, router]);

  useEffect(() => {
    if (
      !isHydrated ||
      submitted.current ||
      preserveEntryDraft
    ) {
      return;
    }
    const hasContent =
      symbol.trim().length > 0 ||
      name.trim().length > 0 ||
      rows.some(
        (row) =>
          row.quantity.trim().length > 0 ||
          row.cost.trim().length > 0,
      );
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    if (!hasContent) {
      void repository().clearEntryDraft().catch(() => {
        setDraftNotice("空白草稿暂时无法清除。");
      });
      return;
    }
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      void repository()
        .saveEntryDraft({
          symbol,
          displayName: name,
          listingMarket: market,
          currency: DEFAULT_CURRENCY,
          costMode: rows[0]?.costMode ?? "average",
          rows: rows.map((row) => ({
            id: row.id,
            quantity: row.quantity,
            costValue: row.cost,
            costMode: row.costMode,
          })),
        })
        .catch(() => {
          setDraftNotice("草稿暂时无法自动保存；请勿关闭此页面。");
        });
    }, 400);
  }, [
    isHydrated,
    market,
    name,
    rows,
    symbol,
    preserveEntryDraft,
  ]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const resolved = resolveSupportedInstrument({
      symbol,
      listingMarket: market,
      currency: DEFAULT_CURRENCY,
    });
    if (!resolved.ok) {
      setExistingSnapshot(null);
      return;
    }
    let active = true;
    void repository()
      .getSnapshot(resolved.instrument)
      .then((snapshot) => {
        if (active) {
          setExistingSnapshot(snapshot);
        }
      })
      .catch(() => {
        if (active) {
          setExistingSnapshot(null);
        }
      });
    return () => {
      active = false;
    };
  }, [isHydrated, market, symbol]);

  const incomingPreview = useMemo(
    () => calculatePositionPreview(rows),
    [rows],
  );
  const preview = useMemo(() => {
    const previewRows =
      isAdditiveMode && existingSnapshot !== null
        ? [
            ...rowsFromSnapshot(existingSnapshot),
            ...rows,
          ]
        : rows;
    return calculatePositionPreview(previewRows);
  }, [existingSnapshot, isAdditiveMode, rows]);
  const targetUnavailable =
    isTargetedMode && existingSnapshot === null;

  const updateRow = (id: string, field: "quantity" | "cost", value: string) => {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );

    setErrors((currentErrors) => {
      const existing = currentErrors.rows[id];
      if (!existing?.[field]) {
        return currentErrors;
      }

      const nextRowErrors = { ...existing };
      delete nextRowErrors[field];
      const nextRows = { ...currentErrors.rows };

      if (nextRowErrors.quantity || nextRowErrors.cost) {
        nextRows[id] = nextRowErrors;
      } else {
        delete nextRows[id];
      }

      return { ...currentErrors, rows: nextRows };
    });
  };

  const updateRowCostMode = (id: string, costMode: CostMode) => {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.id === id ? { ...row, costMode } : row,
      ),
    );
  };

  const addRow = () => {
    const existingIds = new Set(rows.map((row) => row.id));
    while (
      existingIds.has(
        `position-input-${nextRowId.current}`,
      )
    ) {
      nextRowId.current += 1;
    }
    const id = `position-input-${nextRowId.current}`;
    nextRowId.current += 1;
    setRows((currentRows) => [
      ...currentRows,
      {
        id,
        quantity: "",
        cost: "",
        costMode:
          currentRows[currentRows.length - 1]?.costMode ?? "average",
      },
    ]);
    setRowChangeNotice(`已添加输入 ${rows.length + 1}。`);
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>(`#${id}-quantity`)
        ?.focus();
    });
  };

  const removeRow = (id: string) => {
    if (rows.length === 1) {
      return;
    }

    const removedIndex = rows.findIndex((row) => row.id === id);
    const focusRow =
      rows[removedIndex + 1] ?? rows[removedIndex - 1] ?? null;
    setRows((currentRows) => currentRows.filter((row) => row.id !== id));
    setErrors((currentErrors) => {
      const nextRows = { ...currentErrors.rows };
      delete nextRows[id];
      return { ...currentErrors, rows: nextRows };
    });
    setRowChangeNotice(
      `已删除输入 ${removedIndex + 1}，当前共 ${rows.length - 1} 组输入。`,
    );
    requestAnimationFrame(() => {
      const target = focusRow
        ? formRef.current?.querySelector<HTMLElement>(
            `#${focusRow.id}-quantity`,
          )
        : formRef.current?.querySelector<HTMLElement>(
            "#add-position-row",
          );
      target?.focus();
    });
  };

  const verifyInstrument = async (symbolInput = symbol) => {
    const requestSequence =
      instrumentRequestSequence.current + 1;
    instrumentRequestSequence.current = requestSequence;
    const normalizedSymbol = symbolInput.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(normalizedSymbol)) {
      setInstrumentState("error");
      setInstrumentMessage(
        "请输入有效的股票代码，例如 AAPL 或 BRK.B。",
      );
      return null;
    }

    verifiedSymbol.current = "";
    setName("");
    setMarket("");
    setExistingSnapshot(null);
    setLoadedSnapshotBaseline(null);
    setInstrumentState("checking");
    setInstrumentMessage("正在自动识别股票名称和上市市场…");
    try {
      const result = await requestInstrumentResolution(
        normalizedSymbol,
      );
      if (
        requestSequence !== instrumentRequestSequence.current
      ) {
        return null;
      }
      verifiedSymbol.current = result.instrument.symbol;
      setSymbol(result.instrument.symbol);
      setMarket(result.instrument.listingMarket);
      setName(result.displayName);
      setInstrumentState("verified");
      setInstrumentMessage(
        `已由 Alpaca 确认：${result.displayName} · ${result.instrument.listingMarket} · USD`,
      );
      return result;
    } catch (error) {
      if (
        requestSequence !== instrumentRequestSequence.current
      ) {
        return null;
      }
      setInstrumentState("error");
      setInstrumentMessage(
        error instanceof Error
          ? error.message
          : "标的验证失败，请稍后重试。",
      );
      return null;
    }
  };

  useEffect(() => {
    if (
      !isHydrated ||
      submitState === "submitting" ||
      submitted.current
    ) {
      return;
    }
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (
      normalizedSymbol.length === 0 ||
      verifiedSymbol.current === normalizedSymbol
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void verifyInstrument(normalizedSymbol);
    }, AUTO_RESOLVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isHydrated, submitState, symbol]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      submitState === "submitting" ||
      submissionInFlight.current
    ) {
      return;
    }
    if (targetUnavailable) {
      setDraftNotice(
        "该持仓已不存在，请返回首页后重新选择。",
      );
      return;
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const nextErrors: FormErrors = {
      rows: validateRows(rows),
    };

    if (!SYMBOL_PATTERN.test(normalizedSymbol)) {
      nextErrors.symbol = "请输入有效的股票代码，例如 AAPL 或 BRK.B。";
    }

    setSymbol(normalizedSymbol);
    setErrors(nextErrors);

    if (
      nextErrors.symbol ||
      nextErrors.name ||
      Object.keys(nextErrors.rows).length > 0
    ) {
      requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus();
      });
      return;
    }

    submissionInFlight.current = true;
    setSubmitState("submitting");
    instrumentRequestSequence.current += 1;
    let submittedInstrument: InstrumentKey | null = null;
    try {
      const verified = await requestInstrumentResolution(
        normalizedSymbol,
      );
      submittedInstrument = verified.instrument;
      verifiedSymbol.current = verified.instrument.symbol;
      setSymbol(verified.instrument.symbol);
      setMarket(verified.instrument.listingMarket);
      setName(verified.displayName);
      setInstrumentState("verified");
      setInstrumentMessage(
        `已由 Alpaca 确认：${verified.displayName} · ${verified.instrument.listingMarket} · USD`,
      );
      const verifiedInstrumentId = instrumentKeyId(
        verified.instrument,
      );
      const expectedRevision =
        loadedSnapshotBaseline?.instrumentId ===
        verifiedInstrumentId
          ? loadedSnapshotBaseline.revision
          : null;
      const batch = {
        instrument: verified.instrument,
        displayName: verified.displayName,
        inputs: rows.map((row) => ({
          id: row.id,
          instrument: verified.instrument,
          quantity: row.quantity.trim(),
          costInput: {
            mode:
              row.costMode === "average"
                ? ("AVERAGE_COST" as const)
                : ("TOTAL_OPEN_COST" as const),
            value: row.cost.trim(),
          },
        })),
      };
      if (isAdditiveMode) {
        await repository().addInputsToBatch(
          batch,
          entryMode === "add"
            ? { expectedRevision }
            : undefined,
        );
      } else {
        await repository().replaceBatch(batch, {
          expectedRevision,
        });
      }
    } catch (error) {
      submissionInFlight.current = false;
      submitted.current = false;
      if (
        error instanceof InstrumentClientError &&
        (error.code === "INVALID_REQUEST" ||
          error.code === "INSTRUMENT_NOT_SUPPORTED")
      ) {
        setSubmitState("idle");
        setInstrumentState("error");
        setInstrumentMessage(error.message);
        setErrors({
          symbol: error.message,
          rows: {},
        });
        requestAnimationFrame(() => {
          formRef.current
            ?.querySelector<HTMLElement>("#symbol")
            ?.focus();
        });
        return;
      }
      setSubmitState("error");
      setDraftNotice(
        error instanceof PositionRepositoryError &&
          error.code === "POSITION_SNAPSHOT_CONFLICT"
          ? "另一页面刚更新了该持仓。当前输入仍保留，请核对后重试。"
          : "保存失败，当前输入和正式持仓均未被清空。",
      );
      if (
        error instanceof PositionRepositoryError &&
        error.code === "POSITION_SNAPSHOT_CONFLICT" &&
        submittedInstrument !== null
      ) {
        void repository()
          .getSnapshot(submittedInstrument)
          .then((snapshot) => {
            setExistingSnapshot(snapshot);
            if (snapshot === null) {
              setDraftNotice(
                "该持仓已在另一页面删除；当前输入仍保留，但不能继续保存。",
              );
            }
          })
          .catch(() => undefined);
      }
      return;
    }

    submitted.current = true;
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    if (!preserveEntryDraft) {
      try {
        await repository().clearEntryDraft();
      } catch {
        setDraftNotice(
          "持仓已保存，但未保存草稿未能清除；下次录入时请先核对。",
        );
      }
    }
    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => undefined);
    }
    router.push("/");
  };

  const existingPosition =
    existingSnapshot === null
      ? null
      : aggregatePositionInputs(existingSnapshot.batch.inputs)[0] ?? null;
  const isExistingBatchLoaded =
    existingSnapshot !== null &&
    loadedSnapshotBaseline?.instrumentId ===
      instrumentKeyId(existingSnapshot.batch.instrument) &&
    loadedSnapshotBaseline.revision === existingSnapshot.revision;
  const requiresSnapshotLoad =
    entryMode === "edit" &&
    existingSnapshot !== null &&
    !isExistingBatchLoaded;
  const isSubmitting = submitState === "submitting";

  if (!isHydrated) {
    return (
      <main
        className="app-shell app-shell--centered precision-form"
        aria-busy="true"
        aria-label="正在恢复录入草稿"
      >
        <section className="state-card">
          <p className="eyebrow">本机草稿</p>
          <h1>正在恢复输入</h1>
          <p>请稍候，正式持仓不会在载入时被改写。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell app-shell--form precision-form">
      <header className="form-header">
        <Link
          className="icon-link"
          href="/"
          aria-label="返回总仓位"
          aria-disabled={isSubmitting}
          tabIndex={isSubmitting ? -1 : undefined}
          onClick={(event) => {
            if (isSubmitting) {
              event.preventDefault();
            }
          }}
        >
          返回
        </Link>
        <div>
          <p className="eyebrow">
            {isTargetedMode ? "持仓操作" : "统一录入"}
          </p>
          <h1>
            {entryMode === "add"
              ? "加仓"
              : entryMode === "edit"
                ? "修改持仓"
                : "录入持仓"}
          </h1>
        </div>
        <span className="form-header__spacer" aria-hidden="true" />
      </header>

      {draftNotice ? (
        <p className="inline-notice" role="status">
          {draftNotice}
        </p>
      ) : null}

      <form
        ref={formRef}
        className="entry-form"
        noValidate
        aria-busy={isSubmitting}
        onSubmit={submit}
      >
        <section className="form-section" aria-labelledby="instrument-heading">
          <div className="form-section__heading">
            <span>1</span>
            <div>
              <h2 id="instrument-heading">确认股票</h2>
              <p>
                {isTargetedMode
                  ? "股票已从首页选定；名称、市场和币种不可更改。"
                  : "输入代码后自动匹配名称和上市市场；币种固定为 USD。"}
              </p>
            </div>
          </div>

          <div className="field-grid field-grid--instrument">
            <div className="field field--symbol">
              <label htmlFor="symbol">股票代码</label>
              <input
                id="symbol"
                name="symbol"
                type="text"
                value={symbol}
                placeholder="例如 AAPL"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={15}
                readOnly={isTargetedMode}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.symbol)}
                aria-describedby={errors.symbol ? "symbol-error" : "symbol-help"}
                onChange={(event) => {
                  instrumentRequestSequence.current += 1;
                  verifiedSymbol.current = "";
                  setSymbol(event.target.value.toUpperCase());
                  setName("");
                  setMarket("");
                  setExistingSnapshot(null);
                  setLoadedSnapshotBaseline(null);
                  setInstrumentState("idle");
                  setInstrumentMessage(null);
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.symbol;
                    return next;
                  });
                }}
                onBlur={() => setSymbol((current) => current.trim().toUpperCase())}
              />
              {errors.symbol ? (
                <p className="field-error" id="symbol-error">
                  {errors.symbol}
                </p>
              ) : (
                <p className="field-help" id="symbol-help">
                  {isTargetedMode
                    ? "如需操作其他股票，请返回首页重新选择。"
                    : "支持字母、数字、点和连字符；停止输入后自动识别。"}
                </p>
              )}
            </div>

            <div className="field field--name">
              <label htmlFor="name">股票名称（Alpaca）</label>
              <input
                id="name"
                name="name"
                type="text"
                value={name}
                placeholder="输入代码后自动填写"
                autoComplete="off"
                maxLength={200}
                readOnly
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "name-error" : "name-help"}
              />
              {errors.name ? (
                <p className="field-error" id="name-error">
                  {errors.name}
                </p>
              ) : (
                <p className="field-help" id="name-help">
                  正式保存使用 Alpaca 返回的名称。
                </p>
              )}
            </div>

            <div className="field field--market">
              <label htmlFor="market">上市市场</label>
              <input
                id="market"
                name="market"
                type="text"
                value={market ? listingMarketLabel(market) : ""}
                placeholder="输入代码后自动匹配"
                readOnly
                disabled={isSubmitting}
                aria-describedby="market-help"
              />
              <p className="field-help" id="market-help">
                由 Alpaca 自动匹配，无需选择。
              </p>
            </div>
          </div>
          <div className="instrument-check">
            {instrumentMessage ? (
              <p
                className={
                  instrumentState === "error"
                    ? "field-error"
                    : "field-help"
                }
                role="status"
              >
                {instrumentMessage}
              </p>
            ) : (
              <p className="field-help">
                股票代码输入完成后会自动识别，无需额外确认。
              </p>
            )}
            {instrumentState === "error" ? (
              <button
                className="button button--secondary"
                type="button"
                disabled={isSubmitting}
                onClick={() => void verifyInstrument()}
              >
                重新识别
              </button>
            ) : null}
          </div>
        </section>

        <section className="form-section" aria-labelledby="position-inputs-heading">
          <div className="form-section__heading">
            <span>2</span>
            <div>
              <h2 id="position-inputs-heading">
                {entryMode === "add"
                  ? "填写本次加仓"
                  : entryMode === "edit"
                    ? "修改数量与均价"
                    : "填写数量与成本"}
              </h2>
              <p>
                {entryMode === "add"
                  ? "填写本次增加的数量与买入均价，保存后会与当前持仓合并。"
                  : entryMode === "edit"
                    ? "已回填当前合并数量与合并均价；保存会用新值更新这只股票。"
                    : "同一股票可填写多组；再次录入时会自动叠加数量和成本，再计算合并均价。"}
              </p>
            </div>
          </div>

          <div className="entry-rows">
            {rows.map((row, index) => {
              const rowErrors = errors.rows[row.id] ?? {};
              const quantityErrorId = `${row.id}-quantity-error`;
              const costErrorId = `${row.id}-cost-error`;
              const costLabel =
                entryMode === "add"
                  ? "本次买入均价（USD）"
                  : entryMode === "edit"
                    ? "当前平均成本（USD）"
                    : row.costMode === "average"
                  ? "每股平均成本（USD）"
                  : "剩余总成本（USD）";

              return (
                <fieldset
                  className="entry-row"
                  key={row.id}
                  disabled={isSubmitting}
                >
                  <legend className="sr-only">
                    输入 {index + 1}
                  </legend>
                  {entryMode === "create" ? (
                    <>
                      <div className="entry-row__heading">
                        <span
                          className="entry-row__heading-label"
                          aria-hidden="true"
                        >
                          第 {index + 1} 组
                        </span>
                        {rows.length > 1 ? (
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => removeRow(row.id)}
                            aria-label={`删除输入 ${index + 1}`}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                      <fieldset className="row-mode-fieldset">
                        <legend>成本方式</legend>
                        <div className="segmented-control segmented-control--row">
                          <label>
                            <input
                              type="radio"
                              name={`${row.id}-cost-mode`}
                              value="average"
                              checked={row.costMode === "average"}
                              onChange={() =>
                                updateRowCostMode(row.id, "average")
                              }
                            />
                            <span>每股平均成本</span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`${row.id}-cost-mode`}
                              value="total"
                              checked={row.costMode === "total"}
                              onChange={() =>
                                updateRowCostMode(row.id, "total")
                              }
                            />
                            <span>剩余总成本</span>
                          </label>
                        </div>
                      </fieldset>
                    </>
                  ) : null}
                  <div className="field-grid field-grid--row">
                    <div className="field">
                      <label htmlFor={`${row.id}-quantity`}>
                        {entryMode === "add"
                          ? "本次加仓数量"
                          : entryMode === "edit"
                            ? "当前持有数量"
                            : "持有数量"}
                        <span className="sr-only">
                          （输入 {index + 1}）
                        </span>
                      </label>
                      <input
                        className="numeric"
                        id={`${row.id}-quantity`}
                        name={`${row.id}-quantity`}
                        type="text"
                        inputMode="decimal"
                        value={row.quantity}
                        placeholder="0"
                        autoComplete="off"
                        aria-invalid={Boolean(rowErrors.quantity)}
                        aria-describedby={
                          rowErrors.quantity ? quantityErrorId : undefined
                        }
                        onChange={(event) =>
                          updateRow(row.id, "quantity", event.target.value)
                        }
                      />
                      {rowErrors.quantity ? (
                        <p className="field-error" id={quantityErrorId}>
                          {rowErrors.quantity}
                        </p>
                      ) : null}
                    </div>
                    <div className="field">
                      <label htmlFor={`${row.id}-cost`}>
                        {costLabel}
                        <span className="sr-only">
                          （输入 {index + 1}）
                        </span>
                      </label>
                      <input
                        className="numeric"
                        id={`${row.id}-cost`}
                        name={`${row.id}-cost`}
                        type="text"
                        inputMode="decimal"
                        value={row.cost}
                        placeholder="0.00"
                        autoComplete="off"
                        aria-invalid={Boolean(rowErrors.cost)}
                        aria-describedby={rowErrors.cost ? costErrorId : undefined}
                        onChange={(event) =>
                          updateRow(row.id, "cost", event.target.value)
                        }
                      />
                      {rowErrors.cost ? (
                        <p className="field-error" id={costErrorId}>
                          {rowErrors.cost}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </fieldset>
              );
            })}
          </div>

          {entryMode === "create" ? (
            <button
              id="add-position-row"
              className="button button--secondary button--full"
              type="button"
              disabled={isSubmitting}
              onClick={addRow}
            >
              添加一组数量与成本
            </button>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {rowChangeNotice}
          </p>
        </section>

        <section
          className="preview-card"
          aria-labelledby="preview-heading"
        >
          <div className="preview-card__heading">
            <div>
              <p className="eyebrow">
                {isAdditiveMode && existingPosition
                  ? "保存后合并预览"
                  : "合并预览"}
              </p>
              <h2 id="preview-heading">
                {symbol.trim() ? symbol.trim().toUpperCase() : "当前输入"}
              </h2>
            </div>
            <span>
              {market
                ? `${listingMarketLabel(market)} · USD`
                : "上市市场自动匹配 · USD"}
            </span>
          </div>

          {preview ? (
            <dl className="preview-metrics">
              <div>
                <dt>合并数量</dt>
                <dd className="numeric">{formatQuantity(preview.totalQuantity)} 股</dd>
              </div>
              <div>
                <dt>总剩余成本</dt>
                <dd className="numeric">{formatUsd(preview.totalOpenCost)}</dd>
              </div>
              <div>
                <dt>合并均价</dt>
                <dd className="numeric">{formatUsd(preview.averageCost)}</dd>
              </div>
            </dl>
          ) : (
            <p className="preview-card__empty">填写有效的数量与成本后生成预览。</p>
          )}
          <p
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            {preview
              ? `合并数量 ${formatQuantity(preview.totalQuantity)} 股，合并均价 ${formatUsd(preview.averageCost)}。`
              : ""}
          </p>
        </section>

        {existingPosition ? (
          <div className="replacement-notice" role="status">
            <strong>
              当前持仓共 {existingSnapshot?.batch.inputs.length ?? 0} 组 ·{" "}
              {formatQuantity(existingPosition.quantity)} 股 · 总成本{" "}
              {formatUsd(existingPosition.openCost)} · 合并均价{" "}
              {formatUsd(existingPosition.averageCost)}
            </strong>
            {isAdditiveMode ? (
              <>
                <p>
                  {incomingPreview
                    ? `${
                        entryMode === "add" ? "本次加仓" : "本次"
                      } ${formatQuantity(incomingPreview.totalQuantity)} 股、成本 ${formatUsd(incomingPreview.totalOpenCost)} 会叠加到当前持仓。`
                    : `${
                        entryMode === "add"
                          ? "填写本次加仓数量与买入均价后"
                          : "填写本次数量与成本后"
                      }，会叠加到当前持仓。`}
                  上方预览按当前持仓与本次输入合计；保存后首页仍只显示一条{" "}
                  {existingPosition.instrument.symbol}。
                </p>
                {entryMode === "create" ? (
                  <Link
                    className="button button--secondary button--full replacement-notice__action"
                    href={`/positions/new?instrument=${encodeURIComponent(
                      instrumentKeyId(existingPosition.instrument),
                    )}&mode=edit`}
                    aria-disabled={isSubmitting}
                    tabIndex={isSubmitting ? -1 : undefined}
                    onClick={(event) => {
                      if (isSubmitting) {
                        event.preventDefault();
                      }
                    }}
                  >
                    改为修改当前数量与均价
                  </Link>
                ) : null}
              </>
            ) : isExistingBatchLoaded ? (
              <p>
                当前合并数量与合并均价已回填。保存会用表单中的数量和均价更新{" "}
                {existingPosition.instrument.symbol}，其他股票不受影响。
              </p>
            ) : (
              <>
                <p>
                  这只股票刚在另一页面更新。请先载入最新数量与均价再修改。
                </p>
                <button
                  className="button button--secondary button--full replacement-notice__action"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    if (existingSnapshot !== null) {
                      applySnapshot(existingSnapshot);
                    }
                  }}
                >
                  载入最新持仓
                </button>
              </>
            )}
          </div>
        ) : null}

        {submitState === "error" ? (
          <div className="form-alert" role="alert" tabIndex={-1}>
            <strong>暂时无法保存</strong>
            <p>输入内容已保留，请稍后重试。</p>
          </div>
        ) : null}

        <div className="form-actions">
          <Link
            className="button button--quiet button--full"
            href="/"
            aria-disabled={isSubmitting}
            tabIndex={isSubmitting ? -1 : undefined}
            onClick={(event) => {
              if (isSubmitting) {
                event.preventDefault();
              }
            }}
          >
            返回首页
          </Link>
          <button
            className="button button--primary button--full"
            type="submit"
            disabled={
              isSubmitting ||
              requiresSnapshotLoad ||
              targetUnavailable
            }
            aria-busy={isSubmitting}
          >
            {targetUnavailable
              ? "持仓已不存在"
              : requiresSnapshotLoad
              ? "先载入当前持仓"
              : submitState === "submitting"
                ? "保存中…"
                : entryMode === "add"
                  ? "确认加仓"
                  : entryMode === "edit"
                    ? "保存修改"
                    : isAdditiveMode && existingPosition
                      ? "叠加并保存"
                      : "保存持仓"}
          </button>
        </div>
      </form>
    </main>
  );
}
