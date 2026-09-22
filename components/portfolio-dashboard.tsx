"use client";

import { portfolioTarget, productionExperience } from "../application/runtime/build-target.ts";

import Link from "next/link";
import {
  IoChevronForward,
  IoCopyOutline,
  IoDocumentTextOutline,
  IoLogOutOutline,
  IoRemoveOutline,
  IoRefreshOutline,
  IoShieldCheckmarkOutline,
} from "react-icons/io5";
import { BsOpenai } from "react-icons/bs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import type { UsdCnyRate } from "../application/fx/types.ts";
import type { PortfolioTrendResult } from "../domain/index.ts";
import type {
  PortfolioFixture,
  PortfolioPosition,
} from "../ui/portfolio-fixtures";
import type {
  PortfolioCopyOutcome,
  PortfolioCopyScope,
  PortfolioCopySource,
  PortfolioCopyTarget,
} from "../ui/portfolio-copy-text.ts";
import type { PortfolioInsights } from "../ui/portfolio-insights.ts";
import { containModalFocus } from "./modal-accessibility.ts";
import { PortfolioAiChatDialog } from "./portfolio-ai-chat-dialog.tsx";
import { PortfolioAiResearchDialog } from "./portfolio-ai-research-dialog.tsx";
import { PortfolioInsightsSheet } from "./portfolio-insights-sheet.tsx";
import { PortfolioTrendChart } from "./portfolio-trend-chart.tsx";

type PortfolioDashboardProps = {
  initialPortfolio: PortfolioFixture;
  insights?: PortfolioInsights | null;
  portfolioSource?: PortfolioCopySource | null;
  cnyPortfolio?: PortfolioFixture | null;
  usdCnyRate?: UsdCnyRate | null;
  isFxRateCached?: boolean;
  isFxRefreshing?: boolean;
  isFxRateUnavailable?: boolean;
  trend?: PortfolioTrendResult | null;
  isTrendLoading?: boolean;
  isExporting: boolean;
  isRefreshing: boolean;
  brokerPortfolioActive?: boolean;
  notice: string | null;
  onCopyPositions: (
    scope: PortfolioCopyScope,
    target: PortfolioCopyTarget,
  ) => Promise<PortfolioCopyOutcome>;
  onExportBackup: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onDelete: (instrumentKey: string) => Promise<boolean>;
};

const LONG_PRESS_DURATION_MS = 550;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const HOLDINGS_KEYBOARD_SCROLL_STEP_PX = 96;
const COPY_TOAST_DURATION_MS = 2_400;
type CopySheetView = "scope" | "single" | "manual" | null;
type DisplayCurrency = "USD" | "CNY";
type CopyToast = {
  readonly id: number;
  readonly message: string;
};

type TrendDirection = "positive" | "negative" | "neutral";

function displayMetric(value: string | null | undefined): string {
  return value === undefined || value === null || value === "—"
    ? "暂无"
    : value;
}

function navigateHoldingsTable(
  event: KeyboardEvent<HTMLDivElement>,
) {
  if (event.target !== event.currentTarget) {
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    event.currentTarget.scrollLeft -= HOLDINGS_KEYBOARD_SCROLL_STEP_PX;
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    event.currentTarget.scrollLeft += HOLDINGS_KEYBOARD_SCROLL_STEP_PX;
  } else if (event.key === "Home") {
    event.preventDefault();
    event.currentTarget.scrollLeft = 0;
  } else if (event.key === "End") {
    event.preventDefault();
    event.currentTarget.scrollLeft = event.currentTarget.scrollWidth;
  }
}

function formatFxSourceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFxSourceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function fxSourceDisclosure(
  rate: UsdCnyRate,
  isCached: boolean,
): string {
  if (rate.provider === "ecb") {
    return `欧洲央行日参考汇率 · ${
      isCached ? "上次有效参考汇率 · " : ""
    }参考日 ${formatFxSourceDate(
      `${rate.referenceDate}T00:00:00Z`,
    )} · 官方更新时间 ${formatFxSourceTime(rate.sourceEventAt)}`;
  }
  return `Alpaca 中间价 · ${
    isCached ? "上次有效汇率 " : "汇率时间 "
  }${formatFxSourceTime(rate.sourceEventAt)}`;
}

function positionReturnTone(position: PortfolioPosition): string {
  if (position.pnlDirection === "negative") {
    return "numeric position-cell__secondary position-cell__secondary--negative";
  }

  if (position.pnlDirection === "positive") {
    return "numeric position-cell__secondary position-cell__secondary--positive";
  }

  return "numeric position-cell__secondary";
}

function positionPnlTone(position: PortfolioPosition): string {
  if (position.pnlDirection === "negative") {
    return "numeric position-cell__primary position-cell__primary--negative";
  }

  if (position.pnlDirection === "positive") {
    return "numeric position-cell__primary position-cell__primary--positive";
  }

  return "numeric position-cell__primary";
}

function positionDailyRateTone(position: PortfolioPosition): string {
  if (position.dailyChangeDirection === "negative") {
    return "numeric position-cell__primary position-cell__primary--negative";
  }

  if (position.dailyChangeDirection === "positive") {
    return "numeric position-cell__primary position-cell__primary--positive";
  }

  return "numeric position-cell__primary";
}

function positionDailyChangeTone(position: PortfolioPosition): string {
  if (position.dailyChangeDirection === "negative") {
    return "numeric position-cell__secondary position-cell__secondary--negative";
  }

  if (position.dailyChangeDirection === "positive") {
    return "numeric position-cell__secondary position-cell__secondary--positive";
  }

  return "numeric position-cell__secondary";
}

const POSITION_NAME_SUFFIXES = [
  /\s+(?:Class\s+[A-Z0-9.-]+\s+)?(?:Common|Capital)\s+Stock$/i,
  /\s+Class\s+[A-Z0-9.-]+$/i,
  /\s+(?:American\s+Depositary\s+(?:Shares?|Receipts?)|Depositary\s+Shares?)$/i,
  /\s+(?:ETF|ETN)$/i,
  /,?\s+(?:Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|PLC|L\.P\.|LP|LLC)$/i,
  /\.com$/i,
] as const;

export function compactPositionDisplayName(
  name: string,
  symbol: string,
): string {
  const original = name.trim().replace(/\s+/g, " ");
  let compact = original;

  for (let pass = 0; pass < 4; pass += 1) {
    const previous = compact;
    for (const suffix of POSITION_NAME_SUFFIXES) {
      compact = compact.replace(suffix, "").replace(/[,\s]+$/, "").trim();
    }
    if (compact === previous) {
      break;
    }
  }

  compact = compact.replace(/^The\s+/i, "").trim();
  return compact || original || symbol;
}

function positionActionHref(
  instrumentKey: string,
  mode: "edit" | "add",
): string {
  return `/positions/new?instrument=${encodeURIComponent(
    instrumentKey,
  )}&mode=${mode}`;
}

function tradeHref(
  instrumentKey: string,
  side: "BUY" | "SELL",
): string {
  return `/trades/new?side=${side}&instrument=${encodeURIComponent(
    instrumentKey,
  )}`;
}

function BottomEntryAction({
  brokerPortfolioActive = false,
}: {
  brokerPortfolioActive?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const currentSheet = sheet.current;
    if (currentSheet === null) {
      return;
    }
    const releaseFocusContainment = containModalFocus(currentSheet);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      releaseFocusContainment();
    };
  }, [close, isOpen]);

  return (
    <>
      <aside className="bottom-action" aria-label="主要操作">
        <div className="bottom-action__inner">
          <button
            className="button button--primary bottom-action__button"
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            onClick={() => setIsOpen(true)}
          >
            录入资产
          </button>
        </div>
      </aside>
      {isOpen ? (
        <div
          className="action-sheet-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <section
            className="action-sheet entry-sheet"
            ref={sheet}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="entry-sheet-title"
          >
            <div className="action-sheet__heading">
              <p>选择要加入统一组合的资产</p>
              <h2 id="entry-sheet-title">录入资产</h2>
            </div>
            <div className="action-sheet__actions">
              <Link
                className="action-sheet__button"
                data-autofocus
                href={brokerPortfolioActive ? "/trades/new?side=BUY" : "/positions/new"}
              >
                <strong>{brokerPortfolioActive ? "买入股票" : "录入股票"}</strong>
                <span>
                  {brokerPortfolioActive
                    ? "选择持仓券商；买入款统一从组合现金扣减"
                    : "新增标的，或向已有标的叠加数量与成本"}
                </span>
              </Link>
              <Link
                className="action-sheet__button"
                href={brokerPortfolioActive ? "/portfolio-setup" : "/cash"}
              >
                <strong>
                  {brokerPortfolioActive ? "校准双券商资产" : "录入 IBKR 现金"}
                </strong>
                <span>
                  {brokerPortfolioActive
                    ? "更新来源持仓与组合现金基线"
                    : "记录 USD 现金并估算未入账利息"}
                </span>
              </Link>
              {!brokerPortfolioActive ? (
                <Link className="action-sheet__button" href="/portfolio-setup">
                  <strong>启用双券商账本</strong>
                  <span>把当前持仓校准为 IBKR 与 moomoo 两个来源</span>
                </Link>
              ) : null}
            </div>
            <button
              className="action-sheet__cancel"
              type="button"
              onClick={close}
            >
              取消
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

function EmptyPortfolio() {
  return (
    <main className="app-shell app-shell--empty app-shell--portfolio portfolio-terminal portfolio-account">
      <header className="portfolio-header">
        <h1>总仓位</h1>
      </header>

      <section className="empty-account" aria-labelledby="empty-title">
        <div className="empty-account__body">
          <p className="empty-account__eyebrow">你的统一资产视图</p>
          <h2 id="empty-title">还没有资产</h2>
          <p>{portfolioTarget() === "sites" ? "录入资产后，这份账号组合会在使用同一 ChatGPT 账号登录的设备间同步。" : "这里显示当前浏览器、当前来源的本地持仓。它们不会自动同步到其他设备；迁往 Sites 前请先导出 JSON 副本。"}</p>
          <div className="empty-account__actions">
            <Link
              className="button button--secondary"
              href="/data-safety"
            >
              从副本恢复
            </Link>
          </div>
        </div>
        <p className="empty-account__meta">
          {portfolioTarget() === "sites" ? "账号云端保存" : "当前浏览器本地保存"} · USD 真值 · 延迟行情估值
        </p>
      </section>
      <BottomEntryAction />
    </main>
  );
}

function PortfolioLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="app-shell app-shell--centered app-shell--portfolio portfolio-terminal portfolio-account">
      <section className="state-card account-error" aria-labelledby="portfolio-error-title">
        <p className="eyebrow">统一组合</p>
        <h1 id="portfolio-error-title">无法读取持仓</h1>
        <p>{message}</p>
        <button
          className="button button--primary button--full"
          type="button"
          onClick={onRetry}
        >
          重试
        </button>
      </section>
    </main>
  );
}

export function PortfolioLoading() {
  return (
    <main
      className="app-shell app-shell--portfolio portfolio-terminal portfolio-account"
      aria-busy="true"
      aria-label="正在载入总仓位"
    >
      <header className="portfolio-header portfolio-header--skeleton">
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--header-action" />
      </header>
      <section className="account-summary account-summary--skeleton">
        <div className="skeleton skeleton--label" />
        <div className="skeleton skeleton--hero" />
        <div className="skeleton skeleton--trend" />
        <div className="account-summary__metrics">
          <div className="skeleton skeleton--metric" />
          <div className="skeleton skeleton--metric" />
          <div className="skeleton skeleton--metric" />
          <div className="skeleton skeleton--metric" />
        </div>
      </section>
      <section className="positions-section">
        <div className="skeleton skeleton--section-title" />
        <div className="position-table">
          <div className="skeleton skeleton--row" />
          <div className="skeleton skeleton--row" />
          <div className="skeleton skeleton--row" />
        </div>
      </section>
      <span className="sr-only">正在载入，请稍候。</span>
    </main>
  );
}

export function PortfolioDashboard({
  initialPortfolio,
  insights = null,
  portfolioSource = null,
  cnyPortfolio = null,
  usdCnyRate = null,
  isFxRateCached = false,
  isFxRefreshing = false,
  isFxRateUnavailable = false,
  trend = null,
  isTrendLoading = false,
  isExporting,
  isRefreshing,
  brokerPortfolioActive = false,
  notice,
  onCopyPositions,
  onExportBackup,
  onRefresh,
  onRetry,
  onDelete,
}: PortfolioDashboardProps) {
  const [displayCurrency, setDisplayCurrency] =
    useState<DisplayCurrency>("USD");
  const [activePosition, setActivePosition] =
    useState<PortfolioPosition | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [copyView, setCopyView] = useState<CopySheetView>(null);
  const [copyTarget, setCopyTarget] =
    useState<PortfolioCopyTarget>("chatgpt");
  const [manualCopyText, setManualCopyText] = useState("");
  const [copyError, setCopyError] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [copyToast, setCopyToast] = useState<CopyToast | null>(null);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [insightsSheetOpen, setInsightsSheetOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiResearchOpen, setAiResearchOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClick = useRef(false);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const actionSheet = useRef<HTMLElement | null>(null);
  const copyTrigger = useRef<HTMLElement | null>(null);
  const copySheet = useRef<HTMLElement | null>(null);
  const manualCopyArea = useRef<HTMLTextAreaElement | null>(null);
  const copyToastSequence = useRef(0);
  const moreTrigger = useRef<HTMLButtonElement | null>(null);
  const moreSheet = useRef<HTMLElement | null>(null);
  const insightsTrigger = useRef<HTMLButtonElement | null>(null);
  const aiChatTrigger = useRef<HTMLButtonElement | null>(null);
  const aiResearchTrigger = useRef<HTMLButtonElement | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pressOrigin.current = null;
    setPressedKey(null);
  }, []);

  const openActions = useCallback(
    (position: PortfolioPosition, trigger: HTMLElement) => {
      clearLongPress();
      actionTrigger.current = trigger;
      setConfirmingDelete(false);
      setDeleteError(null);
      setCopyError(null);
      setActivePosition(position);
    },
    [clearLongPress],
  );

  const closeActions = useCallback(() => {
    if (deletingKey !== null || isCopying) {
      return;
    }
    setActivePosition(null);
    setConfirmingDelete(false);
    setDeleteError(null);
    requestAnimationFrame(() => {
      const trigger = actionTrigger.current;
      if (trigger?.isConnected) {
        trigger.focus();
      } else {
        moreTrigger.current?.focus();
      }
    });
  }, [deletingKey, isCopying]);

  const closeCopy = useCallback(() => {
    if (isCopying) {
      return;
    }
    setCopyView(null);
    setManualCopyText("");
    setCopyError(null);
    requestAnimationFrame(() => copyTrigger.current?.focus());
  }, [isCopying]);

  const openCopy = useCallback(
    (trigger: HTMLElement, target: PortfolioCopyTarget) => {
      copyTrigger.current = trigger;
      setCopyTarget(target);
      setManualCopyText("");
      setCopyError(null);
      setCopyView("scope");
    },
    [],
  );

  const closeMore = useCallback(() => {
    setMoreSheetOpen(false);
    requestAnimationFrame(() => moreTrigger.current?.focus());
  }, []);

  const closeInsights = useCallback(() => {
    setInsightsSheetOpen(false);
    requestAnimationFrame(() => {
      const trigger = insightsTrigger.current;
      if (trigger?.isConnected) {
        trigger.focus();
      } else {
        moreTrigger.current?.focus();
      }
    });
  }, []);

  const closeAiChat = useCallback(() => {
    setAiChatOpen(false);
    requestAnimationFrame(() => {
      const trigger = aiChatTrigger.current;
      if (trigger?.isConnected) {
        trigger.focus();
      } else {
        moreTrigger.current?.focus();
      }
    });
  }, []);

  const closeAiResearch = useCallback(() => {
    setAiResearchOpen(false);
    requestAnimationFrame(() => {
      const trigger = aiResearchTrigger.current;
      if (trigger?.isConnected) {
        trigger.focus();
      } else {
        moreTrigger.current?.focus();
      }
    });
  }, []);

  useEffect(() => {
    if (insights === null) {
      if (insightsSheetOpen) {
        closeInsights();
      }
      if (aiChatOpen) {
        closeAiChat();
      }
      if (aiResearchOpen) {
        closeAiResearch();
      }
    }
  }, [
    aiChatOpen,
    aiResearchOpen,
    closeAiChat,
    closeAiResearch,
    closeInsights,
    insights,
    insightsSheetOpen,
  ]);

  useEffect(() => {
    return clearLongPress;
  }, [clearLongPress]);

  useEffect(() => {
    if (activePosition === null || actionSheet.current === null) {
      return;
    }
    return containModalFocus(actionSheet.current);
  }, [activePosition, confirmingDelete]);

  useEffect(() => {
    if (copyView === null || copySheet.current === null) {
      return;
    }
    return containModalFocus(copySheet.current);
  }, [copyView]);

  useEffect(() => {
    if (!moreSheetOpen || moreSheet.current === null) {
      return;
    }
    return containModalFocus(moreSheet.current);
  }, [moreSheetOpen]);

  useEffect(() => {
    if (
      activePosition === null &&
      copyView === null &&
      !moreSheetOpen
    ) {
      return;
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (copyView !== null) {
          closeCopy();
        } else if (activePosition !== null) {
          closeActions();
        } else {
          closeMore();
        }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [
    activePosition,
    closeActions,
    closeCopy,
    closeMore,
    copyView,
    moreSheetOpen,
  ]);

  useEffect(() => {
    if (
      displayCurrency === "CNY" &&
      cnyPortfolio?.viewState !== "ready"
    ) {
      setDisplayCurrency("USD");
    }
  }, [cnyPortfolio, displayCurrency]);

  useEffect(() => {
    if (copyToast === null) {
      return;
    }

    let dismissTimer: number | null = null;
    const syncDismissalWithVisibility = () => {
      if (dismissTimer !== null) {
        window.clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      if (document.visibilityState !== "visible") {
        return;
      }
      dismissTimer = window.setTimeout(() => {
        setCopyToast((current) =>
          current?.id === copyToast.id ? null : current,
        );
      }, COPY_TOAST_DURATION_MS);
    };

    syncDismissalWithVisibility();
    document.addEventListener(
      "visibilitychange",
      syncDismissalWithVisibility,
    );
    return () => {
      if (dismissTimer !== null) {
        window.clearTimeout(dismissTimer);
      }
      document.removeEventListener(
        "visibilitychange",
        syncDismissalWithVisibility,
      );
    };
  }, [copyToast]);

  const startLongPress = (
    position: PortfolioPosition,
    event: PointerEvent<HTMLElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    clearLongPress();
    suppressNextClick.current = false;
    const trigger = event.currentTarget;
    actionTrigger.current = trigger;
    pressOrigin.current = {
      x: event.clientX,
      y: event.clientY,
    };
    setPressedKey(position.instrumentKey);
    longPressTimer.current = window.setTimeout(() => {
      suppressNextClick.current = true;
      openActions(position, trigger);
    }, LONG_PRESS_DURATION_MS);
  };

  const moveLongPress = (event: PointerEvent<HTMLElement>) => {
    const origin = pressOrigin.current;
    if (
      origin !== null &&
      Math.hypot(
        event.clientX - origin.x,
        event.clientY - origin.y,
      ) > LONG_PRESS_MOVE_THRESHOLD_PX
    ) {
      suppressNextClick.current = true;
      clearLongPress();
    }
  };

  const openActionsFromClick = (
    position: PortfolioPosition,
    event: MouseEvent<HTMLElement>,
  ) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    openActions(position, event.currentTarget);
  };

  const openActionsFromKeyboard = (
    position: PortfolioPosition,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openActions(position, event.currentTarget);
  };

  if (initialPortfolio.viewState === "loading") {
    return <PortfolioLoading />;
  }

  if (initialPortfolio.viewState === "empty") {
    return <EmptyPortfolio />;
  }

  if (initialPortfolio.viewState === "load-error") {
    return (
      <PortfolioLoadError
        message={initialPortfolio.message}
        onRetry={onRetry}
      />
    );
  }

  const readyCnyPortfolio =
    cnyPortfolio?.viewState === "ready" ? cnyPortfolio : null;
  const canDisplayCny =
    readyCnyPortfolio !== null && usdCnyRate !== null;
  const visiblePortfolio =
    displayCurrency === "CNY" && readyCnyPortfolio !== null
      ? readyCnyPortfolio
      : initialPortfolio;
  const headlineChange = visiblePortfolio.dailyChange;
  const headlineRate = visiblePortfolio.dailyChangeRate;
  const displayedHeadlineChange = displayMetric(headlineChange);
  const displayedHeadlineRate = displayMetric(headlineRate);
  const headlineDirection: TrendDirection =
    visiblePortfolio.dailyChangeDirection;

  const performCopy = async (
    scope: PortfolioCopyScope,
    target: PortfolioCopyTarget = copyTarget,
  ) => {
    if (isCopying) {
      return;
    }
    setIsCopying(true);
    setCopyToast(null);
    setCopyError(null);
    try {
      const result = await onCopyPositions(scope, target);
      setActivePosition(null);
      setConfirmingDelete(false);
      if (result.delivery === "manual-fallback") {
        setManualCopyText(result.text);
        setCopyView("manual");
        return;
      }
      copyToastSequence.current += 1;
      setCopyToast({
        id: copyToastSequence.current,
        message:
          target === "chatgpt"
            ? "已复制并打开 ChatGPT"
            : "已复制，可粘贴到其他应用",
      });
      setCopyView(null);
      setManualCopyText("");
      requestAnimationFrame(() => copyTrigger.current?.focus());
    } catch {
      setCopyError("未能生成持仓资料，请重试。当前持仓没有被修改。");
    } finally {
      setIsCopying(false);
    }
  };

  const confirmDelete = async () => {
    if (activePosition === null || deletingKey !== null) {
      return;
    }
    setDeletingKey(activePosition.instrumentKey);
    setDeleteError(null);
    try {
      const deleted = await onDelete(activePosition.instrumentKey);
      if (deleted) {
        setActivePosition(null);
        setConfirmingDelete(false);
        requestAnimationFrame(() => {
          const trigger = actionTrigger.current;
          if (trigger?.isConnected) {
            trigger.focus();
          } else {
            moreTrigger.current?.focus();
          }
        });
      } else {
        setDeleteError(
          "删除失败，持仓可能已在另一页面更新。请返回首页刷新后重试。",
        );
      }
    } catch {
      setDeleteError(
        "删除失败，持仓没有被清空。请返回首页刷新后重试。",
      );
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <main
      className="app-shell app-shell--portfolio portfolio-terminal portfolio-account"
      data-display-currency={displayCurrency}
    >
      {copyToast !== null ? (
        <div
          className="portfolio-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="portfolio-toast__mark" aria-hidden="true">
            ✓
          </span>
          <span>{copyToast.message}</span>
        </div>
      ) : null}
      <header className="portfolio-header">
        <div className="portfolio-header__title">
          <h1>总仓位</h1>
          {!productionExperience() ? <p>资产事实与判断边界</p> : null}
        </div>
        <div className="portfolio-header__controls">
          <div
            className="currency-mode-switch"
            role="group"
            aria-label="显示币种"
          >
            <button
              type="button"
              aria-pressed={displayCurrency === "USD"}
              onClick={() => setDisplayCurrency("USD")}
            >
              USD
            </button>
            <button
              type="button"
              aria-pressed={displayCurrency === "CNY"}
              aria-busy={isFxRefreshing && !canDisplayCny}
              aria-describedby={
                !canDisplayCny ? "fx-rate-availability" : undefined
              }
              disabled={!canDisplayCny}
              onClick={() => setDisplayCurrency("CNY")}
            >
              人民币
            </button>
          </div>
          <button
            className="portfolio-more-button"
            ref={moreTrigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreSheetOpen}
            aria-label="更多操作"
            onClick={() => setMoreSheetOpen(true)}
          >
            更多
          </button>
        </div>
      </header>

      {isFxRateUnavailable && !canDisplayCny ? (
        <p className="fx-rate-status" role="status">
          人民币估算汇率暂时不可用，当前继续显示 USD。
        </p>
      ) : null}

      <div className="portfolio-workspace">
      <div className="portfolio-overview-column">
      <section
        className="account-summary"
        id="asset-overview"
        aria-labelledby="portfolio-value-label"
      >
        <div className="account-summary__primary">
          <div className="account-summary__label-row">
            <p className="account-summary__label" id="portfolio-value-label">
              {visiblePortfolio.summaryLabel}
            </p>
            <span>{displayCurrency}</span>
          </div>
          <p className="account-summary__value numeric">
            {displayMetric(visiblePortfolio.marketValue)}
          </p>
          <p
            className={`account-summary__headline-change account-summary__pnl account-summary__pnl--${headlineDirection}`}
            aria-label={`今日收益 ${displayedHeadlineChange}，收益率 ${displayedHeadlineRate}`}
          >
            <strong className="numeric">{displayedHeadlineChange}</strong>
            <span className="numeric">{displayedHeadlineRate}</span>
            <small>今日</small>
          </p>
        </div>
        <PortfolioTrendChart
          trend={trend}
          isLoading={isTrendLoading}
          displayCurrency={displayCurrency}
          usdCnyRate={usdCnyRate?.rate ?? null}
          direction={headlineDirection}
          hasStocks={visiblePortfolio.positions.length > 0}
        />
        <dl className="account-summary__metrics">
          <div className="account-summary__metric account-summary__metric--daily">
            <dt>今日盈亏</dt>
            <dd
              className={`account-summary__metric-value account-summary__daily-pnl account-summary__pnl account-summary__pnl--${visiblePortfolio.dailyChangeDirection}`}
              aria-label={`今日盈亏估算 ${displayMetric(visiblePortfolio.dailyChange)}，今日涨跌幅 ${displayMetric(visiblePortfolio.dailyChangeRate)}`}
            >
              <strong className="numeric">
                {displayMetric(visiblePortfolio.dailyChange)}
              </strong>
              <span className="numeric">
                {visiblePortfolio.positions.length === 0
                  ? "现金不参与计算"
                  : `${displayMetric(visiblePortfolio.dailyChangeRate)} · 估算`}
              </span>
            </dd>
          </div>
          <div className="account-summary__metric account-summary__metric--pnl">
            <dt>
              {visiblePortfolio.pnlLabel.includes("已定价部分")
                ? visiblePortfolio.pnlLabel
                : displayCurrency === "CNY"
                  ? "折算累计盈亏"
                  : "累计盈亏"}
            </dt>
            <dd
              className={`account-summary__metric-value account-summary__pnl account-summary__pnl--${visiblePortfolio.pnlDirection}`}
            >
              <strong className="numeric">{displayMetric(visiblePortfolio.pnl)}</strong>
              <span className="numeric">
                {displayMetric(visiblePortfolio.returnRate)}
              </span>
            </dd>
          </div>
          <div className="account-summary__metric account-summary__metric--cost">
            <dt>
              {displayCurrency === "CNY" ? "折算股票成本" : "股票成本"}
            </dt>
            <dd className="account-summary__metric-value">
              <strong className="numeric">
                {displayMetric(visiblePortfolio.stockOpenCost)}
              </strong>
              <span>剩余成本</span>
            </dd>
          </div>
          <div className="account-summary__metric account-summary__metric--cash">
            <dt>{displayCurrency === "CNY" ? "折算现金" : "现金"}</dt>
            <dd className="account-summary__metric-value">
              <strong className="numeric">
                {displayMetric(visiblePortfolio.cash?.balance)}
              </strong>
              <span>
                {visiblePortfolio.cash === null
                  ? "尚未录入"
                  : brokerPortfolioActive
                    ? "IBKR + moomoo · 账面"
                    : `${visiblePortfolio.cash.pricingPlan} · 本金`}
              </span>
            </dd>
          </div>
        </dl>
        <p className="portfolio-status-strip">
          {visiblePortfolio.status.source}
        </p>
      </section>

      {notice ? (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      ) : null}

      {insights !== null ? (
        <section className="portfolio-ai-entry" aria-label="组合工具">
          {!productionExperience() ? <p className="portfolio-ai-entry__context">先理解今日组合变化：查看贡献、集中度与缺失数据，再决定是否需要进一步提问。</p> : null}
          <button
            className="portfolio-ai-entry__button portfolio-ai-entry__button--primary"
            ref={insightsTrigger}
            type="button"
            onClick={() => setInsightsSheetOpen(true)}
          >
            组合分析
          </button>
          <button
            className="portfolio-ai-entry__button portfolio-ai-entry__button--chat"
            ref={aiChatTrigger}
            type="button"
            onClick={() => setAiChatOpen(true)}
          >
            {productionExperience() ? "AI 对话" : "巴菲特框架顾问"}
          </button>
          {!productionExperience() ? <button
            className="portfolio-ai-entry__button portfolio-ai-entry__button--research"
            ref={aiResearchTrigger}
            type="button"
            onClick={() => setAiResearchOpen(true)}
          >
            巴菲特研究系统 · AAPL / MSFT
          </button> : null}
        </section>
      ) : null}
      {!productionExperience() ? <BottomEntryAction brokerPortfolioActive={brokerPortfolioActive} /> : null}
      </div>

      <div className="portfolio-ledger-column">
      <section className="positions-section" aria-labelledby="positions-heading">
        <div className="section-heading">
          <div className="section-heading__title">
            <h2 id="positions-heading">持仓与现金</h2>
            <span className="section-heading__count numeric">
              {brokerPortfolioActive
                ? `(${visiblePortfolio.positions.length} 只股票 + 组合现金)`
                : `(${visiblePortfolio.positions.length} 只股票 + 现金)`}
            </span>
          </div>
          <span className="section-heading__metric">
            {visiblePortfolio.positions.length > 0
              ? "左右滑动 · 点按股票操作"
              : "左右滑动 · 现金点按"}
          </span>
        </div>

        <div className="position-table">
          <p className="position-table__visual-hint" aria-hidden="true">
            左右滑动查看收益与今日
          </p>
          <div
            className="position-table__scroller"
            role="region"
            tabIndex={0}
            aria-label="持仓明细，可左右滑动查看更多"
            aria-describedby="position-scroll-hint"
            onKeyDown={navigateHoldingsTable}
          >
            <div className="position-table__header" aria-hidden="true">
              <span>名称/代码</span>
              <span>市值/数量</span>
              <span>估值价/均价</span>
              <span>盈亏/收益率</span>
              <span>今日涨幅</span>
            </div>
            <div className="position-list">
            {visiblePortfolio.positions.map((position, index) => (
              <article
                className={`position-row${
                  pressedKey === position.instrumentKey
                    ? " position-row--pressed"
                    : ""
                }`}
                key={position.instrumentKey}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={
                  activePosition?.instrumentKey ===
                  position.instrumentKey
                }
                aria-describedby={`position-actions-hint position-metric-description-${index}`}
                aria-label={`${position.symbol} ${position.name} 持仓，点按或长按打开操作`}
                onPointerDown={(event) =>
                  startLongPress(position, event)
                }
                onPointerMove={moveLongPress}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerLeave={clearLongPress}
                onClick={(event) =>
                  openActionsFromClick(position, event)
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  openActions(position, event.currentTarget);
                }}
                onKeyDown={(event) =>
                  openActionsFromKeyboard(position, event)
                }
              >
                <span
                  className="sr-only"
                  id={`position-metric-description-${index}`}
                >
                  累计持仓盈亏 {position.pnl}，持仓收益率 {position.returnRate}；
                  今日涨幅 {position.dailyChangeRate}，今日盈亏 {position.dailyChange}，
                  按当前股数相对最近常规收盘价估算
                </span>
                <div className="position-cell position-cell--identity">
                  <strong>
                    {compactPositionDisplayName(position.name, position.symbol)}
                  </strong>
                  <span>
                    {position.symbol}
                    {position.valuationPrice === "—" ? " · 暂无价格" : ""}
                  </span>
                </div>
                <div
                  className="position-cell position-cell--numeric"
                  data-label="市值 / 数量"
                >
                  <strong className="numeric position-cell__primary">
                    {displayMetric(position.marketValue)}
                  </strong>
                  <span className="numeric position-cell__secondary">
                    {position.quantity} 股
                  </span>
                </div>
                <div
                  className="position-cell position-cell--numeric"
                  data-label="估值价 / 均价"
                >
                  <strong className="numeric position-cell__primary">
                    {displayMetric(position.valuationPrice)}
                  </strong>
                  <span className="numeric position-cell__secondary">
                    {displayMetric(position.averageCost)}
                  </span>
                </div>
                <div
                  className="position-cell position-cell--numeric position-cell--pnl"
                  data-label="盈亏 / 收益率"
                >
                  <strong className={positionPnlTone(position)}>
                    {displayMetric(position.pnl)}
                  </strong>
                  <span className={positionReturnTone(position)}>
                    {displayMetric(position.returnRate)}
                  </span>
                </div>
                <div
                  className="position-cell position-cell--numeric position-cell--daily"
                  data-label="今日涨幅"
                >
                  <strong className={positionDailyRateTone(position)}>
                    {displayMetric(position.dailyChangeRate)}
                  </strong>
                  <span className={positionDailyChangeTone(position)}>
                    {position.dailyChange === "—" ? "暂无" : position.dailyChange}
                  </span>
                </div>
              </article>
            ))}
            {visiblePortfolio.cash === null ? (
              <Link
                className="position-row cash-row cash-row--empty"
                href="/cash"
                aria-label="录入 IBKR USD 现金"
              >
                <div className="position-cell position-cell--identity">
                  <strong>IBKR 现金</strong>
                  <span>USD CASH · 账号记录</span>
                </div>
                <div
                  className="position-cell position-cell--numeric cash-cell"
                  data-label="现金余额"
                >
                  <span className="cash-cell__label">现金余额</span>
                  <strong className="numeric position-cell__primary">暂无</strong>
                  <span className="position-cell__secondary">点按录入</span>
                </div>
                <div
                  className="position-cell position-cell--numeric cash-cell"
                  data-label="计息方案"
                >
                  <span className="cash-cell__label">计息方案</span>
                  <strong className="position-cell__primary">录入后选择</strong>
                  <span className="position-cell__secondary">Pro / Lite</span>
                </div>
                <div
                  className="position-cell position-cell--numeric position-cell--pnl cash-cell"
                  data-label="估算利息"
                >
                  <span className="cash-cell__label">估算利息</span>
                  <strong className="position-cell__primary cash-row__action">暂无</strong>
                  <span className="position-cell__secondary">录入后计算</span>
                </div>
                <div
                  className="position-cell position-cell--numeric position-cell--daily cash-cell"
                  data-label="今日变化"
                >
                  <span className="cash-cell__label">今日变化</span>
                  <strong className="numeric position-cell__primary">暂无</strong>
                  <span className="position-cell__secondary">不参与</span>
                </div>
              </Link>
            ) : brokerPortfolioActive ? (
              <Link
                className="position-row cash-row"
                href="/portfolio-setup"
                aria-label={`组合 USD 现金 ${visiblePortfolio.cash.balance}，点按校准`}
              >
                <div className="position-cell position-cell--identity">
                  <strong>组合现金</strong>
                  <span>USD CASH · 统一现金池</span>
                </div>
                <div
                  className="position-cell position-cell--numeric cash-cell"
                  data-label="组合现金"
                >
                  <span className="cash-cell__label">组合现金</span>
                  <strong className="numeric position-cell__primary">
                    {visiblePortfolio.cash.balance}
                  </strong>
                  <span className="position-cell__secondary">买卖自动增减</span>
                </div>
                <div
                  className="position-cell position-cell--numeric cash-cell"
                  data-label="买入规则"
                >
                  <span className="cash-cell__label">买入规则</span>
                  <strong className="position-cell__primary">扣减现金</strong>
                  <span className="position-cell__secondary">成交额 + 手续费</span>
                </div>
                <div
                  className="position-cell position-cell--numeric position-cell--pnl cash-cell"
                  data-label="卖出规则"
                >
                  <span className="cash-cell__label">卖出规则</span>
                  <strong className="position-cell__primary">增加现金</strong>
                  <span className="position-cell__secondary">成交额 − 手续费</span>
                </div>
                <div
                  className="position-cell position-cell--numeric position-cell--daily cash-cell"
                  data-label="今日变化"
                >
                  <span className="cash-cell__label">今日变化</span>
                  <strong className="numeric position-cell__primary">暂无</strong>
                  <span className="position-cell__secondary">不参与</span>
                </div>
              </Link>
            ) : (
              <>
                {visiblePortfolio.cash!.accounts.map((account) => {
                  const isIbkr = account.broker === "IBKR";
                  return (
                    <Link
                      className="position-row cash-row"
                      href={brokerPortfolioActive ? "/portfolio-setup" : "/cash"}
                      key={account.broker}
                      aria-label={
                        brokerPortfolioActive
                          ? `${account.broker} USD 账面现金 ${account.balance}，点按校准`
                          : `IBKR USD 现金余额 ${account.balance}，点按修改`
                      }
                      aria-describedby={isIbkr ? "cash-metric-description" : undefined}
                    >
                      {isIbkr ? (
                        <span className="sr-only" id="cash-metric-description">
                          当前显示估算年利息 {visiblePortfolio.cash!.estimatedAnnualInterest}；
                          现金不参与今日涨幅计算
                        </span>
                      ) : null}
                      <div className="position-cell position-cell--identity">
                        <strong>{account.broker} 现金</strong>
                        <span>
                          USD CASH · {isIbkr ? visiblePortfolio.cash!.pricingPlan : "账号记录"}
                        </span>
                      </div>
                      <div
                        className="position-cell position-cell--numeric cash-cell"
                        data-label="账面现金"
                      >
                        <span className="cash-cell__label">账面现金</span>
                        <strong className="numeric position-cell__primary">
                          {account.balance}
                        </strong>
                        <span className="numeric position-cell__secondary">
                          已结算 {account.settledBalance}
                        </span>
                      </div>
                      <div
                        className="position-cell position-cell--numeric cash-cell"
                        data-label={isIbkr ? "NAV 调整利率" : "待结算"}
                      >
                        <span className="cash-cell__label">
                          {isIbkr ? "NAV 调整利率" : "待结算"}
                        </span>
                        <strong className="numeric position-cell__primary">
                          {isIbkr
                            ? visiblePortfolio.cash!.navAdjustedAnnualRate
                            : account.pendingBalance}
                        </strong>
                        <span className="numeric position-cell__secondary">
                          {isIbkr
                            ? `整笔混合 ${visiblePortfolio.cash!.blendedAnnualRate}`
                            : "不套用 IBKR 利率"}
                        </span>
                      </div>
                      <div
                        className="position-cell position-cell--numeric position-cell--pnl cash-cell"
                        data-label={isIbkr ? "估算年利息" : "资金状态"}
                      >
                        <span className="cash-cell__label">
                          {isIbkr ? "估算年利息" : "资金状态"}
                        </span>
                        <strong className="numeric position-cell__primary">
                          {isIbkr
                            ? visiblePortfolio.cash!.estimatedAnnualInterest
                            : account.hasPending
                              ? "待结算"
                              : "已结算"}
                        </strong>
                        <span className="numeric position-cell__secondary">
                          {isIbkr
                            ? brokerPortfolioActive
                              ? `待结算 ${account.pendingBalance}`
                              : `月均 ${visiblePortfolio.cash!.estimatedMonthlyInterest}`
                            : account.isNegative
                              ? "融资负债"
                              : "现金资产"}
                        </span>
                      </div>
                      <div
                        className="position-cell position-cell--numeric position-cell--daily cash-cell"
                        data-label="今日变化"
                      >
                        <span className="cash-cell__label">今日变化</span>
                        <strong className="numeric position-cell__primary">暂无</strong>
                        <span className="position-cell__secondary">不参与</span>
                      </div>
                    </Link>
                  );
                })}
              </>
            )}
            </div>
          </div>
        </div>
        <p className="sr-only" id="position-scroll-hint">
          名称和代码固定在左侧；从表头或任意持仓行左右滑动，可查看全部持仓数据
        </p>
        <p
          className="sr-only"
          id="position-actions-hint"
        >
          {brokerPortfolioActive
            ? "点按或长按某只股票可买入、卖出、校准或复制资料"
            : "点按或长按某只股票可修改、加仓、仅复制、复制并打开 ChatGPT 或删除"}
        </p>
      </section>

      <footer className="page-disclosures" aria-label="数据说明">
        {visiblePortfolio.positions.length > 0 ? (
          <p className="data-note data-note--daily-change">
            今日盈亏按当前股数相对最近常规收盘价估算，现金不参与；若当日持仓数量发生变化，不等于券商按逐笔交易计算的当日盈亏。
          </p>
        ) : null}
        {displayCurrency === "CNY" && usdCnyRate !== null ? (
          <p className="data-note data-note--fx">
            人民币为估算显示 · 1 USD ≈ ¥{usdCnyRate.rate} ·
            {" "}{fxSourceDisclosure(usdCnyRate, isFxRateCached)}。持仓录入与复制资料仍使用 USD 真值，不计算汇兑盈亏。
          </p>
        ) : null}
        <p className="data-note data-note--cash">
          {brokerPortfolioActive
            ? "所有股票买卖统一增减组合现金；已结算与待结算都计入总资产，IBKR 利息仍只按正已结算 IBKR USD 估算 · "
            : "IBKR USD 现金利息为估算 · 首 USD 10,000 不计息 · NAV 低于 USD 100,000 时按比例调低档位利率 · "}
          <a
            href={
              visiblePortfolio.cash?.sourceUrl ??
              "https://www.interactivebrokers.com/en/accounts/fees/pricing-interest-rates.php"
            }
            target="_blank"
            rel="noreferrer"
          >
            IBKR 官方利率
          </a>
          {visiblePortfolio.cash !== null
            ? ` · ${visiblePortfolio.cash.policyVerifiedAt} 核验${
                visiblePortfolio.cash.navIsCashFallback
                  ? " · 当前未填写 NAV，暂按现金金额估算"
                  : ""
              }`
            : " · 录入后自动计算"}
        </p>
        <p className="sr-only" id="fx-rate-availability">
          {isFxRefreshing
            ? "正在获取人民币估算汇率"
            : canDisplayCny
              ? "人民币估算汇率可用"
              : "人民币估算汇率暂时不可用"}
        </p>
        <p className="sr-only" id="backup-privacy-note">
          {brokerPortfolioActive
            ? "JSON 备份包含当前双券商持仓、交易事件和现金记录，请妥善保存"
            : "JSON 备份包含当前已保存的持仓数量、成本和 IBKR 现金记录，请妥善保存"}
        </p>
        <p className="sr-only" id="copy-privacy-note">
          内容可包含持仓、券商现金、成本、市值、盈亏和行情。仅复制会把资料写入系统剪贴板并留在当前页面；本站与 Vercel 不接收这些资料
        </p>
        <p className="sr-only" id="chatgpt-copy-privacy-note">
          内容可包含持仓、券商现金、成本、市值、盈亏和行情。操作会先写入系统剪贴板，再通过 ChatGPT 链接打开待发送 Prompt；本站与 Vercel 不接收这些资料，仍需你手动发送
        </p>
      </footer>
      </div>
      </div>

      {productionExperience() ? <BottomEntryAction brokerPortfolioActive={brokerPortfolioActive} /> : null}

      {moreSheetOpen ? (
        <div
          className="action-sheet-backdrop action-sheet-backdrop--portfolio-more"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeMore();
            }
          }}
        >
          <section
            className="action-sheet portfolio-more-sheet"
            ref={moreSheet}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="portfolio-more-title"
          >
            <span className="portfolio-more-sheet__handle" aria-hidden="true">
              <IoRemoveOutline />
            </span>
            <div className="action-sheet__heading">
              <h2 id="portfolio-more-title">更多操作</h2>
              <p>分析、行情与账号数据工具</p>
            </div>
            <div className="action-sheet__actions portfolio-more-sheet__utilities">
              <button
                className="action-sheet__button portfolio-more-sheet__row"
                type="button"
                data-autofocus
                disabled={isRefreshing}
                aria-busy={isRefreshing}
                onClick={() => {
                  closeMore();
                  onRefresh();
                }}
              >
                <span className="portfolio-more-sheet__icon" aria-hidden="true">
                  <IoRefreshOutline />
                </span>
                <span className="portfolio-more-sheet__content">
                  <strong>{isRefreshing ? "正在刷新…" : "刷新行情"}</strong>
                  <span>重新获取当前估值与汇率</span>
                </span>
                <IoChevronForward
                  className="portfolio-more-sheet__chevron"
                  aria-hidden="true"
                />
              </button>
              <Link
                className="action-sheet__button portfolio-more-sheet__row"
                href="/data-safety"
              >
                <span className="portfolio-more-sheet__icon" aria-hidden="true">
                  <IoShieldCheckmarkOutline />
                </span>
                <span className="portfolio-more-sheet__content">
                  <strong>数据安全与恢复</strong>
                  <span>检查账号 current、生成或恢复 JSON 副本</span>
                </span>
                <IoChevronForward
                  className="portfolio-more-sheet__chevron"
                  aria-hidden="true"
                />
              </Link>
              <Link
                className="action-sheet__button portfolio-more-sheet__row"
                href="/portfolio-setup"
              >
                <span className="portfolio-more-sheet__icon" aria-hidden="true">
                  <IoDocumentTextOutline />
                </span>
                <span className="portfolio-more-sheet__content">
                  <strong>
                    {brokerPortfolioActive
                      ? "校准双券商组合"
                      : "启用双券商账本"}
                  </strong>
                  <span>IBKR 与 moomoo 持仓、现金和资金归属</span>
                </span>
                <IoChevronForward
                  className="portfolio-more-sheet__chevron"
                  aria-hidden="true"
                />
              </Link>
              <button
                className="action-sheet__button portfolio-more-sheet__row"
                type="button"
                disabled={isExporting}
                aria-busy={isExporting}
                aria-label="导出数据副本"
                aria-describedby="backup-privacy-note"
                onClick={() => {
                  closeMore();
                  onExportBackup();
                }}
              >
                <span className="portfolio-more-sheet__icon" aria-hidden="true">
                  <IoDocumentTextOutline />
                </span>
                <span className="portfolio-more-sheet__content">
                  <strong>{isExporting ? "生成中…" : "导出数据副本"}</strong>
                  <span>生成当前股票与现金的 JSON 文件</span>
                </span>
                <IoChevronForward
                  className="portfolio-more-sheet__chevron"
                  aria-hidden="true"
                />
              </button>
              <a
                className="action-sheet__button portfolio-more-sheet__row"
                href="/signout-with-chatgpt?return_to=/"
              >
                <span className="portfolio-more-sheet__icon" aria-hidden="true">
                  <IoLogOutOutline />
                </span>
                <span className="portfolio-more-sheet__content">
                  <strong>退出登录</strong>
                  <span>退出当前 ChatGPT 账号</span>
                </span>
                <IoChevronForward
                  className="portfolio-more-sheet__chevron"
                  aria-hidden="true"
                />
              </a>
            </div>
            <p className="portfolio-more-sheet__section-label">持仓资料</p>
            <div className="action-sheet__actions portfolio-more-sheet__copy-actions">
              <button
                className="action-sheet__button portfolio-more-sheet__row"
                type="button"
                disabled={isCopying}
                aria-busy={isCopying}
                aria-label="仅复制持仓资料"
                aria-describedby="copy-privacy-note"
                onClick={() => {
                  const trigger = moreTrigger.current;
                  setMoreSheetOpen(false);
                  if (trigger !== null) {
                    openCopy(trigger, "clipboard");
                  }
                }}
              >
                <span
                  className="portfolio-more-sheet__icon portfolio-more-sheet__icon--neutral"
                  aria-hidden="true"
                >
                  <IoCopyOutline />
                </span>
                <span className="portfolio-more-sheet__content">
                  <strong>仅复制持仓资料</strong>
                  <span>选择范围后复制，可粘贴到任意应用</span>
                </span>
                <IoChevronForward
                  className="portfolio-more-sheet__chevron"
                  aria-hidden="true"
                />
              </button>
              <button
                className="action-sheet__button portfolio-more-sheet__row portfolio-more-sheet__row--chatgpt"
                type="button"
                disabled={isCopying}
                aria-busy={isCopying}
                aria-label="复制并打开 ChatGPT"
                aria-describedby="chatgpt-copy-privacy-note"
                onClick={() => {
                  const trigger = moreTrigger.current;
                  setMoreSheetOpen(false);
                  if (trigger !== null) {
                    openCopy(trigger, "chatgpt");
                  }
                }}
              >
                <span
                  className="portfolio-more-sheet__icon portfolio-more-sheet__icon--chatgpt"
                  aria-hidden="true"
                >
                  <BsOpenai />
                </span>
                <span className="portfolio-more-sheet__content">
                  <strong>复制并打开 ChatGPT</strong>
                  <span>选择范围后预填为待发送 Prompt</span>
                </span>
                <IoChevronForward
                  className="portfolio-more-sheet__chevron portfolio-more-sheet__chevron--chatgpt"
                  aria-hidden="true"
                />
              </button>
            </div>
            <p className="portfolio-more-sheet__note">
              两种方式生成同一份 USD 资料；均不会自动发送
            </p>
            <button
              className="action-sheet__cancel"
              type="button"
              onClick={closeMore}
            >
              取消
            </button>
          </section>
        </div>
      ) : null}

      {insightsSheetOpen && insights !== null ? (
        <PortfolioInsightsSheet
          insights={insights}
          portfolioSource={portfolioSource}
          displayCurrency={displayCurrency}
          usdCnyRate={usdCnyRate?.rate ?? null}
          cnySourceDisclosure={
            displayCurrency === "CNY" && usdCnyRate !== null
              ? `人民币金额按 1 USD ≈ ¥${usdCnyRate.rate} 折算 · ${fxSourceDisclosure(
                  usdCnyRate,
                  isFxRateCached,
                )}。占比和排序保持 USD 真值口径。`
              : null
          }
          onClose={closeInsights}
        />
      ) : null}

      {aiChatOpen && insights !== null ? (
        <PortfolioAiChatDialog
          insights={insights}
          portfolioSource={portfolioSource}
          displayCurrency={displayCurrency}
          usdCnyRate={usdCnyRate?.rate ?? null}
          onClose={closeAiChat}
        />
      ) : null}

      {aiResearchOpen && insights !== null ? (
        <PortfolioAiResearchDialog onClose={closeAiResearch} />
      ) : null}

      {activePosition ? (
        <div
          className="action-sheet-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeActions();
            }
          }}
        >
          <section
            className="action-sheet"
            ref={actionSheet}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="position-action-title"
          >
            {confirmingDelete ? (
              <>
                <div className="action-sheet__heading">
                  <p>{activePosition.name}</p>
                  <h2 id="position-action-title">
                    删除 {activePosition.symbol} 持仓？
                  </h2>
                </div>
                <p className="action-sheet__description">
                  这只股票的账号持仓数据会被删除且无法撤销，其他股票不受影响。
                </p>
                {deleteError ? (
                  <p
                    className="action-sheet__description action-sheet__description--error"
                    role="alert"
                  >
                    {deleteError}
                  </p>
                ) : null}
                <div className="action-sheet__confirm-actions">
                  <button
                    className="action-sheet__button"
                    type="button"
                    data-autofocus
                    disabled={deletingKey !== null}
                    onClick={() => {
                      setConfirmingDelete(false);
                      setDeleteError(null);
                    }}
                  >
                    返回
                  </button>
                  <button
                    className="action-sheet__button action-sheet__button--danger"
                    type="button"
                    disabled={deletingKey !== null}
                    aria-busy={deletingKey !== null}
                    onClick={() => void confirmDelete()}
                  >
                    {deletingKey !== null ? "删除中…" : "确认删除"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="action-sheet__heading">
                  <p>{activePosition.name}</p>
                  <h2 id="position-action-title">
                    {activePosition.symbol} 持仓操作
                  </h2>
                </div>
                {copyError ? (
                  <p
                    className="action-sheet__description action-sheet__description--error"
                    role="alert"
                  >
                    {copyError}
                  </p>
                ) : null}
                <div className="action-sheet__actions">
                  {brokerPortfolioActive ? (
                    <>
                      <Link
                        className="action-sheet__button"
                        data-autofocus
                        href={tradeHref(activePosition.instrumentKey, "BUY")}
                      >
                        <strong>买入</strong>
                        <span>选择持仓券商，买入款从组合现金扣减</span>
                      </Link>
                      <Link
                        className="action-sheet__button"
                        href={tradeHref(activePosition.instrumentKey, "SELL")}
                      >
                        <strong>卖出</strong>
                        <span>按所选券商扣股，净卖出款加入组合现金</span>
                      </Link>
                      <Link className="action-sheet__button" href="/portfolio-setup">
                        <strong>校准持仓</strong>
                        <span>按 IBKR 与 moomoo 当前值重新核对</span>
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        className="action-sheet__button"
                        data-autofocus
                        href={positionActionHref(
                          activePosition.instrumentKey,
                          "edit",
                        )}
                      >
                        <strong>修改持仓</strong>
                        <span>
                          当前 {activePosition.quantity} 股 ·
                          {displayCurrency === "CNY"
                            ? " 人民币估算均价 "
                            : " 均价 "}
                          {activePosition.averageCost}
                        </span>
                      </Link>
                      <Link
                        className="action-sheet__button"
                        href={positionActionHref(
                          activePosition.instrumentKey,
                          "add",
                        )}
                      >
                        <strong>加仓</strong>
                        <span>填写本次数量与买入均价</span>
                      </Link>
                    </>
                  )}
                  <button
                    className="action-sheet__button"
                    type="button"
                    disabled={isCopying}
                    aria-busy={isCopying}
                    onClick={() => {
                      copyTrigger.current = actionTrigger.current;
                      setCopyTarget("clipboard");
                      void performCopy(
                        {
                          kind: "single",
                          instrumentKey: activePosition.instrumentKey,
                        },
                        "clipboard",
                      );
                    }}
                  >
                    <strong>
                      {isCopying && copyTarget === "clipboard"
                        ? "正在复制…"
                        : "仅复制这只持仓资料"}
                    </strong>
                    <span>复制后可粘贴到任意应用</span>
                  </button>
                  <button
                    className="action-sheet__button action-sheet__button--chatgpt"
                    type="button"
                    disabled={isCopying}
                    aria-busy={isCopying}
                    onClick={() => {
                      copyTrigger.current = actionTrigger.current;
                      setCopyTarget("chatgpt");
                      void performCopy(
                        {
                          kind: "single",
                          instrumentKey: activePosition.instrumentKey,
                        },
                        "chatgpt",
                      );
                    }}
                  >
                    <strong>
                      {isCopying && copyTarget === "chatgpt"
                        ? "正在打开…"
                        : "复制并打开 ChatGPT"}
                    </strong>
                    <span>这只持仓的组合摘要、仓位占比与行情</span>
                  </button>
                  {!brokerPortfolioActive ? (
                    <button
                      className="action-sheet__button action-sheet__button--danger"
                      type="button"
                      onClick={() => {
                        setConfirmingDelete(true);
                        setDeleteError(null);
                      }}
                    >
                      <strong>删除持仓</strong>
                      <span>只删除 {activePosition.symbol}</span>
                    </button>
                  ) : null}
                </div>
                <button
                  className="action-sheet__cancel"
                  type="button"
                  onClick={closeActions}
                >
                  取消
                </button>
              </>
            )}
          </section>
        </div>
      ) : null}

      {copyView ? (
        <div
          className="action-sheet-backdrop action-sheet-backdrop--portfolio-copy"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCopy();
            }
          }}
        >
          <section
            className={`action-sheet portfolio-copy-sheet${
              copyView === "manual"
                ? " portfolio-copy-sheet--manual"
                : ""
            }`}
            ref={copySheet}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="copy-sheet-title"
          >
            {copyView === "manual" ? (
              <>
                <div className="action-sheet__heading">
                  <p>剪贴板写入不可用</p>
                  <h2 id="copy-sheet-title">手动复制备用</h2>
                </div>
                <p className="action-sheet__description">
                  {copyTarget === "chatgpt"
                    ? "已尝试通过 ChatGPT 链接打开待发送 Prompt。返回本页后如仍需复制，可点按下方文本框再选择“全选”和“复制”。"
                    : "系统未能自动写入剪贴板。可点按下方文本框，再选择“全选”和“复制”。"}
                  本站与 Vercel 不接收这些资料，当前持仓也没有被修改。
                </p>
                <textarea
                  className="portfolio-copy-sheet__textarea"
                  ref={manualCopyArea}
                  data-autofocus
                  readOnly
                  aria-label="待手动复制的持仓资料"
                  value={manualCopyText}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  className="action-sheet__button portfolio-copy-sheet__select"
                  type="button"
                  onClick={() => {
                    manualCopyArea.current?.focus();
                    manualCopyArea.current?.select();
                  }}
                >
                  选择全部文本
                </button>
              </>
            ) : (
              <>
                <div className="action-sheet__heading">
                  <p>
                    {copyView === "scope"
                      ? copyTarget === "chatgpt"
                        ? "选择范围后复制并预填为待发送 Prompt；仍需你手动发送"
                        : "选择范围后仅写入系统剪贴板，可粘贴到任意应用"
                      : copyTarget === "chatgpt"
                        ? "按未舍入市值降序；选定后复制并打开 ChatGPT"
                        : "按未舍入市值降序；选定后仅复制"}
                  </p>
                  <h2 id="copy-sheet-title">
                    {copyView === "scope"
                      ? copyTarget === "chatgpt"
                        ? "复制并打开 ChatGPT"
                        : "仅复制持仓资料"
                      : "选择一只持仓"}
                  </h2>
                </div>
                {copyError ? (
                  <p
                    className="action-sheet__description action-sheet__description--error"
                    role="alert"
                  >
                    {copyError}
                  </p>
                ) : null}
                <div className="action-sheet__actions portfolio-copy-sheet__options">
                  {copyView === "scope" ? (
                    <>
                      {visiblePortfolio.positions.length > 5 ? (
                        <button
                          className="action-sheet__button"
                          type="button"
                          data-autofocus
                          disabled={isCopying}
                          onClick={() =>
                            void performCopy({ kind: "top", limit: 5 })
                          }
                        >
                          <strong>前 5 大持仓</strong>
                          <span>按市值降序 · 含组合总览</span>
                        </button>
                      ) : null}
                      {visiblePortfolio.positions.length > 10 ? (
                        <button
                          className="action-sheet__button"
                          type="button"
                          data-autofocus
                          disabled={isCopying}
                          onClick={() =>
                            void performCopy({ kind: "top", limit: 10 })
                          }
                        >
                          <strong>前 10 大持仓</strong>
                          <span>按市值降序 · 含组合总览</span>
                        </button>
                      ) : null}
                      <button
                        className="action-sheet__button"
                        type="button"
                        data-autofocus
                        disabled={isCopying}
                        onClick={() => void performCopy({ kind: "all" })}
                      >
                        <strong>
                          {visiblePortfolio.cash === null
                            ? "全部持仓"
                            : "全部资产"}
                        </strong>
                        <span>
                          {visiblePortfolio.positions.length} 只股票
                          {visiblePortfolio.cash === null
                            ? " · 完整列表"
                            : brokerPortfolioActive
                              ? " + 双券商现金"
                              : " + IBKR 现金"}
                        </span>
                      </button>
                      {visiblePortfolio.positions.length > 0 ? (
                        <button
                          className="action-sheet__button"
                          type="button"
                          disabled={isCopying}
                          onClick={() => {
                            setCopyError(null);
                            setCopyView("single");
                          }}
                        >
                          <strong>选择单只持仓</strong>
                          <span>附组合总览、仓位占比与排名</span>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    visiblePortfolio.positions.map((position) => (
                      <button
                        className="action-sheet__button"
                        type="button"
                        data-autofocus
                        disabled={isCopying}
                        key={position.instrumentKey}
                        onClick={() =>
                          void performCopy({
                            kind: "single",
                            instrumentKey: position.instrumentKey,
                          })
                        }
                      >
                        <strong>
                          {position.symbol} · {position.name}
                        </strong>
                        <span>
                          市值 {position.marketValue} · {position.quantity} 股
                        </span>
                      </button>
                    ))
                  )}
                </div>
                {copyView === "single" ? (
                  <button
                    className="action-sheet__cancel"
                    type="button"
                    disabled={isCopying}
                    onClick={() => {
                      setCopyError(null);
                      setCopyView("scope");
                    }}
                  >
                    返回范围选择
                  </button>
                ) : null}
              </>
            )}
            <button
              className="action-sheet__cancel"
              type="button"
              disabled={isCopying}
              onClick={closeCopy}
            >
              关闭
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
