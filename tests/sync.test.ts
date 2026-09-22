import { describe, expect, it } from "vitest";

import {
  InMemoryLocalLedgerStore,
  LedgerSyncError,
  syncUserLedger,
  type LedgerSyncTransport,
  type PushLedgerResult,
  type RemoteLedgerRecord,
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

function acceptedResult(
  entryId: string,
  idempotencyKey: string,
): PushLedgerResult {
  return {
    entryId,
    idempotencyKey,
    status: "SYNCED",
  };
}

function remote(
  entry: RemoteLedgerRecord["entry"],
  idempotencyKey: string,
): RemoteLedgerRecord {
  return { entry, idempotencyKey };
}

describe("local-first replicated ledger", () => {
  it("atomically saves a local record and outbox item for immediate calculation", async () => {
    const store = new InMemoryLocalLedgerStore();
    const entry = openingEntry({
      id: "opening-local",
      quantity: "10.5",
      costInput: { mode: "TOTAL_COST", value: "1050" },
    });

    const saved = await store.appendPending(entry, "idem-opening-local");

    expect(saved.syncStatus).toBe("LOCAL_PENDING");
    expect(await store.listOutbox("user-1")).toEqual([
      {
        entryId: "opening-local",
        idempotencyKey: "idem-opening-local",
        attemptCount: 0,
        lastRetryableFailure: null,
      },
    ]);
    expect(
      calculateBrokerPositions(
        await store.listEconomicEntries("user-1"),
      )[0]?.quantity,
    ).toBe("10.5");
  });

  it("leaves neither a record nor an outbox item when local domain validation fails", async () => {
    const store = new InMemoryLocalLedgerStore();
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
  });

  it("deduplicates the same local request and rejects idempotency-key reuse", async () => {
    const store = new InMemoryLocalLedgerStore();
    const entry = buyEntry({
      id: "buy-once",
      quantity: "1",
      unitPrice: "100",
    });

    await store.appendPending(entry, "idem-buy-once");
    await store.appendPending({ ...entry }, "idem-buy-once");

    expect(await store.listRecords("user-1")).toHaveLength(1);
    expect(await store.listOutbox("user-1")).toHaveLength(1);

    try {
      await store.appendPending(
        buyEntry({
          id: "buy-other",
          quantity: "2",
          unitPrice: "100",
        }),
        "idem-buy-once",
      );
      throw new Error("expected idempotency reuse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerSyncError);
      expect((error as LedgerSyncError).code).toBe(
        "IDEMPOTENCY_KEY_REUSED",
      );
    }
  });

  it("pulls before pushing and does not resend an accepted record", async () => {
    const store = new InMemoryLocalLedgerStore();
    await store.appendPending(
      buyEntry({
        id: "buy-sync",
        quantity: "1",
        unitPrice: "100",
      }),
      "idem-buy-sync",
    );
    const calls: string[] = [];
    let pullCount = 0;
    const transport: LedgerSyncTransport = {
      async pullLedger(request) {
        calls.push("pull");
        expect(request.cursor).toBe(
          pullCount === 0 ? null : "cursor-1",
        );
        pullCount += 1;
        return {
          records: [],
          nextCursor: "cursor-1",
          hasMore: false,
        };
      },
      async pushLedger(request) {
        calls.push("push");
        expect(request.records).toHaveLength(1);
        return {
          results: [acceptedResult("buy-sync", "idem-buy-sync")],
        };
      },
    };

    const first = await syncUserLedger("user-1", store, transport);
    const second = await syncUserLedger("user-1", store, transport);

    expect(calls).toEqual(["pull", "push", "pull"]);
    expect(first.syncedRecordCount).toBe(1);
    expect(second.attemptedPushCount).toBe(0);
    expect((await store.listRecords("user-1"))[0]?.syncStatus).toBe(
      "SYNCED",
    );
    expect(await store.listOutbox("user-1")).toHaveLength(0);
    expect(await store.getCursor("user-1")).toBe("cursor-1");
  });

  it("drains every remote page before pushing the local outbox", async () => {
    const store = new InMemoryLocalLedgerStore();
    await store.appendPending(
      buyEntry({
        id: "buy-after-pages",
        quantity: "1",
        unitPrice: "100",
      }),
      "idem-buy-after-pages",
    );
    const calls: string[] = [];
    const transport: LedgerSyncTransport = {
      async pullLedger(request) {
        calls.push(`pull:${request.cursor ?? "initial"}`);
        return request.cursor === null
          ? { records: [], nextCursor: "cursor-1", hasMore: true }
          : { records: [], nextCursor: "cursor-2", hasMore: false };
      },
      async pushLedger() {
        calls.push("push");
        return {
          results: [
            acceptedResult(
              "buy-after-pages",
              "idem-buy-after-pages",
            ),
          ],
        };
      },
    };

    await syncUserLedger("user-1", store, transport);

    expect(calls).toEqual([
      "pull:initial",
      "pull:cursor-1",
      "push",
    ]);
    expect(await store.getCursor("user-1")).toBe("cursor-2");
  });

  it("keeps the complete local snapshot when a later pull page fails", async () => {
    const store = new InMemoryLocalLedgerStore();
    const opening = openingEntry({
      id: "opening-before-interrupted-pull",
      quantity: "10",
      costInput: { mode: "TOTAL_COST", value: "1000" },
    });
    await store.applyRemotePage(
      "user-1",
      [remote(opening, "idem-opening-before-interrupted-pull")],
      "cursor-1",
    );
    await store.appendPending(
      sellEntry({
        id: "sell-pending-before-interrupted-pull",
        effectiveAt: "2026-07-03T14:00:00Z",
        createdAt: "2026-07-03T14:00:01Z",
        quantity: "6",
      }),
      "idem-sell-pending-before-interrupted-pull",
    );

    const recordsBefore = await store.listRecords("user-1");
    const outboxBefore = await store.listOutbox("user-1");
    const economicEntriesBefore =
      await store.listEconomicEntries("user-1");
    const cursorBefore = await store.getCursor("user-1");
    let pushCalled = false;
    const transport: LedgerSyncTransport = {
      async pullLedger(request) {
        if (request.cursor === "cursor-1") {
          return {
            records: [
              remote(
                sellEntry({
                  id: "sell-remote-before-interrupted-pull",
                  effectiveAt: "2026-07-02T14:00:00Z",
                  createdAt: "2026-07-02T14:00:01Z",
                  quantity: "5",
                }),
                "idem-sell-remote-before-interrupted-pull",
              ),
            ],
            nextCursor: "cursor-2",
            hasMore: true,
          };
        }
        expect(request.cursor).toBe("cursor-2");
        throw new Error("synthetic later-page pull failure");
      },
      async pushLedger() {
        pushCalled = true;
        return { results: [] };
      },
    };

    await expect(
      syncUserLedger("user-1", store, transport),
    ).rejects.toThrow("synthetic later-page pull failure");

    expect(pushCalled).toBe(false);
    expect(await store.listRecords("user-1")).toEqual(recordsBefore);
    expect(await store.listOutbox("user-1")).toEqual(outboxBefore);
    expect(await store.listEconomicEntries("user-1")).toEqual(
      economicEntriesBefore,
    );
    expect(await store.getCursor("user-1")).toBe(cursorBefore);
    expect(
      calculateBrokerPositions(
        await store.listEconomicEntries("user-1"),
      )[0]?.quantity,
    ).toBe("4");
  });

  it("keeps the outbox and local economic result after a transport failure", async () => {
    const store = new InMemoryLocalLedgerStore();
    await store.appendPending(
      buyEntry({
        id: "buy-offline",
        quantity: "0.25",
        unitPrice: "200",
      }),
      "idem-buy-offline",
    );
    const transport: LedgerSyncTransport = {
      async pullLedger() {
        return { records: [], nextCursor: "cursor-1", hasMore: false };
      },
      async pushLedger() {
        throw new Error("synthetic transport failure");
      },
    };

    await expect(
      syncUserLedger("user-1", store, transport),
    ).rejects.toThrow("synthetic transport failure");

    const outbox = await store.listOutbox("user-1");
    expect(outbox[0]?.attemptCount).toBe(1);
    expect(outbox[0]?.lastRetryableFailure?.code).toBe(
      "SYNC_TRANSPORT_FAILURE",
    );
    expect(
      calculateBrokerPositions(
        await store.listEconomicEntries("user-1"),
      )[0]?.quantity,
    ).toBe("0.25");
  });

  it("retains a cloud-rejected record but excludes it from economic results", async () => {
    const store = new InMemoryLocalLedgerStore();
    await store.appendPending(
      openingEntry({
        id: "opening-rejected",
        quantity: "3",
        costInput: { mode: "TOTAL_COST", value: "300" },
      }),
      "idem-opening-rejected",
    );
    const transport: LedgerSyncTransport = {
      async pullLedger() {
        return { records: [], nextCursor: "cursor-1", hasMore: false };
      },
      async pushLedger() {
        return {
          results: [
            {
              entryId: "opening-rejected",
              idempotencyKey: "idem-opening-rejected",
              status: "REJECTED_CONFLICT",
              failure: {
                code: "MULTIPLE_OPENING_POSITIONS",
                message: "cloud ledger already has an opening position",
              },
            },
          ],
        };
      },
    };

    const summary = await syncUserLedger("user-1", store, transport);
    const records = await store.listRecords("user-1");

    expect(summary.conflictRecordCount).toBe(1);
    expect(records[0]?.syncStatus).toBe("REJECTED_CONFLICT");
    expect(records[0]?.conflict?.code).toBe(
      "MULTIPLE_OPENING_POSITIONS",
    );
    expect(await store.listEconomicEntries("user-1")).toEqual([]);
    expect(await store.listOutbox("user-1")).toEqual([]);
  });

  it("revalidates pending records after pull and never pushes an invalid oversell", async () => {
    const store = new InMemoryLocalLedgerStore();
    const opening = openingEntry({
      id: "opening-cloud",
      quantity: "10",
      costInput: { mode: "TOTAL_COST", value: "1000" },
    });
    await store.applyRemotePage(
      "user-1",
      [remote(opening, "idem-opening-cloud")],
      "cursor-1",
    );
    await store.appendPending(
      sellEntry({
        id: "sell-local",
        effectiveAt: "2026-07-03T14:00:00Z",
        createdAt: "2026-07-03T14:00:01Z",
        quantity: "6",
      }),
      "idem-sell-local",
    );
    let pushCalled = false;
    const transport: LedgerSyncTransport = {
      async pullLedger(request) {
        expect(request.cursor).toBe("cursor-1");
        return {
          records: [
            remote(
              sellEntry({
                id: "sell-other-device",
                effectiveAt: "2026-07-02T14:00:00Z",
                createdAt: "2026-07-02T14:00:01Z",
                quantity: "5",
              }),
              "idem-sell-other-device",
            ),
          ],
          nextCursor: "cursor-2",
          hasMore: false,
        };
      },
      async pushLedger() {
        pushCalled = true;
        return { results: [] };
      },
    };

    const summary = await syncUserLedger("user-1", store, transport);
    const records = await store.listRecords("user-1");
    const position = calculateBrokerPositions(
      await store.listEconomicEntries("user-1"),
    )[0];

    expect(pushCalled).toBe(false);
    expect(summary.conflictRecordCount).toBe(1);
    expect(
      records.find((record) => record.entry.id === "sell-local")
        ?.syncStatus,
    ).toBe("REJECTED_CONFLICT");
    expect(position?.quantity).toBe("5");
  });

  it("isolates user namespaces and clears only the requested user", async () => {
    const store = new InMemoryLocalLedgerStore();
    await store.appendPending(
      buyEntry({
        id: "user-1-buy",
        userId: "user-1",
        quantity: "1",
        unitPrice: "100",
      }),
      "idem-user-1",
    );
    await store.appendPending(
      buyEntry({
        id: "user-2-buy",
        userId: "user-2",
        quantity: "2",
        unitPrice: "200",
      }),
      "idem-user-2",
    );

    expect(await store.listRecords("user-1")).toHaveLength(1);
    expect(await store.listRecords("user-2")).toHaveLength(1);

    await store.clearUser("user-1");

    expect(await store.listRecords("user-1")).toEqual([]);
    expect(await store.listOutbox("user-1")).toEqual([]);
    expect(await store.listRecords("user-2")).toHaveLength(1);
    expect(await store.listOutbox("user-2")).toHaveLength(1);
  });

  it("applies a remote page atomically and deduplicates repeated pulls", async () => {
    const store = new InMemoryLocalLedgerStore();
    const entry = buyEntry({
      id: "cloud-buy",
      quantity: "1",
      unitPrice: "100",
    });

    await store.applyRemotePage(
      "user-1",
      [remote(entry, "idem-cloud-buy")],
      "cursor-1",
    );
    await store.applyRemotePage(
      "user-1",
      [remote({ ...entry }, "idem-cloud-buy")],
      "cursor-2",
    );

    expect(await store.listRecords("user-1")).toHaveLength(1);
    expect(await store.getCursor("user-1")).toBe("cursor-2");

    await expect(
      store.applyRemotePage(
        "user-1",
        [
          remote(
            buyEntry({
              id: "wrong-user",
              userId: "user-2",
              quantity: "1",
              unitPrice: "100",
            }),
            "idem-wrong-user",
          ),
        ],
        "cursor-3",
      ),
    ).rejects.toMatchObject({ code: "REMOTE_USER_MISMATCH" });

    expect(await store.listRecords("user-1")).toHaveLength(1);
    expect(await store.getCursor("user-1")).toBe("cursor-2");
  });
});
