import {
  IDBFactory,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  BROKER_PORTFOLIO_STORE,
  CASH_ACCOUNT_STORE,
  INDEXED_DB_POSITION_SCHEMA_VERSION,
  IndexedDbPositionRepository,
  LEGACY_BROKER_LEDGER_STORE,
  POSITION_BATCH_STORE,
  POSITION_DRAFT_STORE,
  createPositionBackupDocument,
  loadUnifiedPositions,
  type CashSnapshot,
  type PositionBatch,
  type PositionBackupDocument,
  type PositionSnapshot,
} from "../application/positions/index.ts";
import { instrumentKeyId } from "../domain/index.ts";
import { AAPL, MSFT } from "./helpers.ts";

function databaseName(testName: string): string {
  return `position-test-${testName}`;
}

function batch(
  quantity: string,
  costValue: string,
  options: {
    readonly id?: string;
    readonly instrument?: typeof AAPL;
    readonly mode?: "AVERAGE_COST" | "TOTAL_OPEN_COST";
    readonly displayName?: string;
  } = {},
): PositionBatch {
  const instrument = options.instrument ?? AAPL;
  return {
    instrument,
    ...(options.displayName === undefined
      ? {}
      : { displayName: options.displayName }),
    inputs: [
      {
        id: options.id ?? "input-1",
        instrument,
        quantity,
        costInput: {
          mode: options.mode ?? "TOTAL_OPEN_COST",
          value: costValue,
        },
      },
    ],
  };
}

function clock(...timestamps: readonly string[]): () => string {
  let index = 0;
  return () => {
    const timestamp = timestamps[index];
    if (timestamp === undefined) {
      throw new Error("test clock exhausted");
    }
    index += 1;
    return timestamp;
  };
}

function openLegacyDatabase(
  factory: IDBFactory,
  name: string,
  record: unknown,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("ledger_entries", {
        keyPath: "key",
      });
      store.add(record);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function openVersionTwoDatabaseWithPosition(
  factory: IDBFactory,
  name: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      const positionStore = database.createObjectStore(
        POSITION_BATCH_STORE,
        { keyPath: "key" },
      );
      const draftStore = database.createObjectStore(POSITION_DRAFT_STORE, {
        keyPath: "key",
      });
      const legacyStore = database.createObjectStore(LEGACY_BROKER_LEDGER_STORE, {
        keyPath: "backupId",
        autoIncrement: true,
      });
      positionStore.put({
        key: instrumentKeyId(AAPL),
        current: {
          revision: 1,
          savedAt: "2026-08-01T10:00:00Z",
          batch: batch("10", "1000", {
            displayName: "Apple Inc.",
          }),
        },
        previous: null,
        nextRevision: 2,
      });
      draftStore.put({
        key: instrumentKeyId(AAPL),
        draft: {
          savedAt: "2026-08-01T10:05:00Z",
          batch: batch("12", "1200", {
            displayName: "Apple draft",
          }),
        },
      });
      legacyStore.add({
        sourceStore: "ledger_entries",
        sourceKey: "legacy-aapl",
        record: { marker: "preserve-me" },
      });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

describe("IndexedDbPositionRepository", () => {
  it("restores current stock and cash snapshots together into an empty target", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("restore-current-backup"),
    });
    const savedDraft = await repository.saveDraft(
      batch("99", "9999", { displayName: "Local draft" }),
    );
    const aapl: PositionSnapshot = {
      revision: 4,
      savedAt: "2026-08-08T02:00:00Z",
      batch: batch("10.5", "1050", {
        displayName: "Apple Inc.",
      }),
    };
    const msft: PositionSnapshot = {
      revision: 2,
      savedAt: "2026-08-08T02:01:00Z",
      batch: batch("2", "800", {
        id: "msft-input",
        instrument: MSFT,
        displayName: "Microsoft Corp.",
      }),
    };
    const cash: CashSnapshot = {
      revision: 3,
      savedAt: "2026-08-08T02:02:00Z",
      account: {
        provider: "IBKR",
        currency: "USD",
        balance: "25000",
        netAssetValue: "90000",
        navSource: "USER_ENTERED",
        pricingPlan: "IBKR_PRO",
      },
    };
    const backup = createPositionBackupDocument(
      [msft, aapl],
      "2026-08-09T02:00:00Z",
      cash,
    );

    await expect(repository.restoreCurrentBackup(backup)).resolves.toEqual({
      positionCount: 2,
      cashRestored: true,
    });
    expect(await repository.listSnapshots()).toEqual([
      { ...aapl, revision: 1 },
      { ...msft, revision: 1 },
    ]);
    expect(await repository.getCashSnapshot()).toEqual({
      ...cash,
      revision: 1,
    });
    expect(await repository.getPreviousSnapshot(AAPL)).toBeNull();
    expect(await repository.getPreviousSnapshot(MSFT)).toBeNull();
    expect(await repository.getPreviousCashSnapshot()).toBeNull();
    expect(await repository.getDraft(AAPL)).toEqual(savedDraft);

    await expect(
      repository.replaceBatch(batch("11", "1100"), {
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(
      repository.replaceCashAccount(
        { ...cash.account, balance: "26000" },
        { expectedRevision: 1 },
      ),
    ).resolves.toMatchObject({ revision: 2 });
    await repository.close();
  });

  it("starts restored local revisions at one even when source revisions are near the safe-integer limit", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("restore-resets-local-revisions"),
    });
    const backup = createPositionBackupDocument(
      [
        {
          revision: Number.MAX_SAFE_INTEGER - 1,
          savedAt: "2026-08-08T02:00:00Z",
          batch: batch("10", "1000"),
        },
      ],
      "2026-08-09T02:00:00Z",
      {
        revision: Number.MAX_SAFE_INTEGER - 1,
        savedAt: "2026-08-08T02:01:00Z",
        account: {
          provider: "IBKR",
          currency: "USD",
          balance: "20000",
          netAssetValue: "80000",
          navSource: "USER_ENTERED",
          pricingPlan: "IBKR_PRO",
        },
      },
    );

    await repository.restoreCurrentBackup(backup);
    expect(await repository.getSnapshot(AAPL)).toMatchObject({ revision: 1 });
    expect(await repository.getCashSnapshot()).toMatchObject({ revision: 1 });
    await expect(
      repository.replaceBatch(batch("11", "1100"), {
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(
      repository.replaceCashAccount(
        {
          ...backup.cash!.account,
          balance: "21000",
        },
        { expectedRevision: 1 },
      ),
    ).resolves.toMatchObject({ revision: 2 });
    await repository.close();
  });

  it.each(["position", "cash"] as const)(
    "rejects restore when the target already contains %s",
    async (existingKind) => {
      const repository = new IndexedDbPositionRepository({
        indexedDB: new IDBFactory(),
        databaseName: databaseName(`restore-non-empty-${existingKind}`),
      });
      if (existingKind === "position") {
        await repository.replaceBatch(batch("1", "100"));
      } else {
        await repository.replaceCashAccount({
          provider: "IBKR",
          currency: "USD",
          balance: "10000",
          netAssetValue: "10000",
          navSource: "CASH_BALANCE_FALLBACK",
          pricingPlan: "IBKR_LITE",
        });
      }
      const existingPositions = await repository.listSnapshots();
      const existingCash = await repository.getCashSnapshot();
      const backup = createPositionBackupDocument(
        [
          {
            revision: 1,
            savedAt: "2026-08-08T03:00:00Z",
            batch: batch("2", "500", {
              id: "msft-input",
              instrument: MSFT,
            }),
          },
        ],
        "2026-08-09T03:00:00Z",
      );

      await expect(
        repository.restoreCurrentBackup(backup),
      ).rejects.toMatchObject({
        code: "BACKUP_RESTORE_TARGET_NOT_EMPTY",
      });
      expect(await repository.listSnapshots()).toEqual(existingPositions);
      expect(await repository.getCashSnapshot()).toEqual(existingCash);
      await repository.close();
    },
  );

  it("serializes competing empty-target restores so exactly one succeeds", async () => {
    const factory = new IDBFactory();
    const name = databaseName("restore-race");
    const firstRepository = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
    });
    const secondRepository = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
    });
    const firstBackup = createPositionBackupDocument(
      [
        {
          revision: 1,
          savedAt: "2026-08-08T04:00:00Z",
          batch: batch("1", "100", { id: "first" }),
        },
      ],
      "2026-08-09T04:00:00Z",
    );
    const secondBackup = createPositionBackupDocument(
      [
        {
          revision: 1,
          savedAt: "2026-08-08T04:01:00Z",
          batch: batch("2", "600", {
            id: "second",
            instrument: MSFT,
          }),
        },
      ],
      "2026-08-09T04:01:00Z",
    );

    const outcomes = await Promise.allSettled([
      firstRepository.restoreCurrentBackup(firstBackup),
      secondRepository.restoreCurrentBackup(secondBackup),
    ]);

    expect(outcomes.filter(({ status }) => status === "fulfilled"))
      .toHaveLength(1);
    const [rejected] = outcomes.filter(
      ({ status }) => status === "rejected",
    );
    expect(rejected).toMatchObject({
      reason: { code: "BACKUP_RESTORE_TARGET_NOT_EMPTY" },
    });
    expect(await firstRepository.listSnapshots()).toHaveLength(1);
    await firstRepository.close();
    await secondRepository.close();
  });

  it("rolls back every restored snapshot when either store write fails", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("restore-write-failure"),
    });
    const backup = createPositionBackupDocument(
      [
        {
          revision: 1,
          savedAt: "2026-08-08T05:00:00Z",
          batch: batch("1", "100"),
        },
      ],
      "2026-08-09T05:00:00Z",
      {
        revision: 1,
        savedAt: "2026-08-08T05:01:00Z",
        account: {
          provider: "IBKR",
          currency: "USD",
          balance: "12000",
          netAssetValue: "12000",
          navSource: "CASH_BALANCE_FALLBACK",
          pricingPlan: "IBKR_PRO",
        },
      },
    );
    const objectStorePrototype = FakeIDBObjectStore.prototype as unknown as {
      add(
        this: IDBObjectStore,
        value: unknown,
      ): IDBRequest<IDBValidKey>;
    };
    const originalAdd = objectStorePrototype.add;
    objectStorePrototype.add = function add(value) {
      if (this.name === CASH_ACCOUNT_STORE) {
        throw new DOMException(
          "synthetic cash restore failure",
          "QuotaExceededError",
        );
      }
      return originalAdd.call(this, value);
    };

    try {
      await expect(
        repository.restoreCurrentBackup(backup),
      ).rejects.toMatchObject({
        code: "INDEXED_DB_TRANSACTION_FAILED",
      });
    } finally {
      objectStorePrototype.add = originalAdd;
    }
    expect(await repository.listSnapshots()).toEqual([]);
    expect(await repository.getCashSnapshot()).toBeNull();
    await repository.close();
  });

  it("validates restore input before opening a write transaction", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("restore-invalid-input"),
    });
    const valid = createPositionBackupDocument(
      [],
      "2026-08-09T06:00:00Z",
    );
    const invalid = {
      ...valid,
      drafts: [],
    } as unknown as PositionBackupDocument;

    await expect(
      repository.restoreCurrentBackup(invalid),
    ).rejects.toMatchObject({ code: "INVALID_BACKUP_CONTENT" });
    expect(await repository.listSnapshots()).toEqual([]);
    expect(await repository.getCashSnapshot()).toBeNull();
    await repository.close();
  });

  it("stores IBKR cash independently with optimistic revisions", async () => {
    const factory = new IDBFactory();
    const name = databaseName("cash-revisions");
    const repository = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
      now: clock(
        "2026-08-02T01:00:00Z",
        "2026-08-02T01:01:00Z",
        "2026-08-02T01:02:00Z",
        "2026-08-02T01:03:00Z",
      ),
    });
    const savedPosition = await repository.replaceBatch(
      batch("10", "1000"),
    );
    const first = await repository.replaceCashAccount(
      {
        provider: "IBKR",
        currency: "USD",
        balance: "20000",
        netAssetValue: "80000",
        navSource: "USER_ENTERED",
        pricingPlan: "IBKR_PRO",
      },
      { expectedRevision: null },
    );
    const second = await repository.replaceCashAccount(
      {
        ...first.account,
        balance: "25000",
      },
      { expectedRevision: first.revision },
    );

    expect(second).toMatchObject({
      revision: 2,
      account: { balance: "25000" },
    });
    expect(await repository.getPreviousCashSnapshot()).toEqual(first);
    await expect(
      repository.replaceCashAccount(first.account, {
        expectedRevision: first.revision,
      }),
    ).rejects.toMatchObject({ code: "CASH_SNAPSHOT_CONFLICT" });
    expect(await repository.getCashSnapshot()).toEqual(second);
    expect(await repository.getSnapshot(AAPL)).toEqual(savedPosition);

    await expect(
      repository.deleteCashSnapshot({
        expectedRevision: second.revision,
      }),
    ).resolves.toBe(true);
    expect(await repository.getCashSnapshot()).toBeNull();
    expect(await repository.getSnapshot(AAPL)).toEqual(savedPosition);
    await repository.close();
  });

  it("stores the broker baseline beside legacy current data and applies trades atomically", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("broker-portfolio"),
      now: clock(
        "2026-08-20T01:00:00Z",
        "2026-08-20T02:00:00Z",
        "2026-08-20T03:00:00Z",
        "2026-08-20T04:00:00Z",
      ),
    });
    const legacy = await repository.replaceBatch(batch("10", "1000"));

    const baseline = await repository.replaceBrokerPortfolioBaseline(
      {
        positions: [
          {
            broker: "IBKR",
            instrument: AAPL,
            displayName: "Apple Inc.",
            quantity: "6",
            totalOpenCost: "600",
          },
          {
            broker: "MOOMOO",
            instrument: AAPL,
            displayName: "Apple Inc.",
            quantity: "4",
            totalOpenCost: "400",
          },
        ],
        cashAccounts: [
          {
            broker: "IBKR",
            currency: "USD",
            settledBalance: "1000",
            pendingBalance: "0",
          },
          {
            broker: "MOOMOO",
            currency: "USD",
            settledBalance: "500",
            pendingBalance: "0",
          },
        ],
        effectiveAt: "2026-08-20T01:00:00Z",
      },
      { expectedRevision: null, eventId: "baseline" },
    );
    const traded = await repository.applyBrokerTrade(
      {
        id: "sell-aapl",
        side: "SELL",
        broker: "IBKR",
        instrument: AAPL,
        quantity: "2",
        unitPrice: "120",
        fee: "1",
        cashStatus: "PENDING",
        effectiveAt: "2026-08-20T02:00:00Z",
      },
      { expectedRevision: baseline.revision },
    );

    expect(traded).toMatchObject({
      revision: 2,
      cashAccounts: expect.arrayContaining([
        expect.objectContaining({
          broker: "IBKR",
          settledBalance: "1000",
          pendingBalance: "239",
        }),
      ]),
    });
    expect(await repository.getPreviousBrokerPortfolioBook()).toEqual(
      baseline,
    );
    expect(await repository.getSnapshot(AAPL)).toEqual(legacy);
    await expect(
      repository.applyBrokerTrade(
        {
          id: "stale-trade",
          side: "BUY",
          broker: "MOOMOO",
          instrument: AAPL,
          quantity: "1",
          unitPrice: "100",
          cashStatus: "SETTLED",
          effectiveAt: "2026-08-20T03:00:00Z",
        },
        { expectedRevision: baseline.revision },
      ),
    ).rejects.toMatchObject({ code: "BROKER_PORTFOLIO_CONFLICT" });
    expect(await repository.getBrokerPortfolioBook()).toEqual(traded);
    await repository.close();
  });

  it("restores a broker book only when legacy and broker current stores are all empty", async () => {
    const factory = new IDBFactory();
    const source = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: databaseName("broker-backup-source"),
      now: clock("2026-08-20T01:00:00Z"),
    });
    const book = await source.replaceBrokerPortfolioBaseline(
      {
        positions: [
          {
            broker: "MOOMOO",
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
            pendingBalance: "0",
          },
          {
            broker: "MOOMOO",
            currency: "USD",
            settledBalance: "200",
            pendingBalance: "0",
          },
        ],
        effectiveAt: "2026-08-20T01:00:00Z",
      },
      { expectedRevision: null, eventId: "baseline" },
    );
    const target = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: databaseName("broker-backup-target"),
      now: clock("2026-08-21T01:00:00Z", "2026-08-21T02:00:00Z"),
    });

    const restored = await target.restoreBrokerPortfolioBackup({
      ...book,
      revision: 99,
    });
    expect(restored).toMatchObject({ revision: 1 });
    expect(await target.getPreviousBrokerPortfolioBook()).toBeNull();

    await expect(
      target.restoreBrokerPortfolioBackup(book),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_TARGET_NOT_EMPTY" });
    await source.close();
    await target.close();
  });

  it("adds the cash store when upgrading schema v2 without rewriting positions", async () => {
    const factory = new IDBFactory();
    const name = databaseName("v2-to-v3-cash-store");
    await openVersionTwoDatabaseWithPosition(factory, name);

    const repository = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
      now: clock("2026-08-02T02:00:00Z"),
    });
    const original = await repository.getSnapshot(AAPL);
    expect(original).toMatchObject({
      revision: 1,
      batch: {
        displayName: "Apple Inc.",
        inputs: [{ quantity: "10" }],
      },
    });
    expect(await repository.getCashSnapshot()).toBeNull();
    expect(await repository.getDraft(AAPL)).toMatchObject({
      savedAt: "2026-08-01T10:05:00Z",
      batch: {
        displayName: "Apple draft",
        inputs: [{ quantity: "12" }],
      },
    });
    expect(await repository.listLegacyBrokerLedgerBackups()).toEqual([
      {
        sourceKey: "legacy-aapl",
        record: { marker: "preserve-me" },
      },
    ]);

    await repository.replaceCashAccount({
      provider: "IBKR",
      currency: "USD",
      balance: "15000",
      netAssetValue: "15000",
      navSource: "CASH_BALANCE_FALLBACK",
      pricingPlan: "IBKR_PRO",
    });
    expect(await repository.getSnapshot(AAPL)).toEqual(original);
    expect(await repository.getDraft(AAPL)).toMatchObject({
      batch: { displayName: "Apple draft" },
    });
    expect(await repository.listLegacyBrokerLedgerBackups()).toHaveLength(1);
    await repository.close();

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(
        name,
        INDEXED_DB_POSITION_SCHEMA_VERSION,
      );
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(database.objectStoreNames.contains(CASH_ACCOUNT_STORE)).toBe(
      true,
    );
    expect(database.objectStoreNames.contains(BROKER_PORTFOLIO_STORE)).toBe(
      true,
    );
    expect(database.objectStoreNames.contains(POSITION_BATCH_STORE)).toBe(
      true,
    );
    database.close();
  });

  it("replaces one whole instrument batch and restores the previous version", async () => {
    const factory = new IDBFactory();
    const name = databaseName("replace-undo");
    const repository = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
      now: clock(
        "2026-07-30T01:00:00Z",
        "2026-07-30T01:01:00Z",
      ),
    });

    const first = await repository.replaceBatch(
      batch("10", "1000", { displayName: "Apple" }),
      { expectedRevision: null },
    );
    expect(await repository.getPreviousSnapshot(AAPL)).toBeNull();
    const second = await repository.replaceBatch(
      batch("12.5", "1300", { displayName: "Apple Inc." }),
      { expectedRevision: first.revision },
    );

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(await repository.getPreviousSnapshot(AAPL)).toEqual(first);
    expect((await repository.listSnapshots())[0]?.batch.inputs[0])
      .toMatchObject({ quantity: "12.5" });
    expect(second.batch.displayName).toBe("Apple Inc.");

    await repository.close();
    const reopened = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
    });
    expect(await reopened.getSnapshot(AAPL)).toEqual(second);
    expect(await reopened.getPreviousSnapshot(AAPL)).toEqual(first);

    const restored = await reopened.undoLatest(AAPL);
    expect(restored).toEqual(first);
    expect(await reopened.getPreviousSnapshot(AAPL)).toBeNull();
    expect(await reopened.undoLatest(AAPL)).toBeNull();
    await reopened.close();
  });

  it("atomically adds repeated inputs to the same instrument batch", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("add-same-instrument"),
      now: clock(
        "2026-07-30T01:10:00Z",
        "2026-07-30T01:11:00Z",
      ),
    });
    const first = await repository.addInputsToBatch(
      batch("10", "100", {
        mode: "AVERAGE_COST",
        displayName: "Apple Inc.",
      }),
    );

    const merged = await repository.addInputsToBatch(
      batch("5", "120", {
        mode: "AVERAGE_COST",
        displayName: "Apple Inc.",
      }),
    );

    expect(merged.revision).toBe(2);
    expect(merged.batch.inputs).toHaveLength(2);
    expect(new Set(merged.batch.inputs.map(({ id }) => id)).size).toBe(2);
    expect(await repository.getPreviousSnapshot(AAPL)).toEqual(first);
    const [position] = await loadUnifiedPositions(repository);
    expect(position).toMatchObject({
      quantity: "15",
      openCost: "1600",
    });
    expect(
      new Decimal(position?.averageCost ?? "0").toFixed(2),
    ).toBe("106.67");
    await repository.close();
  });

  it("replaces one instrument batch without changing other instruments", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("instrument-isolation"),
      now: clock(
        "2026-07-30T01:20:00Z",
        "2026-07-30T01:21:00Z",
        "2026-07-30T01:22:00Z",
      ),
    });
    const firstAapl = await repository.replaceBatch(
      batch("10", "1000"),
    );
    const msft = await repository.replaceBatch(
      batch("2", "600", {
        id: "msft-input",
        instrument: MSFT,
      }),
    );
    await repository.replaceBatch(batch("12", "1260"), {
      expectedRevision: firstAapl.revision,
    });

    expect(await repository.getSnapshot(MSFT)).toEqual(msft);
    expect(await repository.getPreviousSnapshot(MSFT)).toBeNull();
    expect(await repository.listSnapshots()).toHaveLength(2);
    await repository.close();
  });

  it("deletes only the confirmed instrument and clears its saved draft", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("delete-instrument"),
      now: clock(
        "2026-07-30T01:30:00Z",
        "2026-07-30T01:31:00Z",
        "2026-07-30T01:32:00Z",
        "2026-07-30T01:33:00Z",
      ),
    });
    const first = await repository.replaceBatch(
      batch("10", "1000"),
    );
    const current = await repository.replaceBatch(
      batch("12", "1260"),
      { expectedRevision: first.revision },
    );
    const msft = await repository.replaceBatch(
      batch("2", "600", {
        id: "msft-input",
        instrument: MSFT,
      }),
    );
    await repository.saveDraft(batch("99", "9999"));

    await expect(
      repository.deleteSnapshot(AAPL, {
        expectedRevision: first.revision,
      }),
    ).rejects.toMatchObject({
      code: "POSITION_SNAPSHOT_CONFLICT",
    });
    expect(await repository.getSnapshot(AAPL)).toEqual(current);

    await expect(
      repository.deleteSnapshot(AAPL, {
        expectedRevision: current.revision,
      }),
    ).resolves.toBe(true);
    expect(await repository.getSnapshot(AAPL)).toBeNull();
    expect(await repository.getPreviousSnapshot(AAPL)).toBeNull();
    expect(await repository.getDraft(AAPL)).toBeNull();
    expect(await repository.getSnapshot(MSFT)).toEqual(msft);
    await expect(repository.deleteSnapshot(AAPL)).resolves.toBe(
      false,
    );
    await repository.close();
  });

  it("rejects a stale read before it can overwrite a newer batch", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("optimistic-revision"),
      now: clock(
        "2026-07-30T01:10:00Z",
        "2026-07-30T01:11:00Z",
        "2026-07-30T01:12:00Z",
      ),
    });
    const first = await repository.replaceBatch(
      batch("10", "1000"),
      { expectedRevision: null },
    );
    const second = await repository.replaceBatch(
      batch("11", "1100"),
      { expectedRevision: first.revision },
    );

    await expect(
      repository.replaceBatch(batch("99", "9999"), {
        expectedRevision: first.revision,
      }),
    ).rejects.toMatchObject({
      code: "POSITION_SNAPSHOT_CONFLICT",
    });
    expect(await repository.getSnapshot(AAPL)).toEqual(second);
    await repository.close();
  });

  it("keeps drafts separate from committed snapshots", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("draft-separation"),
      now: clock(
        "2026-07-30T02:00:00Z",
        "2026-07-30T02:01:00Z",
      ),
    });
    const draftBatch = batch("10.00", "100.00", {
      mode: "AVERAGE_COST",
    });
    const committedBatch = batch("12", "1200");

    const draft = await repository.saveDraft(draftBatch);
    await repository.replaceBatch(committedBatch);

    expect(await repository.getDraft(AAPL)).toEqual(draft);
    expect((await repository.getSnapshot(AAPL))?.batch).toEqual(
      committedBatch,
    );

    await repository.clearDraft(AAPL);
    expect(await repository.getDraft(AAPL)).toBeNull();
    expect(await repository.getSnapshot(AAPL)).not.toBeNull();
    await repository.close();
  });

  it("restores a legacy entry draft with only a top-level cost mode unchanged", async () => {
    const factory = new IDBFactory();
    const name = databaseName("raw-entry-draft");
    const rawDraft = {
      symbol: "",
      displayName: "",
      listingMarket: "",
      currency: "",
      costMode: "average",
      rows: [
        {
          id: "position-input-1",
          quantity: "",
          costValue: "",
        },
      ],
    };
    const firstConnection = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
    });

    expect(await firstConnection.saveEntryDraft(rawDraft)).toEqual(
      rawDraft,
    );
    expect(await firstConnection.listSnapshots()).toEqual([]);
    await firstConnection.close();

    const reopened = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
      now: clock("2026-07-30T02:10:00Z"),
    });
    expect(await reopened.getEntryDraft()).toEqual(rawDraft);
    const committed = await reopened.replaceBatch(
      batch("1", "100"),
    );
    expect(await reopened.getEntryDraft()).toEqual(rawDraft);

    await reopened.clearEntryDraft();
    expect(await reopened.getEntryDraft()).toBeNull();
    expect(await reopened.getSnapshot(AAPL)).toEqual(committed);
    await reopened.close();
  });

  it("persists independent cost modes for every raw draft row", async () => {
    const factory = new IDBFactory();
    const name = databaseName("raw-entry-draft-row-cost-modes");
    const rawDraft = {
      symbol: "AAPL",
      displayName: "Apple Inc.",
      listingMarket: "NASDAQ",
      currency: "USD",
      costMode: "average",
      rows: [
        {
          id: "position-input-1",
          quantity: "10",
          costValue: "100",
          costMode: "average",
        },
        {
          id: "position-input-2",
          quantity: "5",
          costValue: "600",
          costMode: "total",
        },
      ],
    };
    const firstConnection = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
    });

    expect(await firstConnection.saveEntryDraft(rawDraft)).toEqual(
      rawDraft,
    );
    await firstConnection.close();

    const reopened = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
    });
    expect(await reopened.getEntryDraft()).toEqual(rawDraft);
    await reopened.close();
  });

  it("rejects oversized raw draft fields without persisting them", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("raw-entry-draft-limits"),
    });

    await expect(
      repository.saveEntryDraft({
        symbol: "A".repeat(33),
        displayName: "",
        listingMarket: "",
        currency: "",
        costMode: "",
        rows: [],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PERSISTED_POSITION_DATA",
    });
    expect(await repository.getEntryDraft()).toBeNull();
    await repository.close();
  });

  it("rejects duplicate raw draft row ids", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("raw-entry-draft-duplicate-ids"),
    });

    await expect(
      repository.saveEntryDraft({
        symbol: "AAPL",
        displayName: "",
        listingMarket: "NASDAQ",
        currency: "USD",
        costMode: "average",
        rows: [
          {
            id: "position-input-1",
            quantity: "1",
            costValue: "100",
          },
          {
            id: "position-input-1",
            quantity: "2",
            costValue: "110",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PERSISTED_POSITION_DATA",
    });
    expect(await repository.getEntryDraft()).toBeNull();
    await repository.close();
  });

  it("loads only committed batches and keeps full instrument keys separate", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("instrument-keys"),
      now: clock(
        "2026-07-30T03:00:00Z",
        "2026-07-30T03:01:00Z",
        "2026-07-30T03:02:00Z",
      ),
    });
    const otherMarketAapl = {
      ...AAPL,
      listingMarket: "SYNTHETIC-OTHER",
    };
    await repository.replaceBatch(batch("1", "100"));
    await repository.replaceBatch(
      batch("2", "220", {
        id: "other-market",
        instrument: otherMarketAapl,
      }),
    );
    await repository.saveDraft(
      batch("99", "9999", {
        id: "draft-msft",
        instrument: MSFT,
      }),
    );

    const positions = await loadUnifiedPositions(repository);
    expect(positions).toHaveLength(2);
    expect(positions.map((position) => position.quantity)).toEqual([
      "1",
      "2",
    ]);
    expect(
      positions.map((position) => position.instrument.listingMarket),
    ).toEqual(["NASDAQ", "SYNTHETIC-OTHER"]);
    await repository.close();
  });

  it("aborts a failed replacement without changing the current snapshot", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: databaseName("write-failure"),
      now: clock(
        "2026-07-30T04:00:00Z",
        "2026-07-30T04:01:00Z",
      ),
    });
    const first = await repository.replaceBatch(batch("10", "1000"));
    const objectStorePrototype = FakeIDBObjectStore.prototype as unknown as {
      put(
        this: IDBObjectStore,
        value: unknown,
      ): IDBRequest<IDBValidKey>;
    };
    const originalPut = objectStorePrototype.put;
    objectStorePrototype.put = function put(value) {
      if (this.name === POSITION_BATCH_STORE) {
        throw new DOMException("synthetic write failure", "QuotaExceededError");
      }
      return originalPut.call(this, value);
    };

    try {
      await expect(
        repository.replaceBatch(batch("20", "2400")),
      ).rejects.toMatchObject({
        code: "INDEXED_DB_TRANSACTION_FAILED",
      });
    } finally {
      objectStorePrototype.put = originalPut;
    }

    expect(await repository.getSnapshot(AAPL)).toEqual(first);
    await repository.close();
  });

  it("backs up legacy broker ledger rows and excludes them from the new portfolio", async () => {
    const factory = new IDBFactory();
    const name = databaseName("legacy-migration");
    const legacyRecord = {
      key: JSON.stringify(["user-1", "legacy-entry"]),
      userId: "user-1",
      entryId: "legacy-entry",
      record: {
        entry: {
          id: "legacy-entry",
          brokerAccountId: "legacy-broker",
          quantity: "5",
        },
      },
    };
    await openLegacyDatabase(factory, name, legacyRecord);

    const repository = new IndexedDbPositionRepository({
      indexedDB: factory,
      databaseName: name,
    });
    expect(await loadUnifiedPositions(repository)).toEqual([]);
    expect(await repository.listLegacyBrokerLedgerBackups()).toEqual([
      {
        sourceKey: legacyRecord.key,
        record: legacyRecord,
      },
    ]);

    await repository.close();
    const rawDatabase = await new Promise<IDBDatabase>(
      (resolve, reject) => {
        const request = factory.open(
          name,
          INDEXED_DB_POSITION_SCHEMA_VERSION,
        );
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    expect(
      rawDatabase.objectStoreNames.contains("ledger_entries"),
    ).toBe(true);
    expect(
      rawDatabase.objectStoreNames.contains(
        LEGACY_BROKER_LEDGER_STORE,
      ),
    ).toBe(true);
    rawDatabase.close();
  });
});
