// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LAST_BACKUP_GENERATED_AT_STORAGE_KEY,
  LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY,
  type BrowserDataSafetyEnvironment,
} from "../application/positions/browser/data-safety.ts";
import type { PositionBackupDeliveryResult } from "../application/positions/browser/deliver-position-backup.ts";
import { createBrokerPortfolioBackupDocument } from "../application/brokerage/index.ts";
import {
  createPositionBackupDocument,
  PositionRepositoryError,
  type CashSnapshot,
  type PositionBackupDocument,
  type PositionBackupFile,
  type PositionSnapshot,
} from "../application/positions/index.ts";
import { AAPL } from "../tests/helpers.ts";
import { reconcileBrokerPortfolio } from "../domain/index.ts";
import {
  DataSafetyCenter,
  type DataSafetyRepository,
} from "./data-safety-center.tsx";

const EXPORTED_AT = "2026-08-09T02:00:00Z";
const ACTION_AT = "2026-08-09T03:04:05Z";

const CASH_SNAPSHOT: CashSnapshot = {
  revision: 1,
  savedAt: "2026-08-09T01:30:00Z",
  account: {
    provider: "IBKR",
    currency: "USD",
    balance: "20000",
    netAssetValue: "80000",
    navSource: "USER_ENTERED",
    pricingPlan: "IBKR_PRO",
  },
};

function snapshot(): PositionSnapshot {
  return {
    revision: 1,
    savedAt: "2026-08-09T01:00:00Z",
    batch: {
      instrument: AAPL,
      displayName: "Apple Inc.",
      inputs: [
        {
          id: "aapl-input-1",
          instrument: AAPL,
          quantity: "10",
          costInput: {
            mode: "TOTAL_OPEN_COST",
            value: "1000",
          },
        },
      ],
    },
  };
}

function backupDocument(): PositionBackupDocument {
  return createPositionBackupDocument([snapshot()], EXPORTED_AT);
}

function backupFile(
  contents: string,
  name = "stock-portfolio-backup.json",
): File {
  const file = new File([contents], name, { type: "application/json" });
  if (typeof file.text !== "function") {
    Object.defineProperty(file, "text", {
      value: async () => contents,
    });
  }
  return file;
}

function environment(
  navigatorStorage: BrowserDataSafetyEnvironment["navigatorStorage"] = {
    persisted: async () => true,
  },
) {
  const values = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
  return {
    value: {
      navigatorStorage,
      localStorage,
    } satisfies BrowserDataSafetyEnvironment,
    values,
  };
}

function repository(options: {
  readonly snapshots?: readonly PositionSnapshot[];
  readonly cash?: CashSnapshot | null;
  readonly restoreResult?: {
    readonly positionCount: number;
    readonly cashRestored: boolean;
  };
} = {}) {
  return {
    listSnapshots: vi.fn(async () => options.snapshots ?? []),
    getCashSnapshot: vi.fn(async () => options.cash ?? null),
    restoreCurrentBackup: vi.fn(async () =>
      options.restoreResult ?? {
        positionCount: 1,
        cashRestored: false,
      },
    ),
  } satisfies DataSafetyRepository;
}

async function chooseBackup(contents: string): Promise<void> {
  const input = screen.getByLabelText(/选择 JSON 副本/);
  fireEvent.change(input, {
    target: { files: [backupFile(contents)] },
  });
  await waitFor(() => {
    expect(input).not.toBeDisabled();
  });
}

beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_PORTFOLIO_TARGET", "sites"); });

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
  vi.restoreAllMocks();
});

describe("DataSafetyCenter", () => {
  it("previews and restores a strict dual-broker v3 backup only to an empty target", async () => {
    const book = reconcileBrokerPortfolio(
      null,
      {
        positions: [
          {
            broker: "IBKR",
            instrument: AAPL,
            quantity: "2",
            totalOpenCost: "300",
          },
        ],
        cashAccounts: [
          {
            broker: "IBKR",
            currency: "USD",
            settledBalance: "100",
            pendingBalance: "20",
          },
          {
            broker: "MOOMOO",
            currency: "USD",
            settledBalance: "50",
            pendingBalance: "0",
          },
        ],
        effectiveAt: EXPORTED_AT,
      },
      EXPORTED_AT,
      "baseline",
    );
    const restoreBrokerPortfolioBackup = vi.fn(async () => book);
    const repo = {
      ...repository(),
      getBrokerPortfolioBook: vi.fn(async () => null),
      restoreBrokerPortfolioBackup,
    } satisfies DataSafetyRepository;
    const env = environment();
    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    await chooseBackup(
      JSON.stringify(createBrokerPortfolioBackupDocument(book, EXPORTED_AT)),
    );
    expect(await screen.findByText("v3")).toBeInTheDocument();
    expect(screen.getByText("$170.00")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "核对无误，准备恢复" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /确认恢复这份副本/ }),
    );

    await waitFor(() => expect(restoreBrokerPortfolioBackup).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/双券商现金账本/),
    ).toBeInTheDocument();
  });

  it("previews a valid v2 file and requires a second confirmation before restoring to an empty target", async () => {
    const repo = repository();
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    await chooseBackup(JSON.stringify(backupDocument()));

    expect(
      await screen.findByRole("heading", { name: "恢复前预览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 只股票")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(repo.restoreCurrentBackup).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "核对无误，准备恢复" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "恢复 1 只股票？" }),
    ).toBeInTheDocument();
    expect(repo.restoreCurrentBackup).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /确认恢复这份副本/ }),
    );
    await waitFor(() => {
      expect(repo.restoreCurrentBackup).toHaveBeenCalledTimes(1);
    });
    expect(repo.restoreCurrentBackup).toHaveBeenCalledWith(
      backupDocument(),
    );
  });

  it.each([
    {
      name: "stock",
      repo: repository({ snapshots: [snapshot()] }),
      inventoryLabel: "当前已有 1 只股票，恢复已锁定",
    },
    {
      name: "cash",
      repo: repository({ cash: CASH_SNAPSHOT }),
      inventoryLabel: "当前已有 0 只股票和 1 条现金记录，恢复已锁定",
    },
  ])("keeps restore strictly locked when current $name exists", async ({
    repo,
    inventoryLabel,
  }) => {
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText(inventoryLabel);
    await chooseBackup(JSON.stringify(backupDocument()));
    await screen.findByRole("heading", { name: "恢复前预览" });

    const restore = screen.getByRole("button", {
      name: "当前已有数据，禁止恢复",
    });
    expect(restore).toBeDisabled();
    fireEvent.click(restore);
    expect(repo.restoreCurrentBackup).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects malformed and unsupported-version files before repository restore", async () => {
    const repo = repository();
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    await chooseBackup("{not-json}");
    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("文件不是有效的 JSON");
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveFocus();
    });
    expect(screen.queryByRole("heading", { name: "恢复前预览" }))
      .not.toBeInTheDocument();

    await chooseBackup(
      JSON.stringify({ ...backupDocument(), formatVersion: 1 }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "当前只支持本产品 v2 持仓副本",
    );
    expect(repo.restoreCurrentBackup).not.toHaveBeenCalled();
  });

  it("blocks oversized, unreadable, and valid-empty files before any write", async () => {
    const repo = repository();
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    const input = screen.getByLabelText(/选择 JSON 副本/);
    fireEvent.change(input, {
      target: {
        files: [backupFile("x".repeat(5 * 1024 * 1024 + 1), "too-large.json")],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "文件超过 5 MB 安全上限",
    );

    const unreadable = backupFile("{}", "unreadable.json");
    Object.defineProperty(unreadable, "text", {
      configurable: true,
      value: async () => {
        throw new DOMException("synthetic read failure", "NotReadableError");
      },
    });
    fireEvent.change(input, { target: { files: [unreadable] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法读取这份副本",
    );

    await chooseBackup(
      JSON.stringify(
        createPositionBackupDocument([], EXPORTED_AT, null),
      ),
    );
    expect(
      await screen.findByText("这是一份有效的空副本，不包含可恢复资产。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "空副本无需恢复" }),
    ).toBeDisabled();
    expect(repo.restoreCurrentBackup).not.toHaveBeenCalled();
  });

  it("reports a successful restore and records only the local success time", async () => {
    const repo = repository({
      restoreResult: { positionCount: 1, cashRestored: false },
    });
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    await chooseBackup(JSON.stringify(backupDocument()));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "核对无误，准备恢复",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: /确认恢复这份副本/,
      }),
    );

    expect(
      await screen.findByText(/恢复完成：1 只股票已写入当前登录账号/),
    ).toBeInTheDocument();
    expect(screen.getByText(/最近成功恢复：/)).toBeInTheDocument();
    expect(env.values.get(LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY)).toBe(
      ACTION_AT,
    );
    expect(env.values.has(LAST_BACKUP_GENERATED_AT_STORAGE_KEY)).toBe(
      false,
    );
    const restoredPortfolioLink = await screen.findByRole("link", {
      name: "查看已恢复的总仓位",
    });
    expect(restoredPortfolioLink).toHaveAttribute("href", "/");
    await waitFor(() => {
      expect(restoredPortfolioLink).toHaveFocus();
    });
  });

  it("does not record a cancelled export and records the exact generation time after success", async () => {
    const repo = repository({ snapshots: [snapshot()] });
    const env = environment();
    const deliverBackup = vi
      .fn<
        (
          file: PositionBackupFile,
        ) => Promise<PositionBackupDeliveryResult>
      >()
      .mockResolvedValueOnce("cancelled")
      .mockResolvedValueOnce("downloaded");

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={deliverBackup}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    const exportButton = await screen.findByRole("button", {
      name: "生成当前数据副本",
    });
    fireEvent.click(exportButton);
    expect(
      await screen.findByText("已取消生成副本，当前数据没有被修改。"),
    ).toBeInTheDocument();
    expect(env.values.has(LAST_BACKUP_GENERATED_AT_STORAGE_KEY)).toBe(
      false,
    );

    fireEvent.click(exportButton);
    expect(
      await screen.findByText(/JSON 副本已生成。请到“文件”或 iCloud Drive/),
    ).toBeInTheDocument();
    expect(env.values.get(LAST_BACKUP_GENERATED_AT_STORAGE_KEY)).toBe(
      ACTION_AT,
    );
    expect(deliverBackup).toHaveBeenCalledTimes(2);
    const delivered = deliverBackup.mock.calls[1]?.[0];
    expect(delivered).toBeDefined();
    expect(JSON.parse(delivered!.contents)).toMatchObject({
      exportedAt: ACTION_AT,
      formatVersion: 2,
    });
  });

  it("never reports or delivers an export that the restore contract rejects", async () => {
    const nyseSnapshot: PositionSnapshot = {
      ...snapshot(),
      batch: {
        ...snapshot().batch,
        instrument: { ...AAPL, listingMarket: "NYSE" },
        inputs: snapshot().batch.inputs.map((input) => ({
          ...input,
          id: "nyse-aapl-input-1",
          instrument: { ...AAPL, listingMarket: "NYSE" },
        })),
      },
    };
    const repo = repository({ snapshots: [snapshot(), nyseSnapshot] });
    const env = environment();
    const deliverBackup = vi.fn(
      async (): Promise<PositionBackupDeliveryResult> => "downloaded",
    );

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={deliverBackup}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "生成当前数据副本",
      }),
    );

    expect(
      await screen.findByText(/当前数据不符合可恢复副本规则/),
    ).toBeInTheDocument();
    expect(deliverBackup).not.toHaveBeenCalled();
    expect(env.values.has(LAST_BACKUP_GENERATED_AT_STORAGE_KEY)).toBe(
      false,
    );
  });

  it("labels persistence API failures as unknown without blocking data actions", async () => {
    const repo = repository({ snapshots: [snapshot()] });
    const persisted = vi.fn(async () => {
      throw new DOMException("blocked", "SecurityError");
    });
    const persist = vi.fn(async () => {
      throw new DOMException("blocked", "SecurityError");
    });
    const env = environment({ persisted, persist });

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    expect(
      await screen.findByText("无法确认本机辅助数据保护状态"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "浏览器没有返回可确认结果；这不影响账号云端 current，只影响本机草稿与缓存的保留保证。",
      ),
    ).toBeInTheDocument();
    const request = screen.getByRole("button", {
      name: "请求持久存储保护",
    });
    fireEvent.click(request);
    expect(
      await screen.findByText(
        "浏览器没有返回可确认结果；这不代表授予或拒绝，账号云端 current 未受影响。",
      ),
    ).toBeInTheDocument();
    expect(persisted).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "生成当前数据副本" }),
    ).toBeEnabled();
  });

  it("does not let a stale initial persistence read overwrite a newer granted request", async () => {
    const repo = repository();
    let resolveInitialRead: (value: boolean) => void = () => {
      throw new Error("initial persistence read did not start");
    };
    const persisted = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveInitialRead = resolve;
          }),
      )
      .mockResolvedValueOnce(false);
    const persist = vi.fn(async () => true);
    const env = environment({ persisted, persist });

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    expect(
      screen.getByText("正在确认持久存储状态"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("无法确认本机辅助数据保护状态"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "请求持久存储保护" }),
    );
    expect(
      await screen.findByText("本机草稿与缓存已获持久保护"),
    ).toBeInTheDocument();

    resolveInitialRead(false);
    await waitFor(() => {
      expect(screen.getByText("本机草稿与缓存已获持久保护")).toBeInTheDocument();
      expect(screen.queryByText("本机草稿与缓存为尽力保存")).not.toBeInTheDocument();
    });
    expect(persisted).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("retries inventory after an initial read failure", async () => {
    const repo = repository();
    repo.listSnapshots
      .mockRejectedValueOnce(new Error("synthetic inventory failure"))
      .mockResolvedValueOnce([]);
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "无法确认账号数据" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "无法确认可备份数据" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "重新检查账号数据" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "当前组合完全为空，可以恢复副本",
      }),
    ).toBeInTheDocument();
    expect(repo.listSnapshots).toHaveBeenCalledTimes(2);
    expect(repo.getCashSnapshot).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "重新检查账号数据" }),
    ).not.toBeInTheDocument();
  });

  it("keeps focus inside confirmation, isolates the background, and restores focus on Escape", async () => {
    const repo = repository();
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    await chooseBackup(JSON.stringify(backupDocument()));
    const trigger = await screen.findByRole("button", {
      name: "核对无误，准备恢复",
    });
    const background = trigger.closest<HTMLElement>(".data-safety-sections");
    expect(background).not.toBeNull();
    const previousOverflow = document.body.style.overflow;

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "恢复 1 只股票？",
    });
    const confirm = screen.getByRole("button", {
      name: /确认恢复这份副本/,
    });
    const safeReturn = screen.getByRole("button", {
      name: /返回继续核对/,
    });

    await waitFor(() => {
      expect(safeReturn).toHaveFocus();
    });
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(document.body.style.overflow).toBe("hidden");
    for (
      let ancestor: HTMLElement | null = dialog;
      ancestor !== null;
      ancestor = ancestor.parentElement
    ) {
      expect(ancestor).not.toHaveAttribute("inert");
      expect(ancestor).not.toHaveAttribute("aria-hidden", "true");
    }

    fireEvent.keyDown(document, { key: "Tab" });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(safeReturn).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(background).not.toHaveAttribute("inert");
      expect(background).not.toHaveAttribute("aria-hidden");
      expect(document.body.style.overflow).toBe(previousOverflow);
    });
  });

  it("does not record restore success and focuses the error after a failed transaction", async () => {
    const repo = repository();
    repo.restoreCurrentBackup.mockRejectedValueOnce(
      new Error("synthetic restore failure"),
    );
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    await chooseBackup(JSON.stringify(backupDocument()));
    fireEvent.click(
      screen.getByRole("button", { name: "核对无误，准备恢复" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: /确认恢复这份副本/,
      }),
    );

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "恢复失败，事务已取消；股票和现金都没有被部分写入。请保留原副本后重试。",
    );
    await waitFor(() => {
      expect(error).toHaveFocus();
    });
    expect(repo.restoreCurrentBackup).toHaveBeenCalledTimes(1);
    expect(env.values.has(LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY)).toBe(
      false,
    );
    expect(screen.queryByText(/最近成功恢复：/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "核对无误，准备恢复" }),
    ).toBeEnabled();
  });

  it("locks restore immediately when a concurrent write makes the target non-empty", async () => {
    const repo = repository();
    let resolveInventoryRefresh: (
      snapshots: readonly PositionSnapshot[],
    ) => void = () => {
      throw new Error("inventory refresh did not start");
    };
    repo.listSnapshots
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<readonly PositionSnapshot[]>((resolve) => {
            resolveInventoryRefresh = resolve;
          }),
      );
    repo.restoreCurrentBackup.mockRejectedValueOnce(
      new PositionRepositoryError(
        "BACKUP_RESTORE_TARGET_NOT_EMPTY",
        "synthetic competing write",
      ),
    );
    const env = environment();

    render(
      <DataSafetyCenter
        repository={repo}
        deliverBackup={vi.fn(
          async (): Promise<PositionBackupDeliveryResult> => "downloaded",
        )}
        now={() => ACTION_AT}
        environment={env.value}
      />,
    );

    await screen.findByText("当前组合完全为空，可以恢复副本");
    await chooseBackup(JSON.stringify(backupDocument()));
    fireEvent.click(
      screen.getByRole("button", { name: "核对无误，准备恢复" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: /确认恢复这份副本/,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "检测到另一页面已写入股票或现金，恢复已停止",
    );
    expect(
      screen.getByRole("button", { name: "正在确认目标是否为空" }),
    ).toBeDisabled();
    expect(env.values.has(LAST_SUCCESSFUL_RESTORE_AT_STORAGE_KEY)).toBe(
      false,
    );

    resolveInventoryRefresh([snapshot()]);
    expect(
      await screen.findByRole("heading", {
        name: "当前已有 1 只股票，恢复已锁定",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "当前已有数据，禁止恢复" }),
    ).toBeDisabled();
    expect(repo.restoreCurrentBackup).toHaveBeenCalledTimes(1);
  });
});


describe("storage target disclosure", () => {
  it.each(["provider", "sites"])("describes %s persistence and actual restore destination", async (target) => {
    vi.stubEnv("NEXT_PUBLIC_PORTFOLIO_TARGET", target);
    const repo = repository();
    const env = environment({ persisted: vi.fn(async () => false), persist: vi.fn(async () => false) });
    const deliver = vi.fn(async (): Promise<PositionBackupDeliveryResult> => "downloaded");
    render(<DataSafetyCenter repository={repo} environment={env.value} now={() => ACTION_AT} deliverBackup={deliver} accountDisplayName="synthetic owner" />);
    await screen.findByText("当前组合完全为空，可以恢复副本");
    if (target === "provider") {
      expect(screen.getByText(/这里是当前浏览器旧域名本地数据/)).toBeInTheDocument();
      expect(screen.queryByText(/本机只保留草稿/)).toBeNull();
      expect(screen.queryByText(/当前账号：/)).toBeNull();
      await screen.findByText("本地持仓为尽力保存");
    } else {
      expect(screen.getByText(/当前资产按 ChatGPT 登录账号保存在 Sites 云端/)).toBeInTheDocument();
      await screen.findByText("本机草稿与缓存为尽力保存");
    }
    fireEvent.click(screen.getByRole("button", { name: "请求持久存储保护" }));
    await waitFor(() => expect(env.value.navigatorStorage?.persist).toHaveBeenCalled());
    await chooseBackup(JSON.stringify(backupDocument()));
    expect(screen.getByText(target === "provider" ? /尚未写入当前来源的本地持仓/ : /尚未写入账号云端/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "核对无误，准备恢复" }));
    expect(screen.getByText(target === "provider" ? /同一个 IndexedDB 事务/ : /同一次云端版本检查/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /确认恢复这份副本/ }));
    await screen.findByText(target === "provider" ? /恢复完成：1 只股票已写入当前浏览器、当前来源的本地持仓/ : /恢复完成：1 只股票已写入当前登录账号/);
    expect(repo.restoreCurrentBackup).toHaveBeenCalledTimes(1);
    if (target === "provider") expect(screen.queryByText(/其他设备使用同一账号登录后可见/)).toBeNull();
    // Modal isolation is released by an effect after the success render.
    expect(await screen.findByRole("button", { name: "生成当前数据副本" })).toBeEnabled();
  });
});
