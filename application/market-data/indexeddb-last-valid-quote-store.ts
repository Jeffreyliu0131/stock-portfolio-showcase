import {
  compareRfc3339,
  createInstrumentKey,
  instrumentKeyId,
  resolveQuote,
  type InstrumentKey,
  type ValidMarketQuote,
} from "../../domain/index.ts";
import type {
  LastValidQuoteStore,
  LastValidQuoteWriteResult,
} from "./types.ts";

const DEFAULT_QUOTE_DATABASE_NAME =
  "stock-portfolio-calculator-market-data";
const QUOTE_DATABASE_VERSION = 1;
const QUOTE_STORE = "last_valid_quotes";

interface StoredQuote {
  readonly key: string;
  readonly quote: ValidMarketQuote;
}

export interface IndexedDbLastValidQuoteStoreOptions {
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB quote request failed"));
  });
}

function transactionCompletion(
  transaction: IDBTransaction,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error("IndexedDB quote transaction aborted"),
      );
    transaction.onerror = () => {
      // The abort event reports the final failure.
    };
  });
}

function normalizeQuote(input: ValidMarketQuote): ValidMarketQuote {
  const instrument = createInstrumentKey(input.instrument);
  const resolved = resolveQuote({
    requestedInstrument: instrument,
    now: input.fetchedAt,
    fetchStatus: "FETCH_OK",
    marketSession: input.marketSession,
    candidate: {
      ...input,
      instrument,
    },
  });
  if (
    !resolved.acceptedCandidate ||
    resolved.provider === null ||
    resolved.feed === null ||
    resolved.effectivePrice === null ||
    resolved.sourcePriceType === null ||
    resolved.sourceEventAt === null ||
    resolved.fetchedAt === null
  ) {
    throw new Error("last valid quote is malformed");
  }
  return {
    instrument,
    provider: resolved.provider,
    feed: resolved.feed,
    price: resolved.effectivePrice,
    priceType: resolved.sourcePriceType,
    sourceEventAt: resolved.sourceEventAt,
    fetchedAt: resolved.fetchedAt,
    marketSession: resolved.marketSession,
    ...(resolved.previousRegularClose === null
      ? {}
      : { previousRegularClose: resolved.previousRegularClose }),
  };
}

function cloneQuote(quote: ValidMarketQuote): ValidMarketQuote {
  return {
    ...quote,
    instrument: { ...quote.instrument },
  };
}

function incomingIsOlder(
  incoming: ValidMarketQuote,
  current: ValidMarketQuote,
): boolean {
  const sourceOrder = compareRfc3339(
    incoming.sourceEventAt,
    current.sourceEventAt,
  );
  return sourceOrder < 0
    ? true
    : sourceOrder > 0
      ? false
      : compareRfc3339(incoming.fetchedAt, current.fetchedAt) < 0;
}

export class IndexedDbLastValidQuoteStore
  implements LastValidQuoteStore
{
  private readonly indexedDbFactory: IDBFactory | undefined;
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbLastValidQuoteStoreOptions = {}) {
    this.indexedDbFactory =
      options.indexedDB ??
      (typeof globalThis.indexedDB === "undefined"
        ? undefined
        : globalThis.indexedDB);
    this.databaseName =
      options.databaseName ?? DEFAULT_QUOTE_DATABASE_NAME;
  }

  async getLastValidQuote(
    instrumentInput: InstrumentKey,
  ): Promise<ValidMarketQuote | null> {
    const instrument = createInstrumentKey(instrumentInput);
    const database = await this.openDatabase();
    const transaction = database.transaction(QUOTE_STORE, "readonly");
    const completion = transactionCompletion(transaction);
    const value = await requestResult(
      transaction
        .objectStore(QUOTE_STORE)
        .get(instrumentKeyId(instrument)),
    );
    await completion;
    if (value === undefined) {
      return null;
    }
    try {
      const stored = value as StoredQuote;
      if (
        stored.key !== instrumentKeyId(instrument) ||
        stored.key !== instrumentKeyId(stored.quote.instrument)
      ) {
        return null;
      }
      return cloneQuote(normalizeQuote(stored.quote));
    } catch {
      return null;
    }
  }

  async putLastValidQuoteIfNewer(
    quoteInput: ValidMarketQuote,
  ): Promise<LastValidQuoteWriteResult> {
    const quote = normalizeQuote(quoteInput);
    const key = instrumentKeyId(quote.instrument);
    const database = await this.openDatabase();
    const transaction = database.transaction(QUOTE_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore(QUOTE_STORE);
    const existingValue = await requestResult(store.get(key));

    if (existingValue !== undefined) {
      try {
        const current = normalizeQuote(
          (existingValue as StoredQuote).quote,
        );
        if (incomingIsOlder(quote, current)) {
          await completion;
          return {
            stored: false,
            current: cloneQuote(current),
          };
        }
      } catch {
        // A valid incoming quote replaces a corrupted cache record.
      }
    }

    await requestResult(
      store.put({
        key,
        quote,
      } satisfies StoredQuote),
    );
    await completion;
    return {
      stored: true,
      current: cloneQuote(quote),
    };
  }

  async close(): Promise<void> {
    const databasePromise = this.databasePromise;
    this.databasePromise = undefined;
    const database = await databasePromise;
    database?.close();
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise !== undefined) {
      return this.databasePromise;
    }
    if (this.indexedDbFactory === undefined) {
      return Promise.reject(
        new Error("IndexedDB is unavailable for the quote cache"),
      );
    }

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let request: IDBOpenDBRequest;
      try {
        request = this.indexedDbFactory!.open(
          this.databaseName,
          QUOTE_DATABASE_VERSION,
        );
      } catch (error) {
        settled = true;
        reject(
          error instanceof Error
            ? error
            : new Error("Could not open IndexedDB quote cache"),
        );
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(QUOTE_STORE)) {
          request.result.createObjectStore(QUOTE_STORE, {
            keyPath: "key",
          });
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          if (this.databasePromise === opening) {
            this.databasePromise = undefined;
          }
        };
        resolve(database);
      };
      request.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          request.error ?? new Error("Could not open IndexedDB quote cache"),
        );
      };
      request.onblocked = () => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error("IndexedDB quote cache upgrade was blocked"));
      };
    });
    this.databasePromise = opening;
    void opening.catch(() => {
      if (this.databasePromise === opening) {
        this.databasePromise = undefined;
      }
    });
    return opening;
  }
}
