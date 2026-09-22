import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  InMemoryLocalLedgerStore,
  INDEXED_DB_LEDGER_SCHEMA_VERSION,
  IndexedDbLocalLedgerStore,
  syncUserLedger,
  type LedgerSyncTransport,
  type LocalLedgerStore,
} from "../application/sync/index.ts";
import {
  DomainValidationError,
  calculateBrokerPositions,
} from "../domain/index.ts";
import {
  buyEntry,
  openingEntry,
  sellEntry,
} from "./helpers.ts";

function databaseName(testName: string): string {
  return `ledger-test-${testName}`;
}

function openRawDatabase(
  factory: IDBFactory,
  name: string,
  version = INDEXED_DB_LEDGER_SCHEMA_VERSION,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function seedOrderedConflictScenario(
  store: LocalLedgerStore,
): Promise<void> {
  await store.applyRemotePage(
    "user-1",
    [
      {
        entry: openingEntry({
          id: "opening-for-order",
          quantity: "15",
          costInput: { mode: "TOTAL_COST", value: "1500" },
        }),
        idempotencyKey: "idem-opening-for-order",
      },
    ],
    "cursor-before-order-conflict",
  );
  await store.appendPending(
    sellEntry({
      id: "z-first-enqueued",
      effectiveAt: "2026-07-03T14:00:00Z",
      createdAt: "2026-07-03T14:00:01Z",
      quantity: "6",
    }),
    "idem-z-first-enqueued",
  );
  await store.appendPending(
    sellEntry({
      id: "a-second-enqueued",
      effectiveAt: "2026-07-04T14:00:00Z",
      createdAt: "2026-07-04T14:00:01Z",
      quantity: "5",
    }),
    "idem-a-second-enqueued",
  );
}

async function resolveOrderedConflict(
  store: LocalLedgerStore,
): Promise<{
  readonly pushedEntryIds: readonly string[];
  readonly statuses: Readonly<Record<string, string>>;
  readonly quantity: string | undefined;
}> {
  const pushedEntryIds: string[] = [];
  const transport: LedgerSyncTransport = {
    async pullLedger(request) {
      expect(request.cursor).toBe("cursor-before-order-conflict");
      return {
        records: [
          {
            entry: sellEntry({
              id: "remote-sell-for-order",
              effectiveAt: "2026-07-02T14:00:00Z",
              createdAt: "2026-07-02T14:00:01Z",
              quantity: "5",
            }),
            idempotencyKey: "idem-remote-sell-for-order",
          },
        ],
        nextCursor: "cursor-after-order-conflict",
        hasMore: false,
      };
    },
    async pushLedger(request) {
      pushedEntryIds.push(
        ...request.records.map((record) => record.entry.id),
      );
      return {
        results: request.records.map((record) => ({
          entryId: record.entry.id,
          idempotencyKey: record.idempotencyKey,
          status: "SYNCED" as const,
        })),
      };
    },
  };

  await syncUserLedger("user-1", store, transport);
  const records = await store.listRecords("user-1");
  const statuses = Object.fromEntries(
    records.map((record) => [
      record.entry.id,
      record.syncStatus,
    ]),
  );
  return {
    pushedEntryIds,
    statuses,
    quantity: calculateBrokerPositions(
      await store.listEconomicEntries("user-1"),
    )[0]?.quantity,
  };
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => {
      // The abort event carries the transaction error.
    };
  });
}

describe("IndexedDB local ledger store", () => {
  it("persists the ledger, outbox, statuses, and cursor across reopen", async () => {
    const factory = new IDBFactory();
    const name = databaseName("reopen");
    const opening = openingEntry({
      id: "opening-persisted",
      quantity: "10.5",
      costInput: { mode: "TOTAL_COST", value: "1050" },
    });
    const first = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });

    await first.appendPending(opening, "idem-opening-persisted");
    await first.close();

    const second = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });
    expect(await second.listRecords("user-1")).toMatchObject([
      {
        entry: { id: "opening-persisted" },
        syncStatus: "LOCAL_PENDING",
      },
    ]);
    expect(await second.listOutbox("user-1")).toMatchObject([
      {
        entryId: "opening-persisted",
        idempotencyKey: "idem-opening-persisted",
      },
    ]);

    await second.applyRemotePage(
      "user-1",
      [
        {
          entry: opening,
          idempotencyKey: "idem-opening-persisted",
        },
      ],
      "cursor-1",
    );
    await second.close();

    const third = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });
    expect((await third.listRecords("user-1"))[0]?.syncStatus).toBe(
      "SYNCED",
    );
    expect(await third.listOutbox("user-1")).toEqual([]);
    expect(await third.getCursor("user-1")).toBe("cursor-1");
    await third.close();
  });

  it("does not persist an entry when local domain validation fails", async () => {
    const store = new IndexedDbLocalLedgerStore({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("domain-rollback"),
    });
    await store.appendPending(
      openingEntry({
        id: "opening",
        quantity: "1",
        costInput: { mode: "TOTAL_COST", value: "100" },
      }),
      "idem-opening",
    );

    await expect(
      store.appendPending(
        sellEntry({
          id: "oversell",
          effectiveAt: "2026-07-02T14:00:00Z",
          quantity: "1.00000001",
        }),
        "idem-oversell",
      ),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await store.listRecords("user-1")).toHaveLength(1);
    expect(await store.listOutbox("user-1")).toHaveLength(1);
    await store.close();
  });

  it("aborts the source-record write if the outbox write fails", async () => {
    const factory = new IDBFactory();
    const name = databaseName("physical-rollback");
    const initializer = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });
    await initializer.listRecords("user-1");
    await initializer.close();

    const rawDatabase = await openRawDatabase(factory, name);
    const rawTransaction = rawDatabase.transaction(
      ["sync_outbox"],
      "readwrite",
    );
    const rawCompletion = completeTransaction(rawTransaction);
    const key = JSON.stringify(["user-1", "outbox-collision"]);
    rawTransaction.objectStore("sync_outbox").add({
      key,
      userId: "user-1",
      entryId: "outbox-collision",
      item: {
        entryId: "outbox-collision",
        idempotencyKey: "orphan-idempotency-key",
        attemptCount: 0,
        lastRetryableFailure: null,
      },
      enqueueSequence: 1,
    });
    await rawCompletion;
    rawDatabase.close();

    const store = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });
    await expect(
      store.appendPending(
        buyEntry({
          id: "outbox-collision",
          quantity: "1",
          unitPrice: "100",
        }),
        "idem-outbox-collision",
      ),
    ).rejects.toMatchObject({
      code: "INDEXED_DB_TRANSACTION_FAILED",
    });

    expect(await store.listRecords("user-1")).toEqual([]);
    expect(await store.listOutbox("user-1")).toHaveLength(1);
    await store.close();
  });

  it("applies a remote page and cursor atomically", async () => {
    const store = new IndexedDbLocalLedgerStore({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("remote-rollback"),
    });
    const local = buyEntry({
      id: "local-buy",
      quantity: "1",
      unitPrice: "100",
    });
    await store.appendPending(local, "idem-local-buy");
    const recordsBefore = await store.listRecords("user-1");
    const outboxBefore = await store.listOutbox("user-1");

    await expect(
      store.applyRemotePage(
        "user-1",
        [
          {
            entry: buyEntry({
              id: "remote-buy",
              quantity: "2",
              unitPrice: "90",
            }),
            idempotencyKey: "idem-remote-buy",
          },
          {
            entry: buyEntry({
              id: "wrong-user",
              userId: "user-2",
              quantity: "3",
              unitPrice: "80",
            }),
            idempotencyKey: "idem-wrong-user",
          },
        ],
        "cursor-should-not-commit",
      ),
    ).rejects.toMatchObject({ code: "REMOTE_USER_MISMATCH" });

    expect(await store.listRecords("user-1")).toEqual(recordsBefore);
    expect(await store.listOutbox("user-1")).toEqual(outboxBefore);
    expect(await store.getCursor("user-1")).toBeNull();
    await store.close();
  });

  it("persists retry, conflict, and accepted push transitions", async () => {
    const store = new IndexedDbLocalLedgerStore({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("push-transitions"),
    });
    await store.appendPending(
      buyEntry({
        id: "buy-conflict",
        quantity: "1",
        unitPrice: "100",
      }),
      "idem-buy-conflict",
    );

    await store.markPushAttempt("user-1", ["buy-conflict"]);
    await store.markRetryableFailure(
      "user-1",
      "buy-conflict",
      "idem-buy-conflict",
      {
        code: "SYNTHETIC_RETRY",
        message: "retry is safe",
      },
    );
    expect((await store.listOutbox("user-1"))[0]).toMatchObject({
      attemptCount: 1,
      lastRetryableFailure: { code: "SYNTHETIC_RETRY" },
    });

    await store.markPushAttempt("user-1", ["buy-conflict"]);
    expect((await store.listOutbox("user-1"))[0]).toMatchObject({
      attemptCount: 2,
      lastRetryableFailure: null,
    });
    await store.markConflict(
      "user-1",
      "buy-conflict",
      "idem-buy-conflict",
      {
        code: "REMOTE_CONFLICT",
        message: "cloud state changed",
      },
    );
    expect((await store.listRecords("user-1"))[0]).toMatchObject({
      syncStatus: "REJECTED_CONFLICT",
      conflict: { code: "REMOTE_CONFLICT" },
    });
    expect(await store.listEconomicEntries("user-1")).toEqual([]);
    expect(await store.listOutbox("user-1")).toEqual([]);

    await store.appendPending(
      buyEntry({
        id: "buy-accepted",
        quantity: "2",
        unitPrice: "90",
      }),
      "idem-buy-accepted",
    );
    await store.markPushAttempt("user-1", ["buy-accepted"]);
    await store.markSynced(
      "user-1",
      "buy-accepted",
      "idem-buy-accepted",
    );
    expect(
      (await store.listRecords("user-1")).find(
        (record) => record.entry.id === "buy-accepted",
      )?.syncStatus,
    ).toBe("SYNCED");
    expect(await store.listOutbox("user-1")).toEqual([]);
    await expect(
      store.markConflict(
        "user-1",
        "buy-accepted",
        "idem-buy-accepted",
        {
          code: "TOO_LATE",
          message: "accepted records cannot be rejected locally",
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_SYNC_TRANSITION" });
    await store.close();
  });

  it("preserves enqueue order so conflict resolution matches the in-memory contract", async () => {
    const memoryStore = new InMemoryLocalLedgerStore();
    await seedOrderedConflictScenario(memoryStore);
    expect(
      (await memoryStore.listOutbox("user-1")).map(
        (item) => item.entryId,
      ),
    ).toEqual(["z-first-enqueued", "a-second-enqueued"]);
    const memoryResult = await resolveOrderedConflict(memoryStore);

    const factory = new IDBFactory();
    const name = databaseName("outbox-order");
    const firstConnection = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });
    await seedOrderedConflictScenario(firstConnection);
    await firstConnection.close();
    const persistentStore = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });
    expect(
      (await persistentStore.listOutbox("user-1")).map(
        (item) => item.entryId,
      ),
    ).toEqual(["z-first-enqueued", "a-second-enqueued"]);
    const persistentResult =
      await resolveOrderedConflict(persistentStore);

    expect(memoryResult).toEqual({
      pushedEntryIds: ["z-first-enqueued"],
      statuses: expect.objectContaining({
        "z-first-enqueued": "SYNCED",
        "a-second-enqueued": "REJECTED_CONFLICT",
      }),
      quantity: "4",
    });
    expect(persistentResult).toEqual(memoryResult);
    await persistentStore.close();
  });

  it("invalidates a cached connection when the database version changes", async () => {
    const factory = new IDBFactory();
    const name = databaseName("version-change");
    const store = new IndexedDbLocalLedgerStore({
      indexedDB: factory,
      databaseName: name,
    });
    await store.listRecords("user-1");

    const upgraded = await openRawDatabase(
      factory,
      name,
      INDEXED_DB_LEDGER_SCHEMA_VERSION + 1,
    );
    upgraded.close();

    await expect(store.listRecords("user-1")).rejects.toMatchObject({
      code: "INDEXED_DB_OPEN_FAILED",
    });
    await expect(store.listRecords("user-1")).rejects.toMatchObject({
      code: "INDEXED_DB_OPEN_FAILED",
    });
    await store.close();
  });

  it("isolates users and clears only the requested namespace", async () => {
    const store = new IndexedDbLocalLedgerStore({
      indexedDB: new IDBFactory(),
      databaseName: databaseName("user-isolation"),
    });
    await store.appendPending(
      buyEntry({
        id: "shared-entry-id",
        userId: "user-1",
        quantity: "1",
        unitPrice: "100",
      }),
      "shared-idempotency-key",
    );
    await store.appendPending(
      buyEntry({
        id: "shared-entry-id",
        userId: "user-2",
        quantity: "2",
        unitPrice: "200",
      }),
      "shared-idempotency-key",
    );
    await store.applyRemotePage("user-1", [], "user-1-cursor");
    await store.applyRemotePage("user-2", [], "user-2-cursor");

    await store.clearUser("user-1");

    expect(await store.listRecords("user-1")).toEqual([]);
    expect(await store.listOutbox("user-1")).toEqual([]);
    expect(await store.getCursor("user-1")).toBeNull();
    expect(await store.listRecords("user-2")).toHaveLength(1);
    expect(await store.listOutbox("user-2")).toHaveLength(1);
    expect(await store.getCursor("user-2")).toBe("user-2-cursor");
    expect(
      calculateBrokerPositions(
        await store.listEconomicEntries("user-2"),
      )[0]?.quantity,
    ).toBe("2");
    await store.close();
  });
});
