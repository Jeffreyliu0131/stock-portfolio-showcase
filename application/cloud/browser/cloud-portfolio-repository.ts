import {
  createInstrumentKey,
  instrumentKeyId,
  type ApplyBrokerTradeInput,
  type BrokerPortfolioBaselineInput,
  type BrokerPortfolioBook,
  type IbkrUsdCashAccount,
  type InstrumentKey,
} from "../../../domain/index.ts";
import {
  type ApplyBrokerTradeOptions,
  type BrokerPortfolioRepository,
  type ReplaceBrokerPortfolioOptions,
} from "../../brokerage/types.ts";
import {
  type CashRepository,
  type CashSnapshot,
  type ReplaceCashSnapshotOptions,
} from "../../cash/types.ts";
import { IndexedDbPositionRepository } from "../../positions/indexeddb-position-repository.ts";
import {
  type PositionBackupDocument,
  type PositionBackupRestorer,
  type PositionBackupRestoreResult,
} from "../../positions/position-backup.ts";
import {
  PositionRepositoryError,
  type PositionBatch,
  type PositionDraft,
  type PositionEntryDraft,
  type PositionRepository,
  type PositionSnapshot,
  type ReplacePositionBatchOptions,
} from "../../positions/types.ts";
import {
  CLOUD_PORTFOLIO_API_PATH,
  brokerRestoreRequest,
  parseCloudPortfolioMutationResponse,
  parseCloudPortfolioStateView,
  type CloudPortfolioApiError,
} from "../portfolio-api.ts";
import type { CloudPortfolioStateView } from "../portfolio-state.ts";

const CACHE_WINDOW_MS = 250;

async function parseApiError(response: Response): Promise<CloudPortfolioApiError | null> {
  try {
    const value = (await response.json()) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
      candidate.kind !== "CLOUD_PORTFOLIO_ERROR" ||
      typeof candidate.code !== "string" ||
      typeof candidate.message !== "string"
    ) {
      return null;
    }
    return candidate as unknown as CloudPortfolioApiError;
  } catch {
    return null;
  }
}

function repositoryError(
  status: number,
  action: string,
  apiError: CloudPortfolioApiError | null,
): PositionRepositoryError {
  if (status === 401) {
    return new PositionRepositoryError(
      "AUTHENTICATION_REQUIRED",
      apiError?.message ?? "ChatGPT sign-in is required",
    );
  }
  if (status === 409) {
    const code = action.includes("BROKER")
      ? "BROKER_PORTFOLIO_CONFLICT"
      : action.includes("CASH")
        ? "CASH_SNAPSHOT_CONFLICT"
        : action.startsWith("RESTORE")
          ? "BACKUP_RESTORE_TARGET_NOT_EMPTY"
          : "POSITION_SNAPSHOT_CONFLICT";
    return new PositionRepositoryError(
      code,
      apiError?.message ?? "cloud portfolio changed after it was read",
    );
  }
  return new PositionRepositoryError(
    "CLOUD_PORTFOLIO_UNAVAILABLE",
    apiError?.message ?? "cloud portfolio is unavailable",
  );
}

async function readCloudState(): Promise<CloudPortfolioStateView> {
  let response: Response;
  try {
    response = await fetch(CLOUD_PORTFOLIO_API_PATH, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new PositionRepositoryError(
      "CLOUD_PORTFOLIO_UNAVAILABLE",
      "cloud portfolio request failed",
    );
  }
  if (!response.ok) {
    throw repositoryError(response.status, "READ", await parseApiError(response));
  }
  try {
    return parseCloudPortfolioStateView((await response.json()) as unknown);
  } catch {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "cloud portfolio response is invalid",
    );
  }
}

async function mutateCloudState(
  wireRequest: unknown,
  action: string,
): Promise<ReturnType<typeof parseCloudPortfolioMutationResponse>> {
  let response: Response;
  try {
    response = await fetch(CLOUD_PORTFOLIO_API_PATH, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(wireRequest),
    });
  } catch {
    throw new PositionRepositoryError(
      "CLOUD_PORTFOLIO_UNAVAILABLE",
      "cloud portfolio request failed",
    );
  }
  if (!response.ok) {
    throw repositoryError(response.status, action, await parseApiError(response));
  }
  try {
    const result = parseCloudPortfolioMutationResponse(
      (await response.json()) as unknown,
    );
    if (result.action !== action) {
      throw new Error("cloud mutation action mismatch");
    }
    return result;
  } catch {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "cloud portfolio response is invalid",
    );
  }
}

export class CloudPortfolioRepository
  implements
    PositionRepository,
    CashRepository,
    PositionBackupRestorer,
    BrokerPortfolioRepository
{
  readonly #drafts: IndexedDbPositionRepository;
  #statePromise: Promise<CloudPortfolioStateView> | null = null;
  #stateReadAt = 0;

  constructor(draftRepository = new IndexedDbPositionRepository()) {
    this.#drafts = draftRepository;
  }

  #remember(state: CloudPortfolioStateView): CloudPortfolioStateView {
    this.#stateReadAt = Date.now();
    this.#statePromise = Promise.resolve(state);
    return state;
  }

  #state(force = false): Promise<CloudPortfolioStateView> {
    if (
      !force &&
      this.#statePromise !== null &&
      Date.now() - this.#stateReadAt <= CACHE_WINDOW_MS
    ) {
      return this.#statePromise;
    }
    const request = readCloudState();
    this.#statePromise = request;
    this.#stateReadAt = Date.now();
    void request.catch(() => {
      if (this.#statePromise === request) {
        this.#statePromise = null;
      }
    });
    return request;
  }

  async #mutate(wireRequest: unknown, action: string) {
    const result = await mutateCloudState(wireRequest, action);
    this.#remember(result.state);
    return result;
  }

  async listSnapshots(): Promise<readonly PositionSnapshot[]> {
    return (await this.#state()).snapshots;
  }

  async getSnapshot(instrumentInput: InstrumentKey): Promise<PositionSnapshot | null> {
    const key = instrumentKeyId(createInstrumentKey(instrumentInput));
    return (
      (await this.#state()).snapshots.find(
        (snapshot) => instrumentKeyId(snapshot.batch.instrument) === key,
      ) ?? null
    );
  }

  async getPreviousSnapshot(
    instrumentInput: InstrumentKey,
  ): Promise<PositionSnapshot | null> {
    const key = instrumentKeyId(createInstrumentKey(instrumentInput));
    return (
      (await this.#state()).previousSnapshots.find(
        (snapshot) => instrumentKeyId(snapshot.batch.instrument) === key,
      ) ?? null
    );
  }

  async replaceBatch(
    batch: PositionBatch,
    options: ReplacePositionBatchOptions = {},
  ): Promise<PositionSnapshot> {
    const result = await this.#mutate(
      { action: "REPLACE_BATCH", batch, options },
      "REPLACE_BATCH",
    );
    const key = instrumentKeyId(batch.instrument);
    const snapshot = result.state.snapshots.find(
      (candidate) => instrumentKeyId(candidate.batch.instrument) === key,
    );
    if (snapshot === undefined) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        "cloud position was not returned after replacement",
      );
    }
    return snapshot;
  }

  async addInputsToBatch(
    batch: PositionBatch,
    options: ReplacePositionBatchOptions = {},
  ): Promise<PositionSnapshot> {
    const result = await this.#mutate(
      { action: "ADD_INPUTS", batch, options },
      "ADD_INPUTS",
    );
    const key = instrumentKeyId(batch.instrument);
    const snapshot = result.state.snapshots.find(
      (candidate) => instrumentKeyId(candidate.batch.instrument) === key,
    );
    if (snapshot === undefined) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        "cloud position was not returned after adding inputs",
      );
    }
    return snapshot;
  }

  async deleteSnapshot(
    instrument: InstrumentKey,
    options: ReplacePositionBatchOptions = {},
  ): Promise<boolean> {
    const result = await this.#mutate(
      { action: "DELETE_POSITION", instrument, options },
      "DELETE_POSITION",
    );
    if (result.changed) {
      await this.#drafts.clearDraft(instrument).catch(() => undefined);
    }
    return result.changed;
  }

  async undoLatest(instrument: InstrumentKey): Promise<PositionSnapshot | null> {
    const result = await this.#mutate(
      { action: "UNDO_POSITION", instrument },
      "UNDO_POSITION",
    );
    if (!result.changed) {
      return null;
    }
    const key = instrumentKeyId(instrument);
    return (
      result.state.snapshots.find(
        (snapshot) => instrumentKeyId(snapshot.batch.instrument) === key,
      ) ?? null
    );
  }

  getDraft(instrument: InstrumentKey): Promise<PositionDraft | null> {
    return this.#drafts.getDraft(instrument);
  }

  saveDraft(batch: PositionBatch): Promise<PositionDraft> {
    return this.#drafts.saveDraft(batch);
  }

  clearDraft(instrument: InstrumentKey): Promise<void> {
    return this.#drafts.clearDraft(instrument);
  }

  getEntryDraft(): Promise<PositionEntryDraft | null> {
    return this.#drafts.getEntryDraft();
  }

  saveEntryDraft(draft: PositionEntryDraft): Promise<PositionEntryDraft> {
    return this.#drafts.saveEntryDraft(draft);
  }

  clearEntryDraft(): Promise<void> {
    return this.#drafts.clearEntryDraft();
  }

  async getCashSnapshot(): Promise<CashSnapshot | null> {
    return (await this.#state()).cash;
  }

  async getPreviousCashSnapshot(): Promise<CashSnapshot | null> {
    return (await this.#state()).previousCash;
  }

  async replaceCashAccount(
    account: IbkrUsdCashAccount,
    options: ReplaceCashSnapshotOptions = {},
  ): Promise<CashSnapshot> {
    const result = await this.#mutate(
      { action: "REPLACE_CASH", account, options },
      "REPLACE_CASH",
    );
    if (result.state.cash === null) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        "cloud cash was not returned after replacement",
      );
    }
    return result.state.cash;
  }

  async deleteCashSnapshot(
    options: ReplaceCashSnapshotOptions = {},
  ): Promise<boolean> {
    return (
      await this.#mutate(
        { action: "DELETE_CASH", options },
        "DELETE_CASH",
      )
    ).changed;
  }

  async getBrokerPortfolioBook(): Promise<BrokerPortfolioBook | null> {
    return (await this.#state()).brokerBook;
  }

  async getPreviousBrokerPortfolioBook(): Promise<BrokerPortfolioBook | null> {
    return (await this.#state()).previousBrokerBook;
  }

  async replaceBrokerPortfolioBaseline(
    baseline: BrokerPortfolioBaselineInput,
    options: ReplaceBrokerPortfolioOptions,
  ): Promise<BrokerPortfolioBook> {
    const result = await this.#mutate(
      { action: "RECONCILE_BROKER", baseline, options },
      "RECONCILE_BROKER",
    );
    if (result.state.brokerBook === null) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        "cloud broker book was not returned after reconciliation",
      );
    }
    return result.state.brokerBook;
  }

  async applyBrokerTrade(
    trade: ApplyBrokerTradeInput,
    options: ApplyBrokerTradeOptions,
  ): Promise<BrokerPortfolioBook> {
    const result = await this.#mutate(
      { action: "APPLY_BROKER_TRADE", trade, options },
      "APPLY_BROKER_TRADE",
    );
    if (result.state.brokerBook === null) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        "cloud broker book was not returned after trade",
      );
    }
    return result.state.brokerBook;
  }

  async restoreCurrentBackup(
    backup: PositionBackupDocument,
  ): Promise<PositionBackupRestoreResult> {
    const result = await this.#mutate(
      { action: "RESTORE_V2", backup },
      "RESTORE_V2",
    );
    return {
      positionCount: result.state.snapshots.length,
      cashRestored: result.state.cash !== null,
    };
  }

  async restoreBrokerPortfolioBackup(
    book: BrokerPortfolioBook,
  ): Promise<BrokerPortfolioBook> {
    const request = brokerRestoreRequest(book, new Date().toISOString());
    const result = await this.#mutate(request, "RESTORE_V3");
    if (result.state.brokerBook === null) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        "cloud broker book was not returned after restore",
      );
    }
    return result.state.brokerBook;
  }
}
