"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { requestUsdCnyRate } from "../application/fx/browser/usd-cny-rate-client.ts";
import {
  readCachedUsdCnyRate,
  writeCachedUsdCnyRate,
} from "../application/fx/browser/usd-cny-rate-cache.ts";
import {
  isUsdCnyRateUsable,
  type UsdCnyRate,
} from "../application/fx/index.ts";
import { requestDelayedQuotes } from "../application/market-data/browser/quote-client.ts";
import { requestIntradayBars } from "../application/market-data/browser/intraday-bars-client.ts";
import { IndexedDbLastValidQuoteStore } from "../application/market-data/indexeddb-last-valid-quote-store.ts";
import { recordBackupGeneratedAt } from "../application/positions/browser/data-safety.ts";
import { copyPortfolioText } from "../application/positions/browser/copy-portfolio-text.ts";
import { deliverChatGptPrompt } from "../application/positions/browser/deliver-chatgpt-prompt.ts";
import { deliverPositionBackup } from "../application/positions/browser/deliver-position-backup.ts";
import {
  BrokerPortfolioBackupValidationError,
  createBrokerPortfolioBackupDocument,
  createBrokerPortfolioBackupFile,
} from "../application/brokerage/index.ts";
import {
  createPositionBackupDocument,
  createPositionBackupFile,
  PositionBackupValidationError,
  projectBrokerPortfolioCash,
  projectBrokerPortfolioSnapshots,
  type PositionSnapshot,
} from "../application/positions/index.ts";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "../application/portfolio-repository.ts";
import {
  normalizePortfolioCashInput,
  type PortfolioCashSource,
} from "../application/cash/index.ts";
import {
  aggregatePositionInputs,
  compareRfc3339,
  createPortfolioTrend,
  instrumentKeyId,
  resolveQuote,
  type BrokerPortfolioBook,
  type PortfolioTrendResult,
  type ResolvedQuote,
  type ValidMarketQuote,
} from "../domain/index.ts";
import {
  getPortfolioFixture,
  type PortfolioFixture,
} from "../ui/portfolio-fixtures.ts";
import {
  createPortfolioCopySource,
  createPortfolioCopyText,
  portfolioCopySelectionCount,
  type PortfolioCopyOutcome,
  type PortfolioCopyScope,
  type PortfolioCopySource,
  type PortfolioCopyTarget,
} from "../ui/portfolio-copy-text.ts";
import {
  createPortfolioInsights,
  type PortfolioInsights,
} from "../ui/portfolio-insights.ts";
import { createPortfolioViewModel } from "../ui/portfolio-view-model.ts";
import { PortfolioDashboard } from "./portfolio-dashboard.tsx";

const FOREGROUND_REFRESH_INTERVAL_MS = 60_000;
const TREND_REFRESH_INTERVAL_MS = 5 * 60_000;
const FX_REFRESH_INTERVAL_MS = 15 * 60_000;
const CASH_READ_FAILURE_NOTICE =
  "现金记录暂时无法读取，股票持仓仍可查看；没有清空任何数据。";

const DEVELOPMENT_PREVIEW_TREND: PortfolioTrendResult = {
  status: "READY",
  referenceValue: "46880",
  points: [
    {
      sourceEventAt: "2026-08-07T14:30:00Z",
      estimatedDailyPriceEffect: "120",
      estimatedDailyChangeRate: "0.00255972696245733788",
      estimatedAsset: "47000",
      segment: "SIP_HISTORY",
      connectFromPrevious: false,
    },
    {
      sourceEventAt: "2026-08-07T15:30:00Z",
      estimatedDailyPriceEffect: "320",
      estimatedDailyChangeRate: "0.00682593856655290102",
      estimatedAsset: "47200",
      segment: "SIP_HISTORY",
      connectFromPrevious: true,
    },
    {
      sourceEventAt: "2026-08-07T16:30:00Z",
      estimatedDailyPriceEffect: "553.89",
      estimatedDailyChangeRate: "0.011815913312287",
      estimatedAsset: "47433.89",
      segment: "SIP_HISTORY",
      connectFromPrevious: true,
    },
  ],
};

function quoteValue(
  quote: ResolvedQuote,
): ValidMarketQuote | null {
  if (
    quote.provider === null ||
    quote.feed === null ||
    quote.effectivePrice === null ||
    quote.sourcePriceType === null ||
    quote.sourceEventAt === null ||
    quote.fetchedAt === null
  ) {
    return null;
  }
  return {
    instrument: quote.instrument,
    provider: quote.provider,
    feed: quote.feed,
    price: quote.effectivePrice,
    priceType: quote.sourcePriceType,
    sourceEventAt: quote.sourceEventAt,
    fetchedAt: quote.fetchedAt,
    marketSession: quote.marketSession,
    ...(quote.previousRegularClose === null
      ? {}
      : { previousRegularClose: quote.previousRegularClose }),
  };
}

function newestQuoteEventAt(
  quotes: readonly ResolvedQuote[],
): string | null {
  let newest: string | null = null;
  for (const quote of quotes) {
    if (quote.sourceEventAt === null) {
      continue;
    }
    if (
      newest === null ||
      compareRfc3339(quote.sourceEventAt, newest) > 0
    ) {
      newest = quote.sourceEventAt;
    }
  }
  return newest;
}

function cacheableQuote(
  quote: ResolvedQuote,
): ValidMarketQuote | null {
  return quote.acceptedCandidate ? quoteValue(quote) : null;
}

function applyOvernightReferenceClose(
  fresh: ResolvedQuote,
  resolved: ResolvedQuote,
): ResolvedQuote {
  if (
    fresh.marketSession !== "OVERNIGHT" ||
    resolved.previousRegularClose === fresh.previousRegularClose
  ) {
    return resolved;
  }
  return {
    ...resolved,
    previousRegularClose: fresh.previousRegularClose,
  };
}

export function reconcileQuoteWithCache(
  fresh: ResolvedQuote,
  cached: ResolvedQuote | undefined,
  now: string,
): ResolvedQuote {
  const lastValidQuote =
    cached === undefined ? null : quoteValue(cached);
  const candidate = quoteValue(fresh);

  if (fresh.acceptedCandidate && candidate !== null) {
    const resolved = resolveQuote({
      requestedInstrument: fresh.instrument,
      now,
      fetchStatus: fresh.fetchStatus,
      marketSession: fresh.marketSession,
      candidate,
      ...(lastValidQuote === null
        ? {}
        : { lastValidQuote }),
    });
    return applyOvernightReferenceClose(fresh, resolved);
  }

  if (lastValidQuote !== null) {
    const resolved = resolveQuote({
      requestedInstrument: fresh.instrument,
      now,
      fetchStatus: fresh.fetchStatus,
      marketSession: fresh.marketSession,
      lastValidQuote,
    });
    return applyOvernightReferenceClose(fresh, resolved);
  }

  return fresh;
}

async function cachedResolutions(
  snapshots: readonly PositionSnapshot[],
  store: IndexedDbLastValidQuoteStore,
): Promise<readonly ResolvedQuote[]> {
  const now = new Date().toISOString();
  const values = await Promise.all(
    snapshots.map(async (snapshot) => {
      try {
        const cached = await store.getLastValidQuote(
          snapshot.batch.instrument,
        );
        return cached === null
          ? null
          : resolveQuote({
              requestedInstrument: snapshot.batch.instrument,
              now,
              fetchStatus: "FETCH_FAILED",
              marketSession: "UNKNOWN",
              lastValidQuote: cached,
            });
      } catch {
        return null;
      }
    }),
  );
  return values.filter(
    (quote): quote is ResolvedQuote => quote !== null,
  );
}

function freshIsNotOlder(
  fresh: ResolvedQuote,
  cached: ResolvedQuote,
): boolean {
  if (
    fresh.sourceEventAt === null ||
    fresh.fetchedAt === null
  ) {
    return false;
  }
  if (
    cached.sourceEventAt === null ||
    cached.fetchedAt === null
  ) {
    return true;
  }
  try {
    const sourceOrder = compareRfc3339(
      fresh.sourceEventAt,
      cached.sourceEventAt,
    );
    return sourceOrder > 0
      ? true
      : sourceOrder < 0
        ? false
        : compareRfc3339(
              fresh.fetchedAt,
              cached.fetchedAt,
            ) >= 0;
  } catch {
    return false;
  }
}

export function mergeFreshWithCached(
  snapshots: readonly PositionSnapshot[],
  fresh: readonly ResolvedQuote[],
  cached: readonly ResolvedQuote[],
): readonly ResolvedQuote[] {
  const freshByKey = new Map(
    fresh.map((quote) => [instrumentKeyId(quote.instrument), quote]),
  );
  const cachedByKey = new Map(
    cached.map((quote) => [instrumentKeyId(quote.instrument), quote]),
  );
  return snapshots.flatMap((snapshot) => {
    const key = instrumentKeyId(snapshot.batch.instrument);
    const candidate = freshByKey.get(key);
    const fallback = cachedByKey.get(key);
    if (
      candidate !== undefined &&
      candidate.effectivePrice !== null &&
      (fallback === undefined ||
        freshIsNotOlder(candidate, fallback))
    ) {
      return [candidate];
    }
    return fallback === undefined
      ? candidate === undefined
        ? []
        : [candidate]
      : [fallback];
  });
}

export function shouldShowUnavailableNotice(
  quotes: readonly ResolvedQuote[],
): boolean {
  return (
    quotes.length > 0 &&
    quotes.every((quote) => quote.effectivePrice === null) &&
    !quotes.every(
      (quote) => quote.fetchStatus === "NOT_REQUESTED",
    )
  );
}

export function PortfolioController() {
  const developmentPreviewEnabled =
    process.env.NODE_ENV === "development" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("fixture") === "ready";
  const repositoryRef = useRef<PortfolioRepository | null>(null);
  const quoteStoreRef = useRef<IndexedDbLastValidQuoteStore | null>(null);
  const snapshotsRef = useRef<readonly PositionSnapshot[]>([]);
  const cashSnapshotRef = useRef<PortfolioCashSource | null>(null);
  const brokerBookRef = useRef<BrokerPortfolioBook | null>(null);
  const quotesRef = useRef<readonly ResolvedQuote[]>([]);
  const usdCnyRateRef = useRef<UsdCnyRate | null>(null);
  const cashReadIsReliableRef = useRef(true);
  const copySourceRef = useRef<PortfolioCopySource | null>(null);
  const copyOperationRef = useRef<Promise<PortfolioCopyOutcome> | null>(null);
  const loadSequence = useRef(0);
  const lastRefreshAt = useRef(0);
  const lastFxRefreshAttemptAt = useRef(0);
  const lastTrendRefreshAt = useRef(0);
  const trendRefreshGeneration = useRef(0);
  const refreshInFlight = useRef(false);
  const fxRefreshInFlight = useRef(false);
  const exportInFlight = useRef(false);
  const [portfolio, setPortfolio] = useState<PortfolioFixture>({
    viewState: "loading",
  });
  const [insights, setInsights] = useState<PortfolioInsights | null>(null);
  const [cnyPortfolio, setCnyPortfolio] =
    useState<PortfolioFixture | null>(null);
  const [usdCnyRate, setUsdCnyRate] =
    useState<UsdCnyRate | null>(null);
  const [isFxRateCached, setIsFxRateCached] = useState(false);
  const [isFxRefreshing, setIsFxRefreshing] = useState(false);
  const [isFxRateUnavailable, setIsFxRateUnavailable] =
    useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [brokerPortfolioActive, setBrokerPortfolioActive] = useState(false);
  const trendRef = useRef<PortfolioTrendResult | null>(null);
  const [trend, setTrend] = useState<PortfolioTrendResult | null>(null);
  const [isTrendLoading, setIsTrendLoading] = useState(false);

  const repositories = useCallback(() => {
    repositoryRef.current ??= createPortfolioRepository();
    quoteStoreRef.current ??= new IndexedDbLastValidQuoteStore();
    return {
      positions: repositoryRef.current,
      quotes: quoteStoreRef.current,
    };
  }, []);

  const publishPortfolio = useCallback(
    (
      snapshots: readonly PositionSnapshot[],
      quotes: readonly ResolvedQuote[],
      cashSnapshot: PortfolioCashSource | null,
    ) => {
      snapshotsRef.current = snapshots;
      quotesRef.current = quotes;
      cashSnapshotRef.current = cashSnapshot;
      const copySource = createPortfolioCopySource(
        snapshots,
        quotes,
        cashSnapshot,
      );
      copySourceRef.current = copySource;
      setInsights(
        cashReadIsReliableRef.current
          ? createPortfolioInsights(copySource)
          : null,
      );
      setPortfolio(
        createPortfolioViewModel(
          snapshots,
          quotes,
          { currency: "USD" },
          cashSnapshot,
        ),
      );
      const rate = usdCnyRateRef.current;
      setCnyPortfolio(
        rate === null
          ? null
          : createPortfolioViewModel(snapshots, quotes, {
              currency: "CNY",
              usdCnyRate: rate.rate,
            }, cashSnapshot),
      );
    },
    [],
  );

  const publishTrend = useCallback((value: PortfolioTrendResult | null) => {
    trendRef.current = value;
    setTrend(value);
  }, []);

  const refreshTrend = useCallback(
    async (
      snapshots: readonly PositionSnapshot[],
      quotes: readonly ResolvedQuote[],
      cashSnapshot: PortfolioCashSource | null,
    ) => {
      if (snapshots.length === 0) {
        trendRefreshGeneration.current += 1;
        publishTrend(null);
        setIsTrendLoading(false);
        return;
      }
      const attemptedAt = Date.now();
      if (
        trendRef.current !== null &&
          attemptedAt - lastTrendRefreshAt.current <
            TREND_REFRESH_INTERVAL_MS
      ) {
        return;
      }
      const generation = trendRefreshGeneration.current + 1;
      trendRefreshGeneration.current = generation;
      if (trendRef.current === null) {
        setIsTrendLoading(true);
      }

      const quotesByInstrument = new Map(
        quotes.map((quote) => [instrumentKeyId(quote.instrument), quote]),
      );
      const positions = snapshots.flatMap((snapshot) => {
        const [position] = aggregatePositionInputs(snapshot.batch.inputs);
        if (position === undefined) {
          return [];
        }
        const quote = quotesByInstrument.get(
          instrumentKeyId(position.instrument),
        );
        return [
          {
            instrument: position.instrument,
            quantity: position.quantity,
            previousRegularClose:
              quote?.previousRegularClose ?? null,
          },
        ];
      });
      const cashBalance = cashSnapshot?.totalBalance ?? "0";

      if (
        positions.length !== snapshots.length ||
        positions.some(
          (position) => position.previousRegularClose === null,
        )
      ) {
        if (generation === trendRefreshGeneration.current) {
          publishTrend(
            createPortfolioTrend({
              positions,
              series: [],
              cashBalance,
            }),
          );
          setIsTrendLoading(false);
        }
        return;
      }

      try {
        const asOf = newestQuoteEventAt(quotes) ?? new Date().toISOString();
        const bars = await requestIntradayBars(
          snapshots.map((snapshot) => snapshot.batch.instrument),
          { asOf },
        );
        if (generation === trendRefreshGeneration.current) {
          publishTrend(
            createPortfolioTrend({
              positions,
              series: bars.series,
              cashBalance,
            }),
          );
          lastTrendRefreshAt.current = attemptedAt;
        }
      } catch {
        if (
          generation === trendRefreshGeneration.current &&
          trendRef.current === null
        ) {
          publishTrend(
            createPortfolioTrend({
              positions,
              series: [],
              cashBalance,
            }),
          );
        }
      } finally {
        if (generation === trendRefreshGeneration.current) {
          setIsTrendLoading(false);
        }
      }
    },
    [publishTrend],
  );

  const refreshFxRate = useCallback(
    async (force: boolean) => {
      const attemptedAt = Date.now();
      if (
        fxRefreshInFlight.current ||
        (!force &&
          attemptedAt - lastFxRefreshAttemptAt.current <
            FX_REFRESH_INTERVAL_MS)
      ) {
        return;
      }
      fxRefreshInFlight.current = true;
      lastFxRefreshAttemptAt.current = attemptedAt;
      setIsFxRefreshing(true);

      let cached: UsdCnyRate | null = null;
      try {
        cached = readCachedUsdCnyRate(window.localStorage);
      } catch {
        cached = null;
      }
      const now = new Date().toISOString();
      if (
        usdCnyRateRef.current === null &&
        cached !== null &&
        isUsdCnyRateUsable(cached, now)
      ) {
        usdCnyRateRef.current = cached;
        setUsdCnyRate(cached);
        setIsFxRateCached(true);
        setIsFxRateUnavailable(false);
        if (
          snapshotsRef.current.length > 0 ||
          cashSnapshotRef.current !== null
        ) {
          publishPortfolio(
            snapshotsRef.current,
            quotesRef.current,
            cashSnapshotRef.current,
          );
        }
      }

      try {
        const fresh = await requestUsdCnyRate();
        if (!isUsdCnyRateUsable(fresh, new Date().toISOString())) {
          throw new Error("USD/CNY rate is too old to display");
        }
        usdCnyRateRef.current = fresh;
        setUsdCnyRate(fresh);
        setIsFxRateCached(false);
        setIsFxRateUnavailable(false);
        try {
          writeCachedUsdCnyRate(fresh, window.localStorage);
        } catch {
          // A blocked localStorage cache must not block the live rate.
        }
        if (
          snapshotsRef.current.length > 0 ||
          cashSnapshotRef.current !== null
        ) {
          publishPortfolio(
            snapshotsRef.current,
            quotesRef.current,
            cashSnapshotRef.current,
          );
        }
      } catch {
        const fallback = usdCnyRateRef.current ?? cached;
        if (
          fallback !== null &&
          isUsdCnyRateUsable(fallback, new Date().toISOString())
        ) {
          usdCnyRateRef.current = fallback;
          setUsdCnyRate(fallback);
          setIsFxRateCached(true);
          setIsFxRateUnavailable(false);
          if (
            snapshotsRef.current.length > 0 ||
            cashSnapshotRef.current !== null
          ) {
            publishPortfolio(
              snapshotsRef.current,
              quotesRef.current,
              cashSnapshotRef.current,
            );
          }
        } else {
          usdCnyRateRef.current = null;
          setUsdCnyRate(null);
          setCnyPortfolio(null);
          setIsFxRateCached(false);
          setIsFxRateUnavailable(true);
        }
      } finally {
        fxRefreshInFlight.current = false;
        setIsFxRefreshing(false);
      }
    },
    [publishPortfolio],
  );

  const load = useCallback(
    async (refreshQuotes: boolean) => {
      if (refreshQuotes && refreshInFlight.current) {
        return;
      }
      if (refreshQuotes) {
        refreshInFlight.current = true;
      }
      const sequence = loadSequence.current + 1;
      loadSequence.current = sequence;
      if (refreshQuotes) {
        setIsRefreshing(true);
      }
      setNotice(null);

      try {
        const stores = repositories();
        const brokerReader = stores.positions as unknown as {
          getBrokerPortfolioBook?: () => Promise<BrokerPortfolioBook | null>;
        };
        const brokerBook =
          typeof brokerReader.getBrokerPortfolioBook === "function"
            ? await brokerReader.getBrokerPortfolioBook()
            : null;
        brokerBookRef.current = brokerBook;
        setBrokerPortfolioActive(brokerBook !== null);
        const snapshots =
          brokerBook === null
            ? await stores.positions.listSnapshots()
            : projectBrokerPortfolioSnapshots(brokerBook);
        let cashSnapshot: PortfolioCashSource | null = null;
        let cashReadFailed = false;
        try {
          cashSnapshot =
            brokerBook === null
              ? normalizePortfolioCashInput(
                  await stores.positions.getCashSnapshot(),
                )
              : normalizePortfolioCashInput(
                  projectBrokerPortfolioCash(brokerBook),
                );
        } catch {
          cashReadFailed = true;
          setNotice(CASH_READ_FAILURE_NOTICE);
        }
        if (sequence !== loadSequence.current) {
          return;
        }
        cashReadIsReliableRef.current = !cashReadFailed;
        snapshotsRef.current = snapshots;
        cashSnapshotRef.current = cashSnapshot;

        if (snapshots.length === 0 && cashSnapshot === null) {
          quotesRef.current = [];
          copySourceRef.current = null;
          setInsights(null);
          setPortfolio(
            cashReadFailed
              ? {
                  viewState: "load-error",
                  message:
                    "股票持仓为空，但无法确认账号现金记录。为避免把读取故障误报为空组合，请刷新后重试。",
                }
              : { viewState: "empty" },
          );
          setCnyPortfolio(null);
          publishTrend(null);
          setIsTrendLoading(false);
          return;
        }

        const cached = await cachedResolutions(snapshots, stores.quotes);
        if (sequence !== loadSequence.current) {
          return;
        }
        publishPortfolio(snapshots, cached, cashSnapshot);

        if (!refreshQuotes || snapshots.length === 0) {
          await refreshTrend(snapshots, cached, cashSnapshot);
          if (refreshQuotes) {
            lastRefreshAt.current = Date.now();
          }
          return;
        }

        try {
          const quoteBatch = await requestDelayedQuotes(
            snapshots.map((snapshot) => snapshot.batch.instrument),
          );
          const fresh = quoteBatch.quotes;
          const reviewedAt = quoteBatch.generatedAt;
          const cachedByKey = new Map(
            cached.map((quote) => [
              instrumentKeyId(quote.instrument),
              quote,
            ]),
          );
          const reviewed = fresh.map((quote) =>
            reconcileQuoteWithCache(
              quote,
              cachedByKey.get(
                instrumentKeyId(quote.instrument),
              ),
              reviewedAt,
            ),
          );
          const persisted = await Promise.all(
            reviewed.map(async (quote) => {
              const cacheable = cacheableQuote(quote);
              if (cacheable === null) {
                return quote;
              }
              const write =
                await stores.quotes.putLastValidQuoteIfNewer(
                  cacheable,
                );
              if (write.stored) {
                return quote;
              }
              const current = resolveQuote({
                requestedInstrument: write.current.instrument,
                now: reviewedAt,
                fetchStatus: "FETCH_FAILED",
                marketSession: quote.marketSession,
                lastValidQuote: write.current,
              });
              return reconcileQuoteWithCache(
                quote,
                current,
                reviewedAt,
              );
            }),
          );
          if (sequence !== loadSequence.current) {
            return;
          }
          const merged = mergeFreshWithCached(
            snapshots,
            persisted,
            cached,
          );
          publishPortfolio(snapshots, merged, cashSnapshot);
          await refreshTrend(snapshots, merged, cashSnapshot);
          lastRefreshAt.current = Date.now();
          if (shouldShowUnavailableNotice(merged) && !cashReadFailed) {
            setNotice("延迟行情暂时不可用，持仓数量与成本未受影响。");
          }
        } catch (error) {
          if (sequence !== loadSequence.current) {
            return;
          }
          setNotice(
            cashReadFailed
              ? CASH_READ_FAILURE_NOTICE
              : error instanceof Error
                ? error.message
                : "延迟行情刷新失败，已保留上一有效结果。",
          );
          await refreshTrend(snapshots, cached, cashSnapshot);
        }
      } catch {
        if (sequence === loadSequence.current) {
          brokerBookRef.current = null;
          setBrokerPortfolioActive(false);
          cashReadIsReliableRef.current = false;
          copySourceRef.current = null;
          quotesRef.current = [];
          setInsights(null);
          setPortfolio({
            viewState: "load-error",
            message:
              "无法读取账号持仓。请确认仍处于登录状态并稍后重试。",
          });
          setCnyPortfolio(null);
          publishTrend(null);
          setIsTrendLoading(false);
        }
      } finally {
        if (refreshQuotes) {
          refreshInFlight.current = false;
        }
        if (sequence === loadSequence.current) {
          setIsRefreshing(false);
        }
      }
    },
    [
      publishPortfolio,
      publishTrend,
      refreshTrend,
      repositories,
    ],
  );

  const deletePosition = useCallback(
    async (instrumentKey: string) => {
      if (brokerBookRef.current !== null) {
        setNotice("双券商账本已启用，请使用卖出或组合校准；没有删除任何资产。");
        return false;
      }
      const current = snapshotsRef.current.find(
        (snapshot) =>
          instrumentKeyId(snapshot.batch.instrument) === instrumentKey,
      );
      if (current === undefined) {
        return false;
      }
      try {
        await repositories().positions.deleteSnapshot(
          current.batch.instrument,
          { expectedRevision: current.revision },
        );
        lastTrendRefreshAt.current = 0;
        publishTrend(null);
        await load(false);
        setNotice(`${current.batch.instrument.symbol} 持仓已删除。`);
        return true;
      } catch {
        setNotice(
          "删除失败，持仓可能已在另一页面发生变化；当前数据没有被清空。",
        );
        return false;
      }
    },
    [load, publishTrend, repositories],
  );

  const exportBackup = useCallback(async () => {
    if (exportInFlight.current) {
      return;
    }
    exportInFlight.current = true;
    setIsExporting(true);
    setNotice(null);
    try {
      const brokerBook = brokerBookRef.current;
      if (brokerBook !== null) {
        const backup = createBrokerPortfolioBackupDocument(
          brokerBook,
          new Date().toISOString(),
        );
        const result = await deliverPositionBackup(
          createBrokerPortfolioBackupFile(backup),
        );
        if (result === "cancelled") {
          setNotice("已取消导出，双券商账本没有被修改。");
          return;
        }
        recordBackupGeneratedAt(backup.exportedAt);
        setNotice(
          "双券商 JSON v3 副本已生成，请确认已存到“文件”或 iCloud Drive。当前资产没有被修改。",
        );
        return;
      }
      const [snapshots, cashSnapshot] = await Promise.all([
        repositories().positions.listSnapshots(),
        repositories().positions.getCashSnapshot(),
      ]);
      const backup = createPositionBackupDocument(
        snapshots,
        new Date().toISOString(),
        cashSnapshot,
      );
      const result = await deliverPositionBackup(
        createPositionBackupFile(backup),
      );
      if (result === "cancelled") {
        setNotice("已取消导出，当前持仓没有被修改。");
        return;
      }
      recordBackupGeneratedAt(backup.exportedAt);
      setNotice(
        "JSON 备份已生成，请确认已存到“文件”或 iCloud Drive。当前持仓没有被修改。",
      );
    } catch (error) {
      setNotice(
        error instanceof PositionBackupValidationError
          || error instanceof BrokerPortfolioBackupValidationError
          ? "当前数据存在不受支持、重复或同代码多市场的标的，无法生成可恢复备份。请先核对这些股票；当前持仓没有被修改。"
          : "未能生成备份，当前持仓没有被修改，请重试。",
      );
    } finally {
      exportInFlight.current = false;
      setIsExporting(false);
    }
  }, [repositories]);

  const copyPositions = useCallback(
    (
      scope: PortfolioCopyScope,
      target: PortfolioCopyTarget,
    ): Promise<PortfolioCopyOutcome> => {
      if (copyOperationRef.current !== null) {
        return copyOperationRef.current;
      }
      const source = copySourceRef.current;
      if (source === null) {
        setNotice("当前没有可复制的持仓资料。");
        return Promise.reject(new Error("portfolio copy source is unavailable"));
      }

      let text: string;
      let positionCount: number;
      try {
        const copiedAt = new Date().toISOString();
        text = createPortfolioCopyText(source, scope, copiedAt);
        positionCount = portfolioCopySelectionCount(source, scope);
      } catch (error) {
        setNotice("未能生成持仓资料，当前持仓没有被修改，请重试。");
        return Promise.reject(error);
      }

      setNotice(null);
      const deliveryOperation =
        target === "chatgpt"
          ? deliverChatGptPrompt(text)
          : copyPortfolioText(text);
      const operation = deliveryOperation.then(
        (delivery): PortfolioCopyOutcome => ({
          delivery,
          text,
          positionCount,
        }),
      );
      copyOperationRef.current = operation;
      void operation.then(
        () => {
          if (copyOperationRef.current === operation) {
            copyOperationRef.current = null;
          }
        },
        () => {
          if (copyOperationRef.current === operation) {
            copyOperationRef.current = null;
          }
        },
      );
      return operation;
    },
    [],
  );

  useEffect(() => {
    if (developmentPreviewEnabled) {
      const fixture = getPortfolioFixture("ready");
      setPortfolio(
        fixture.viewState === "ready"
          ? {
              ...fixture,
              status: {
                source: "本地合成预览数据，不代表真实持仓或实时行情。",
              },
            }
          : fixture,
      );
      setTrend(DEVELOPMENT_PREVIEW_TREND);
      setIsTrendLoading(false);
      setInsights(null);
      setCnyPortfolio(null);
      setUsdCnyRate(null);
      setIsFxRateUnavailable(false);
      return;
    }
    void load(true);
    void refreshFxRate(true);

    const refreshAfterResume = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshAt.current >
          FOREGROUND_REFRESH_INTERVAL_MS
      ) {
        void load(true);
      }
      if (document.visibilityState === "visible") {
        void refreshFxRate(false);
      }
    };
    const interval = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshAt.current >=
          FOREGROUND_REFRESH_INTERVAL_MS
      ) {
        void load(true);
      }
      if (document.visibilityState === "visible") {
        void refreshFxRate(false);
      }
    }, FOREGROUND_REFRESH_INTERVAL_MS);
    window.addEventListener("pageshow", refreshAfterResume);
    document.addEventListener("visibilitychange", refreshAfterResume);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pageshow", refreshAfterResume);
      document.removeEventListener(
        "visibilitychange",
        refreshAfterResume,
      );
      // Do not invalidate the in-flight load here. React StrictMode replays
      // mount effects in development; invalidating the first request while
      // the replay is rejected by refreshInFlight would leave the dashboard
      // permanently in its loading state. A real unmount owns fresh refs, so
      // late state updates from this instance are ignored by React.
    };
  }, [developmentPreviewEnabled, load, refreshFxRate]);

  return (
    <PortfolioDashboard
      initialPortfolio={portfolio}
      insights={insights}
      portfolioSource={copySourceRef.current}
      cnyPortfolio={cnyPortfolio}
      usdCnyRate={usdCnyRate}
      isFxRateCached={isFxRateCached}
      isFxRefreshing={isFxRefreshing}
      isFxRateUnavailable={isFxRateUnavailable}
      trend={trend}
      isTrendLoading={isTrendLoading}
      isExporting={isExporting}
      isRefreshing={isRefreshing}
      brokerPortfolioActive={brokerPortfolioActive}
      notice={notice}
      onCopyPositions={copyPositions}
      onExportBackup={() => void exportBackup()}
      onRefresh={() => {
        if (developmentPreviewEnabled) {
          setNotice("当前为本地合成预览，未请求账号或市场数据。");
          return;
        }
        void load(true);
        void refreshFxRate(true);
      }}
      onRetry={() => {
        if (!developmentPreviewEnabled) {
          void load(true);
        }
      }}
      onDelete={deletePosition}
    />
  );
}
