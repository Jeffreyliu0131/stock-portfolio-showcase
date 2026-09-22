import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { IndexedDbLastValidQuoteStore } from "../application/market-data/indexeddb-last-valid-quote-store.ts";
import { validQuote } from "./helpers.ts";

describe("IndexedDbLastValidQuoteStore", () => {
  it("persists complete quote provenance across reopen", async () => {
    const factory = new IDBFactory();
    const databaseName = "quote-cache-persistence";
    const first = new IndexedDbLastValidQuoteStore({
      indexedDB: factory,
      databaseName,
    });
    const quote = validQuote();

    await first.putLastValidQuoteIfNewer(quote);
    await first.close();

    const reopened = new IndexedDbLastValidQuoteStore({
      indexedDB: factory,
      databaseName,
    });
    await expect(
      reopened.getLastValidQuote(quote.instrument),
    ).resolves.toEqual(quote);
    await reopened.close();
  });

  it("does not let an older event replace the last valid quote", async () => {
    const store = new IndexedDbLastValidQuoteStore({
      indexedDB: new IDBFactory(),
      databaseName: "quote-cache-monotonic",
    });
    const current = validQuote({
      price: "130",
      sourceEventAt: "2026-07-29T14:45:00Z",
      fetchedAt: "2026-07-29T15:00:30Z",
    });
    const older = validQuote({
      price: "120",
      sourceEventAt: "2026-07-29T14:44:00Z",
      fetchedAt: "2026-07-29T15:01:00Z",
    });

    await store.putLastValidQuoteIfNewer(current);
    await expect(store.putLastValidQuoteIfNewer(older)).resolves.toEqual({
      stored: false,
      current,
    });
    await expect(
      store.getLastValidQuote(current.instrument),
    ).resolves.toEqual(current);
    await store.close();
  });
});
