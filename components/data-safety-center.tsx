"use client";

import { portfolioTarget } from "../application/runtime/build-target.ts";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  readDataSafetyMetadata,
  readStoragePersistenceStatus,
  recordBackupGeneratedAt,
  recordSuccessfulRestoreAt,
  requestStoragePersistence,
  type BrowserDataSafetyEnvironment,
  type DataSafetyMetadata,
  type StoragePersistenceStatus,
} from "../application/positions/browser/data-safety.ts";
import {
  deliverPositionBackup,
  type PositionBackupDeliveryResult,
} from "../application/positions/browser/deliver-position-backup.ts";
import {
  PositionBackupValidationError,
  PositionRepositoryError,
  createPositionBackupDocument,
  createPositionBackupFile,
  createPositionBackupPreview,
  parsePositionBackupJson,
  type CashSnapshot,
  type PositionBackupDocument,
  type PositionBackupFile,
  type PositionBackupPreview,
  type PositionBackupRestoreResult,
  type PositionSnapshot,
} from "../application/positions/index.ts";
import { createPortfolioRepository } from "../application/portfolio-repository.ts";
import {
  BROKER_PORTFOLIO_BACKUP_FORMAT,
  BrokerPortfolioBackupValidationError,
  createBrokerPortfolioBackupDocument,
  createBrokerPortfolioBackupFile,
  parseBrokerPortfolioBackupJson,
  projectBrokerPortfolioSnapshots,
  type BrokerPortfolioBackupDocument,
} from "../application/brokerage/index.ts";
import {
  Decimal,
  totalBrokerCashBalance,
  type BrokerPortfolioBook,
} from "../domain/index.ts";
import { formatQuantity, formatUsd } from "../ui/position-preview.ts";
import {
  isolateModalSiblings,
  trapModalTabKey,
} from "./modal-accessibility.ts";

const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEWED_POSITIONS = 100;

export interface DataSafetyRepository {
  listSnapshots(): Promise<readonly PositionSnapshot[]>;
  getCashSnapshot(): Promise<CashSnapshot | null>;
  restoreCurrentBackup(
    backup: PositionBackupDocument,
  ): Promise<PositionBackupRestoreResult>;
  getBrokerPortfolioBook?(): Promise<BrokerPortfolioBook | null>;
  restoreBrokerPortfolioBackup?(
    book: BrokerPortfolioBook,
  ): Promise<BrokerPortfolioBook>;
}

export interface DataSafetyCenterProps {
  readonly accountDisplayName?: string;
  readonly repository?: DataSafetyRepository;
  readonly now?: () => string;
  readonly deliverBackup?: (
    file: PositionBackupFile,
  ) => Promise<PositionBackupDeliveryResult>;
  readonly environment?: BrowserDataSafetyEnvironment;
}

interface CurrentInventory {
  readonly positionCount: number;
  readonly hasCash: boolean;
  readonly hasBrokerBook: boolean;
}

interface LegacyRestoreCandidate {
  readonly kind: "LEGACY";
  readonly fileName: string;
  readonly document: PositionBackupDocument;
  readonly preview: PositionBackupPreview;
}

interface BrokerRestoreCandidate {
  readonly kind: "BROKER";
  readonly fileName: string;
  readonly document: BrokerPortfolioBackupDocument;
  readonly preview: {
    readonly positionCount: number;
    readonly sourcePositionCount: number;
    readonly cashAccountCount: number;
    readonly totalQuantity: string;
    readonly totalOpenCost: string;
    readonly totalCash: string;
  };
}

type RestoreCandidate = LegacyRestoreCandidate | BrokerRestoreCandidate;

type Feedback = {
  readonly tone: "error" | "success" | "info";
  readonly message: string;
} | null;

function formatLocalTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

function formatCurrencyAmount(currency: string, value: string): string {
  return currency === "USD"
    ? formatUsd(value)
    : `${currency} ${formatQuantity(value)}`;
}

function inventoryLabel(inventory: CurrentInventory): string {
  if (
    inventory.positionCount === 0 &&
    !inventory.hasCash &&
    !inventory.hasBrokerBook
  ) {
    return "当前组合完全为空，可以恢复副本";
  }
  return inventory.hasBrokerBook
    ? `当前已有双券商账本（${inventory.positionCount} 只合并股票），恢复已锁定`
    : `当前已有 ${inventory.positionCount} 只股票${
        inventory.hasCash ? "和 1 条现金记录" : ""
      }，恢复已锁定`;
}

function persistenceCopy(status: StoragePersistenceStatus, cloud: boolean): {
  readonly title: string;
  readonly detail: string;
} {
  if (!cloud) {
    const local = {
      persistent: { title: "本地持仓已获持久保护", detail: "浏览器已授予当前来源持久存储，但主动清除网站数据仍会删除本地持仓。请保留 JSON 副本；这不提供云端备份或跨设备同步。" },
      "best-effort": { title: "本地持仓为尽力保存", detail: "浏览器可能清理当前来源的本地持仓、草稿与缓存。请导出 JSON 副本；这些资产尚未迁移到 Sites。" },
      unknown: { title: "无法确认本地持仓保护状态", detail: "浏览器没有返回可确认结果，不能认定已授予或拒绝保护。请导出 JSON 副本；本地持仓没有云端同步保证。" },
      unsupported: { title: "浏览器不支持本机持久状态查询", detail: "无法确认当前来源的本地持仓是否受保护。请导出 JSON 副本；这些资产尚未迁移到 Sites。" },
    };
    return local[status];
  }
  if (status === "persistent") {
    return {
      title: "本机草稿与缓存已获持久保护",
      detail:
        "账号 current 已保存在云端；这个状态只影响本机草稿、行情与汇率缓存。JSON 副本仍是独立恢复路径。",
    };
  }
  if (status === "best-effort") {
    return {
      title: "本机草稿与缓存为尽力保存",
      detail:
        "浏览器可能清理本机草稿与缓存，但不会因此删除账号云端 current。仍建议保留可带走的 JSON 副本。",
    };
  }
  if (status === "unknown") {
    return {
      title: "无法确认本机辅助数据保护状态",
      detail:
        "浏览器没有返回可确认结果；这不影响账号云端 current，只影响本机草稿与缓存的保留保证。",
    };
  }
  return {
    title: "浏览器不支持本机持久状态查询",
    detail:
      "无法确认本机草稿与缓存是否受保护；账号云端 current 与此状态分离。",
  };
}

function backupValidationMessage(error: unknown): string {
  if (error instanceof BrokerPortfolioBackupValidationError) {
    return error.code === "UNSUPPORTED_BACKUP_VERSION"
      ? "当前只支持本产品双券商 JSON v3，未写入任何数据。"
      : "双券商副本无效或字段不完整，未写入任何数据。";
  }
  if (!(error instanceof PositionBackupValidationError)) {
    return "无法读取这份副本。请选择由本产品生成、内容完整的 JSON 文件。";
  }
  switch (error.code) {
    case "INVALID_JSON":
      return "文件不是有效的 JSON，未写入任何数据。";
    case "INVALID_BACKUP_FORMAT":
      return "文件不是本产品生成的持仓副本，未写入任何数据。";
    case "UNSUPPORTED_BACKUP_VERSION":
      return "当前只支持本产品 v2 持仓副本，未写入任何数据。";
    case "DUPLICATE_INSTRUMENT":
      return "副本中存在重复标的，无法安全恢复；未写入任何数据。";
    case "INVALID_BACKUP_CONTENT":
      return "副本字段缺失、包含未知字段或无效数据，未写入任何数据。";
  }
}

function candidateAssetLabel(preview: PositionBackupPreview): string {
  return `${preview.positionCount} 只股票${
    preview.cash === null ? "" : " + 1 条 IBKR USD 现金"
  }`;
}

export function DataSafetyCenter({
  accountDisplayName,
  repository: repositoryInput,
  now = () => new Date().toISOString(),
  deliverBackup = deliverPositionBackup,
  environment,
}: DataSafetyCenterProps) {
  const cloud = portfolioTarget() === "sites";
  const dataLabel = cloud ? "账号数据" : "本地数据";
  const repositoryRef = useRef<DataSafetyRepository | null>(null);
  repositoryRef.current ??=
    repositoryInput ?? createPortfolioRepository();
  const repository = repositoryRef.current;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const confirmDialog = useRef<HTMLElement | null>(null);
  const restoreTrigger = useRef<HTMLButtonElement | null>(null);
  const feedbackTarget = useRef<HTMLParagraphElement | null>(null);
  const successLink = useRef<HTMLAnchorElement | null>(null);
  const isRestoringRef = useRef(false);
  const isRequestingPersistenceRef = useRef(false);
  const persistenceSequence = useRef(0);
  const [inventory, setInventory] = useState<CurrentInventory | null>(null);
  const [inventoryError, setInventoryError] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<StoragePersistenceStatus>("unknown");
  const [isCheckingPersistence, setIsCheckingPersistence] = useState(true);
  const [metadata, setMetadata] = useState<DataSafetyMetadata>({
    lastBackupGeneratedAt: null,
    lastSuccessfulRestoreAt: null,
  });
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingInventory, setIsCheckingInventory] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isRequestingPersistence, setIsRequestingPersistence] =
    useState(false);
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResult, setRestoreResult] =
    useState<{ positionCount: number; cashRestored: boolean; brokerRestored?: boolean } | null>(null);

  const refreshInventory = useCallback(async () => {
    setIsCheckingInventory(true);
    try {
      const [snapshots, cash, brokerBook] = await Promise.all([
        repository.listSnapshots(),
        repository.getCashSnapshot(),
        repository.getBrokerPortfolioBook?.() ?? Promise.resolve(null),
      ]);
      const nextInventory = {
        positionCount:
          brokerBook === null
            ? snapshots.length
            : projectBrokerPortfolioSnapshots(brokerBook).length,
        hasCash: cash !== null,
        hasBrokerBook: brokerBook !== null,
      };
      setInventory(nextInventory);
      setInventoryError(false);
      return nextInventory;
    } catch {
      setInventory(null);
      setInventoryError(true);
      return null;
    } finally {
      setIsCheckingInventory(false);
    }
  }, [repository]);

  useEffect(() => {
    let active = true;
    const sequence = persistenceSequence.current + 1;
    persistenceSequence.current = sequence;
    setIsCheckingPersistence(true);
    setMetadata(readDataSafetyMetadata(environment));
    void readStoragePersistenceStatus(environment).then((status) => {
      if (active && persistenceSequence.current === sequence) {
        setPersistenceStatus(status);
        setIsCheckingPersistence(false);
      }
    });
    void refreshInventory();
    return () => {
      active = false;
    };
  }, [environment, refreshInventory]);

  useEffect(() => {
    isRestoringRef.current = isRestoring;
  }, [isRestoring]);

  useEffect(() => {
    if (restoreResult === null) {
      return;
    }
    const frame = requestAnimationFrame(() => successLink.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [restoreResult]);

  useEffect(() => {
    if (!isConfirmingRestore) {
      return;
    }
    const dialog = confirmDialog.current;
    if (dialog === null) {
      return;
    }
    const releaseIsolation = isolateModalSiblings(dialog);
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        trapModalTabKey(event, dialog);
      } else if (event.key === "Escape" && !isRestoringRef.current) {
        event.preventDefault();
        setIsConfirmingRestore(false);
        requestAnimationFrame(() => restoreTrigger.current?.focus());
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      releaseIsolation();
    };
  }, [isConfirmingRestore]);

  const requestPersistence = async () => {
    if (isRequestingPersistenceRef.current) {
      return;
    }
    isRequestingPersistenceRef.current = true;
    const sequence = persistenceSequence.current + 1;
    persistenceSequence.current = sequence;
    setIsRequestingPersistence(true);
    try {
      const status = await requestStoragePersistence(environment);
      if (persistenceSequence.current !== sequence) {
        return;
      }
      setPersistenceStatus(status);
      setIsCheckingPersistence(false);
      setFeedback({
        tone: status === "persistent" ? "success" : "info",
        message: !cloud
          ? persistenceCopy(status, false).detail
          : status === "persistent"
            ? "浏览器已确认本机辅助数据持久存储；账号云端 current 未受影响。"
            : status === "best-effort"
              ? "浏览器没有授予本机持久存储；账号云端 current 未受影响。"
              : status === "unknown"
                ? "浏览器没有返回可确认结果；这不代表授予或拒绝，账号云端 current 未受影响。"
                : "当前浏览器不支持请求持久存储；账号云端 current 未受影响。",
      });
    } finally {
      isRequestingPersistenceRef.current = false;
      setIsRequestingPersistence(false);
    }
  };

  const exportCurrentBackup = async () => {
    if (isExporting || inventory === null || inventoryError) {
      return;
    }
    setIsExporting(true);
    setFeedback(null);
    try {
      const brokerBook = await (
        repository.getBrokerPortfolioBook?.() ?? Promise.resolve(null)
      );
      if (brokerBook !== null) {
        const backup = createBrokerPortfolioBackupDocument(brokerBook, now());
        const result = await deliverBackup(
          createBrokerPortfolioBackupFile(backup),
        );
        if (result === "cancelled") {
          setFeedback({
            tone: "info",
            message: "已取消生成副本，双券商账本没有被修改。",
          });
          return;
        }
        recordBackupGeneratedAt(backup.exportedAt, environment);
        setMetadata(readDataSafetyMetadata(environment));
        setFeedback({
          tone: "success",
          message:
            "双券商 JSON v3 副本已生成。请到“文件”或 iCloud Drive 确认文件确实存在。",
        });
        return;
      }
      const [snapshots, cash] = await Promise.all([
        repository.listSnapshots(),
        repository.getCashSnapshot(),
      ]);
      if (snapshots.length === 0 && cash === null) {
        setInventory({ positionCount: 0, hasCash: false, hasBrokerBook: false });
        setFeedback({
          tone: "info",
          message: "当前没有可备份的股票或现金记录。",
        });
        return;
      }
      const backup = createPositionBackupDocument(
        snapshots,
        now(),
        cash,
      );
      const result = await deliverBackup(createPositionBackupFile(backup));
      if (result === "cancelled") {
        setFeedback({
          tone: "info",
          message: "已取消生成副本，当前数据没有被修改。",
        });
        return;
      }
      recordBackupGeneratedAt(backup.exportedAt, environment);
      setMetadata(readDataSafetyMetadata(environment));
      setFeedback({
        tone: "success",
        message:
          "JSON 副本已生成。请到“文件”或 iCloud Drive 确认文件确实存在，再把它视为可用备份。",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof PositionBackupValidationError
            ? "当前数据不符合可恢复副本规则（存在不受支持、重复或同代码多市场的标的），未生成文件。请先回到首页核对这些股票；现有数据未修改。"
            : "未能生成副本，当前股票和现金记录都没有被修改。",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const readBackupFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setCandidate(null);
    setRestoreResult(null);
    setFeedback(null);
    setIsConfirmingRestore(false);
    if (file === undefined) {
      return;
    }
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setFeedback({
        tone: "error",
        message: "文件超过 5 MB 安全上限，未读取且未写入任何数据。",
      });
      event.target.value = "";
      return;
    }
    setIsReadingFile(true);
    try {
      const contents = await file.text();
      let isEmptyLegacyBackup = false;
      let parsedFormat: unknown = null;
      try {
        parsedFormat = (JSON.parse(contents) as { format?: unknown }).format;
      } catch {
        // The strict parser below owns the user-facing invalid JSON error.
      }
      if (parsedFormat === BROKER_PORTFOLIO_BACKUP_FORMAT) {
        const document = parseBrokerPortfolioBackupJson(contents);
        const snapshots = projectBrokerPortfolioSnapshots(document.book);
        const totalQuantity = document.book.positions.reduce(
          (total, position) => total.add(position.quantity),
          new Decimal(0),
        );
        const totalOpenCost = document.book.positions.reduce(
          (total, position) => total.add(position.totalOpenCost),
          new Decimal(0),
        );
        setCandidate({
          kind: "BROKER",
          fileName: file.name,
          document,
          preview: {
            positionCount: snapshots.length,
            sourcePositionCount: document.book.positions.length,
            cashAccountCount: document.book.cashAccounts.length,
            totalQuantity: totalQuantity.toString(),
            totalOpenCost: totalOpenCost.toString(),
            totalCash: totalBrokerCashBalance(document.book),
          },
        });
      } else {
        const document = parsePositionBackupJson(contents);
        const preview = createPositionBackupPreview(document);
        isEmptyLegacyBackup =
          preview.positionCount === 0 && preview.cash === null;
        setCandidate({ kind: "LEGACY", fileName: file.name, document, preview });
      }
      setFeedback({
        tone: "info",
        message: isEmptyLegacyBackup
          ? "这是一份有效的空副本，不包含可恢复资产。"
          : `副本已在当前设备完成结构与数值校验。请核对下方内容；尚未写入${cloud ? "账号云端" : "当前来源的本地持仓"}。`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: backupValidationMessage(error),
      });
      requestAnimationFrame(() => feedbackTarget.current?.focus());
      event.target.value = "";
    } finally {
      setIsReadingFile(false);
    }
  };

  const beginRestoreConfirmation = () => {
    if (
      candidate === null ||
      isRestoringRef.current ||
      isCheckingInventory ||
      inventory === null ||
      inventory.positionCount > 0 ||
      inventory.hasCash ||
      inventory.hasBrokerBook ||
      (candidate.kind === "LEGACY" &&
        candidate.preview.positionCount === 0 &&
        candidate.preview.cash === null)
    ) {
      return;
    }
    setIsConfirmingRestore(true);
  };

  const restoreCandidate = async () => {
    if (candidate === null || isRestoringRef.current) {
      return;
    }
    isRestoringRef.current = true;
    setIsRestoring(true);
    setFeedback(null);
    try {
      const result =
        candidate.kind === "BROKER"
          ? {
              positionCount: candidate.preview.positionCount,
              cashRestored: true,
              brokerRestored: true,
              book: await (() => {
                if (repository.restoreBrokerPortfolioBackup === undefined) {
                  throw new Error("broker restore is unavailable");
                }
                return repository.restoreBrokerPortfolioBackup(
                  candidate.document.book,
                );
              })(),
            }
          : await repository.restoreCurrentBackup(candidate.document);
      const restoredAt = now();
      recordSuccessfulRestoreAt(restoredAt, environment);
      setMetadata(readDataSafetyMetadata(environment));
      setInventory({
        positionCount: result.positionCount,
        hasCash: result.cashRestored,
        hasBrokerBook: "brokerRestored" in result,
      });
      setRestoreResult(result);
      setIsConfirmingRestore(false);
      setFeedback({
        tone: "success",
        message: `恢复完成：${result.positionCount} 只股票${
          "brokerRestored" in result
            ? "及双券商现金账本"
            : result.cashRestored
              ? "和 1 条现金记录"
              : ""
        }${cloud ? "已写入当前登录账号。其他设备使用同一账号登录后可见" : "已写入当前浏览器、当前来源的本地持仓，尚未迁移到 Sites，也不会自动出现在其他设备"}；行情与人民币汇率会重新获取。`,
      });
    } catch (error) {
      setIsConfirmingRestore(false);
      if (
        error instanceof PositionRepositoryError &&
        error.code === "BACKUP_RESTORE_TARGET_NOT_EMPTY"
      ) {
        setInventory(null);
        setInventoryError(false);
        setFeedback({
          tone: "error",
          message:
            "检测到另一页面已写入股票或现金，恢复已停止；这份副本没有合并或覆盖现有数据。",
        });
        requestAnimationFrame(() => feedbackTarget.current?.focus());
        await refreshInventory();
      } else {
        setFeedback({
          tone: "error",
          message:
            "恢复失败，事务已取消；股票和现金都没有被部分写入。请保留原副本后重试。",
        });
        requestAnimationFrame(() => feedbackTarget.current?.focus());
      }
    } finally {
      isRestoringRef.current = false;
      setIsRestoring(false);
    }
  };

  const persistence = isRequestingPersistence
    ? {
        title: "正在请求持久存储保护",
        detail:
          cloud ? "浏览器正在处理本机草稿与缓存保护请求；账号云端股票与现金不会因此被修改。" : "浏览器正在处理当前来源的本地持仓保护请求；这不会上传或迁移任何资产。",
      }
    : isCheckingPersistence
      ? {
          title: "正在确认持久存储状态",
          detail:
            cloud ? "浏览器正在读取本机草稿与缓存保护状态；这不会修改账号云端股票与现金。" : "浏览器正在读取当前来源的本地持仓保护状态；这不会上传或迁移任何资产。",
        }
      : persistenceCopy(persistenceStatus, cloud);
  const canExport =
    inventory !== null &&
    !inventoryError &&
    (inventory.positionCount > 0 || inventory.hasCash || inventory.hasBrokerBook);
  const canRestore =
    candidate !== null &&
    !isRestoring &&
    !isCheckingInventory &&
    inventory !== null &&
    !inventoryError &&
    inventory.positionCount === 0 &&
    !inventory.hasCash &&
    !inventory.hasBrokerBook &&
    (candidate.kind === "BROKER" ||
      candidate.preview.positionCount > 0 ||
      candidate.preview.cash !== null) &&
    restoreResult === null;

  return (
    <main className="app-shell app-shell--form precision-form data-safety-center">
      <header className="form-header">
        <a className="icon-link" href="/" aria-label="返回总仓位">
          返回
        </a>
        <div>
          <p className="eyebrow">{dataLabel}</p>
          <h1>数据安全与恢复</h1>
        </div>
        <span className="form-header__spacer" aria-hidden="true" />
      </header>

      <section className="data-safety-summary" aria-labelledby="safety-summary-title">
        <p className="eyebrow">当前状态</p>
        <h2 id="safety-summary-title">
          {inventory === null
            ? inventoryError
              ? `无法确认${dataLabel}`
              : `正在检查${dataLabel}`
            : inventoryLabel(inventory)}
        </h2>
        <p>
          {cloud ? "当前资产按 ChatGPT 登录账号保存在 Sites 云端，使用同一账号的设备会读取同一份 current。JSON 在当前设备先严格校验，只有确认恢复后才写入这个账号。" : "这里是当前浏览器旧域名本地数据，只保存在当前浏览器的当前来源。它们尚未迁移到 Sites，不会按 ChatGPT 账号跨设备同步。请先生成 JSON 副本，再到 Sites 登录并在完全空的账号中确认恢复。"}
          {cloud && accountDisplayName ? ` 当前账号：${accountDisplayName}。` : ""}
        </p>
        {inventoryError ? (
          <button
            className="data-safety-summary__retry"
            type="button"
            disabled={isCheckingInventory}
            aria-busy={isCheckingInventory}
            onClick={() => void refreshInventory()}
          >
            {isCheckingInventory ? "正在重新检查…" : `重新检查${dataLabel}`}
          </button>
        ) : null}
      </section>

      {feedback ? (
        <p
          className={`data-safety-feedback data-safety-feedback--${feedback.tone}`}
          ref={feedbackTarget}
          role={feedback.tone === "error" ? "alert" : "status"}
          tabIndex={-1}
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="data-safety-sections">
        <section className="form-section" aria-labelledby="persistence-heading">
          <div className="form-section__heading">
            <span>1</span>
            <div>
              <h2 id="persistence-heading">{cloud ? "账号云端与本机辅助数据" : "当前来源的本地持仓保护"}</h2>
              <p>{cloud ? "持仓 current 以账号云端为真值；本机只保留草稿、行情与汇率缓存。" : "持仓与现金保存在本机 IndexedDB；清除网站数据、更换浏览器或设备可能无法再读取，持久存储不等于备份。"}</p>
            </div>
          </div>
          <div className={`storage-status storage-status--${persistenceStatus}`}>
            <strong>{persistence.title}</strong>
            <p>{persistence.detail}</p>
          </div>
          {persistenceStatus !== "persistent" ? (
            <button
              className="button button--secondary button--full"
              type="button"
              disabled={isRequestingPersistence}
              aria-busy={isRequestingPersistence}
              onClick={() => void requestPersistence()}
            >
              {isRequestingPersistence ? "正在请求…" : "请求持久存储保护"}
            </button>
          ) : null}
        </section>

        <section className="form-section" aria-labelledby="backup-heading">
          <div className="form-section__heading">
            <span>2</span>
            <div>
              <h2 id="backup-heading">生成可带走的 JSON 副本</h2>
              <p>旧组合生成 v2；双券商账本生成 v3，包含来源持仓、两边现金与 current 维护事件，不包含行情或汇率缓存。</p>
            </div>
          </div>
          <dl className="data-safety-facts">
            <div>
              <dt>最近生成</dt>
              <dd>
                {metadata.lastBackupGeneratedAt === null
                  ? "当前设备尚无记录"
                  : formatLocalTime(metadata.lastBackupGeneratedAt)}
              </dd>
            </div>
            <div>
              <dt>确认方式</dt>
              <dd>到“文件”或 iCloud Drive 检查文件是否存在</dd>
            </div>
          </dl>
          <button
            className="button button--primary button--full"
            type="button"
            disabled={!canExport || isExporting}
            aria-busy={isExporting}
            onClick={() => void exportCurrentBackup()}
          >
            {isExporting
              ? "正在生成…"
              : canExport
                ? "生成当前数据副本"
                : inventoryError
                  ? "无法确认可备份数据"
                  : "当前没有可备份数据"}
          </button>
        </section>

        <section className="form-section" aria-labelledby="restore-heading">
          <div className="form-section__heading">
            <span>3</span>
            <div>
              <h2 id="restore-heading">校验并恢复副本</h2>
              <p>先在当前设备校验和预览，再二次确认；只写入完全空的{cloud ? "账号" : "当前来源本地"}组合，不合并、不覆盖。</p>
            </div>
          </div>
          <label className="backup-file-picker" htmlFor="backup-file">
            <strong>{isReadingFile ? "正在校验…" : "选择 JSON 副本"}</strong>
            <span>最大 5 MB · 确认前只在当前设备读取</span>
          </label>
          <input
            className="sr-only"
            ref={fileInput}
            id="backup-file"
            type="file"
            accept=".json,application/json"
            disabled={isReadingFile || isRestoring}
            onChange={(event) => void readBackupFile(event)}
          />

          {candidate ? (
            <article className="backup-preview" aria-labelledby="backup-preview-title">
              <div className="backup-preview__heading">
                <div>
                  <p className="eyebrow">结构与数值已校验</p>
                  <h3 id="backup-preview-title">恢复前预览</h3>
                </div>
                <span>{candidate.kind === "BROKER" ? "v3" : "v2"}</span>
              </div>
              {candidate.kind === "BROKER" ? (
                <dl className="data-safety-facts data-safety-facts--preview">
                  <div><dt>文件</dt><dd>{candidate.fileName}</dd></div>
                  <div><dt>副本记录时间</dt><dd>{formatLocalTime(candidate.document.exportedAt)}</dd></div>
                  <div><dt>合并股票</dt><dd>{candidate.preview.positionCount} 只</dd></div>
                  <div><dt>券商持仓分项</dt><dd>{candidate.preview.sourcePositionCount} 条</dd></div>
                  <div><dt>总股数</dt><dd>{formatQuantity(candidate.preview.totalQuantity)}</dd></div>
                  <div><dt>股票剩余成本</dt><dd>{formatUsd(candidate.preview.totalOpenCost)}</dd></div>
                  <div><dt>双券商账面现金</dt><dd>{formatUsd(candidate.preview.totalCash)}</dd></div>
                </dl>
              ) : (
                <>
                  <dl className="data-safety-facts data-safety-facts--preview">
                    <div>
                      <dt>文件</dt>
                      <dd>{candidate.fileName}</dd>
                    </div>
                    <div>
                      <dt>副本记录时间</dt>
                      <dd>{formatLocalTime(candidate.preview.exportedAt)}</dd>
                    </div>
                    <div>
                      <dt>资产内容</dt>
                      <dd>{candidateAssetLabel(candidate.preview)}</dd>
                    </div>
                    <div>
                      <dt>原始录入</dt>
                      <dd>{candidate.preview.inputCount} 条</dd>
                    </div>
                    {candidate.preview.currencyTotals.map((total) => (
                      <div key={total.currency}>
                        <dt>{total.currency} 记录本金</dt>
                        <dd>{formatCurrencyAmount(total.currency, total.recordedPrincipal)}</dd>
                      </div>
                    ))}
                  </dl>

                  {candidate.preview.positions.length > 0 ? (
                <div className="backup-preview__positions" role="list" aria-label="副本股票明细">
                  {candidate.preview.positions
                    .slice(0, MAX_PREVIEWED_POSITIONS)
                    .map((position) => (
                      <div
                        key={`${position.instrument.listingMarket}:${position.instrument.symbol}:${position.instrument.currency}`}
                        className="backup-preview__position"
                        role="listitem"
                      >
                        <div>
                          <strong>{position.instrument.symbol}</strong>
                          <span>{position.displayName ?? position.instrument.listingMarket}</span>
                        </div>
                        <dl>
                          <div>
                            <dt>数量</dt>
                            <dd className="numeric">{formatQuantity(position.quantity)}</dd>
                          </div>
                          <div>
                            <dt>剩余成本</dt>
                            <dd className="numeric">
                              {formatCurrencyAmount(position.instrument.currency, position.openCost)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  {candidate.preview.positions.length > MAX_PREVIEWED_POSITIONS ? (
                    <p>
                      另有 {candidate.preview.positions.length - MAX_PREVIEWED_POSITIONS} 只股票已校验，未在本页展开。
                    </p>
                  ) : null}
                </div>
                  ) : null}

                  {candidate.preview.cash ? (
                <div className="backup-preview__cash">
                  <div>
                    <strong>IBKR USD 现金</strong>
                    <span>{candidate.preview.cash.account.pricingPlan === "IBKR_PRO" ? "IBKR Pro" : "IBKR Lite"}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>余额</dt>
                      <dd className="numeric">{formatUsd(candidate.preview.cash.account.balance)}</dd>
                    </div>
                    <div>
                      <dt>NAV</dt>
                      <dd className="numeric">{formatUsd(candidate.preview.cash.account.netAssetValue)}</dd>
                    </div>
                  </dl>
                </div>
                  ) : null}
                </>
              )}

              <p className="backup-preview__boundary">
                行情、上一有效价和 USD/CNY 汇率不在副本内；恢复后首页会重新获取。草稿和历史版本不会恢复。JSON 没有数字签名，结构合法不代表内容未被手工改动，请逐项核对。
              </p>
              <button
                className="button button--danger-outline button--full"
                ref={restoreTrigger}
                type="button"
                disabled={!canRestore}
                onClick={beginRestoreConfirmation}
              >
                {restoreResult !== null
                  ? "这份副本已恢复"
                  : isCheckingInventory
                    ? "正在确认目标是否为空"
                    : isRestoring
                      ? "正在完成恢复…"
                      : inventory === null
                        ? "无法确认目标是否为空"
                        : inventory.positionCount > 0 || inventory.hasCash || inventory.hasBrokerBook
                          ? "当前已有数据，禁止恢复"
                          : candidate.kind === "LEGACY" && candidate.preview.positionCount === 0 && candidate.preview.cash === null
                            ? "空副本无需恢复"
                            : "核对无误，准备恢复"}
              </button>
            </article>
          ) : null}

          {metadata.lastSuccessfulRestoreAt ? (
            <p className="data-safety-last-restore">
              最近成功恢复：{formatLocalTime(metadata.lastSuccessfulRestoreAt)}
            </p>
          ) : null}
          {restoreResult ? (
            <a
              className="button button--primary button--full"
              ref={successLink}
              href="/"
            >
              查看已恢复的总仓位
            </a>
          ) : null}
        </section>
      </div>

      <footer className="data-safety-boundary">
        <strong>恢复边界</strong>
        <p>
          v2 只恢复旧 current；v3 恢复双券商 current book 与其维护事件。确认后只把规范化 current 写入{cloud ? "当前登录账号" : "当前来源的本地持仓"}；不生成长期收益，也不会合并或覆盖现有组合。
        </p>
      </footer>

      {isConfirmingRestore && candidate ? (
        <div
          className="action-sheet-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !isRestoring) {
              setIsConfirmingRestore(false);
              requestAnimationFrame(() => restoreTrigger.current?.focus());
            }
          }}
        >
          <section
            className="action-sheet data-safety-confirm"
            ref={confirmDialog}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="restore-confirm-title"
            aria-describedby="restore-confirm-description"
          >
            <div className="action-sheet__heading">
              <p>最后一次写入前确认</p>
              <h2 id="restore-confirm-title">
                恢复 {candidate.kind === "BROKER"
                  ? `${candidate.preview.positionCount} 只股票与双券商现金账本`
                  : candidateAssetLabel(candidate.preview)}？
              </h2>
            </div>
            <p className="action-sheet__description" id="restore-confirm-description">
              {cloud ? "系统会在同一次云端版本检查中再次确认账号组合为空，再原子写入；冲突或失败时不写入任何资产。" : "系统会在同一个 IndexedDB 事务中再次确认本地组合为空，再一起写入；任何一步失败都会取消整个事务。"}
            </p>
            <div className="action-sheet__confirm-actions">
              <button
                className="action-sheet__button action-sheet__button--danger"
                type="button"
                disabled={isRestoring}
                aria-busy={isRestoring}
                onClick={() => void restoreCandidate()}
              >
                <strong>{isRestoring ? "正在恢复…" : "确认恢复这份副本"}</strong>
                <span>只写入当前完全空的组合</span>
              </button>
              <button
                className="action-sheet__button"
                type="button"
                data-autofocus
                disabled={isRestoring}
                onClick={() => {
                  setIsConfirmingRestore(false);
                  requestAnimationFrame(() => restoreTrigger.current?.focus());
                }}
              >
                <strong>返回继续核对</strong>
                <span>不写入任何数据</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
