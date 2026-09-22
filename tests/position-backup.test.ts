import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  POSITION_BACKUP_FORMAT,
  POSITION_BACKUP_FORMAT_VERSION,
  IndexedDbPositionRepository,
  createPositionBackupPreview,
  createPositionBackupDocument,
  createPositionBackupFile,
  parsePositionBackupDocument,
  parsePositionBackupJson,
  type CashSnapshot,
  type PositionBatch,
  type PositionSnapshot,
} from "../application/positions/index.ts";
import { AAPL, MSFT } from "./helpers.ts";

function snapshot(
  instrument: typeof AAPL,
  id: string,
  quantity: string,
  cost: string,
): PositionSnapshot {
  return {
    revision: 1,
    savedAt: "2026-07-30T06:00:00Z",
    batch: {
      instrument,
      displayName:
        instrument.symbol === "AAPL"
          ? "Apple Inc."
          : "Microsoft Corp.",
      inputs: [
        {
          id,
          instrument,
          quantity,
          costInput: {
            mode: "TOTAL_OPEN_COST",
            value: cost,
          },
        },
      ],
    },
  };
}

function batch(
  quantity: string,
  cost: string,
): PositionBatch {
  return snapshot(AAPL, "input-1", quantity, cost).batch;
}

const CASH_SNAPSHOT: CashSnapshot = {
  revision: 2,
  savedAt: "2026-08-02T06:00:00Z",
  account: {
    provider: "IBKR",
    currency: "USD",
    balance: "20000.50",
    netAssetValue: "80000",
    navSource: "USER_ENTERED",
    pricingPlan: "IBKR_PRO",
  },
};

describe("position JSON backup", () => {
  it("creates a versioned, stable JSON document without converting decimals to numbers", () => {
    const backup = createPositionBackupDocument(
      [
        snapshot(MSFT, "msft-input", "0.125", "25.10"),
        snapshot(AAPL, "aapl-input", "10", "1000"),
      ],
      "2026-07-30T06:07:08.123Z",
      CASH_SNAPSHOT,
    );
    const file = createPositionBackupFile(backup);
    const parsed = JSON.parse(file.contents) as PositionBackupDocumentShape;

    expect(backup).toMatchObject({
      format: POSITION_BACKUP_FORMAT,
      formatVersion: POSITION_BACKUP_FORMAT_VERSION,
      exportedAt: "2026-07-30T06:07:08.123Z",
    });
    expect(
      backup.snapshots.map(({ batch: { instrument } }) => instrument.symbol),
    ).toEqual(["AAPL", "MSFT"]);
    expect(file.fileName).toBe(
      "stock-portfolio-backup-2026-07-30T06-07-08Z.json",
    );
    expect(file.mediaType).toBe("application/json");
    expect(parsed.snapshots[1]?.batch.inputs[0]).toMatchObject({
      quantity: "0.125",
      costInput: {
        value: "25.10",
      },
    });
    expect(
      typeof parsed.snapshots[1]?.batch.inputs[0]?.quantity,
    ).toBe("string");
    expect(parsed.cash).toMatchObject({
      revision: 2,
      account: {
        balance: "20000.5",
        netAssetValue: "80000",
        pricingPlan: "IBKR_PRO",
      },
    });
    expect(typeof parsed.cash?.account.balance).toBe("string");
  });

  it("rejects duplicate current snapshots for the same instrument", () => {
    expect(() =>
      createPositionBackupDocument(
        [
          snapshot(AAPL, "input-1", "1", "100"),
          snapshot(AAPL, "input-2", "2", "220"),
        ],
        "2026-07-30T06:00:00Z",
      ),
    ).toThrow(/duplicate current snapshot/);
  });

  it("refuses to generate a v2 file that the restore parser would reject", () => {
    const nyseAapl = {
      ...AAPL,
      listingMarket: "NYSE",
    };
    const unsupported = {
      ...AAPL,
      listingMarket: "LSE",
      currency: "GBP",
    };

    expect(() =>
      createPositionBackupDocument(
        [
          snapshot(AAPL, "nasdaq-aapl", "1", "100"),
          snapshot(nyseAapl, "nyse-aapl", "1", "101"),
        ],
        "2026-08-09T02:00:00Z",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_INSTRUMENT" }),
    );
    expect(() =>
      createPositionBackupDocument(
        [snapshot(unsupported, "unsupported", "1", "100")],
        "2026-08-09T02:00:00Z",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_BACKUP_CONTENT" }),
    );
  });

  it("reads only current snapshots and leaves IndexedDB state unchanged", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: "position-backup-readonly-test",
      now: (() => {
        const values = [
          "2026-07-30T06:10:00Z",
          "2026-07-30T06:11:00Z",
          "2026-07-30T06:11:30Z",
        ];
        return () => values.shift()!;
      })(),
    });
    const previous = await repository.replaceBatch(batch("10", "1000"));
    const current = await repository.replaceBatch(
      batch("12.5", "1300"),
      { expectedRevision: previous.revision },
    );
    await repository.saveDraft(batch("99", "9999"));
    await repository.saveEntryDraft({
      symbol: "MSFT",
      displayName: "Microsoft Corp.",
      listingMarket: "NASDAQ",
      currency: "USD",
      costMode: "average",
      rows: [
        {
          id: "draft-input",
          quantity: "1.5",
          costValue: "420.25",
        },
      ],
    });
    const stateBefore = {
      current: await repository.getSnapshot(AAPL),
      previous: await repository.getPreviousSnapshot(AAPL),
      draft: await repository.getDraft(AAPL),
      entryDraft: await repository.getEntryDraft(),
    };

    const backup = createPositionBackupDocument(
      await repository.listSnapshots(),
      "2026-07-30T06:12:00Z",
    );

    expect(backup.snapshots).toEqual([current]);
    expect({
      current: await repository.getSnapshot(AAPL),
      previous: await repository.getPreviousSnapshot(AAPL),
      draft: await repository.getDraft(AAPL),
      entryDraft: await repository.getEntryDraft(),
    }).toEqual(stateBefore);
    await repository.close();
  });

  it("creates a valid empty backup document", () => {
    const backup = createPositionBackupDocument(
      [],
      "2026-07-30T06:20:00Z",
    );
    expect(JSON.parse(createPositionBackupFile(backup).contents)).toMatchObject(
      {
        format: POSITION_BACKUP_FORMAT,
        formatVersion: 2,
        snapshots: [],
        cash: null,
      },
    );
  });

  it("strictly parses a generated v2 file and builds an exact preview", () => {
    const source = createPositionBackupDocument(
      [
        snapshot(MSFT, "msft-input", "0.125", "25.10"),
        snapshot(AAPL, "aapl-input", "10", "1000"),
      ],
      "2026-08-09T02:00:00Z",
      CASH_SNAPSHOT,
    );

    const parsed = parsePositionBackupJson(
      createPositionBackupFile(source).contents,
    );
    const preview = createPositionBackupPreview(parsed);

    expect(parsed).toEqual(source);
    expect(preview).toEqual({
      exportedAt: "2026-08-09T02:00:00Z",
      positionCount: 2,
      inputCount: 2,
      positions: [
        {
          instrument: AAPL,
          displayName: "Apple Inc.",
          revision: 1,
          savedAt: "2026-07-30T06:00:00Z",
          inputCount: 1,
          quantity: "10",
          openCost: "1000",
          averageCost: "100",
        },
        {
          instrument: MSFT,
          displayName: "Microsoft Corp.",
          revision: 1,
          savedAt: "2026-07-30T06:00:00Z",
          inputCount: 1,
          quantity: "0.125",
          openCost: "25.1",
          averageCost: "200.8",
        },
      ],
      cash: {
        ...CASH_SNAPSHOT,
        account: {
          ...CASH_SNAPSHOT.account,
          balance: "20000.5",
        },
      },
      currencyTotals: [
        {
          currency: "USD",
          stockOpenCost: "1025.1",
          cashBalance: "20000.5",
          recordedPrincipal: "21025.6",
        },
      ],
    });
  });

  it.each([
    {
      name: "wrong format",
      change: { format: "other-product" },
      code: "INVALID_BACKUP_FORMAT",
    },
    {
      name: "unsupported version",
      change: { formatVersion: 1 },
      code: "UNSUPPORTED_BACKUP_VERSION",
    },
    {
      name: "missing required cash field",
      change: { cash: undefined },
      code: "INVALID_BACKUP_CONTENT",
    },
  ])("rejects $name", ({ change, code }) => {
    const valid = createPositionBackupDocument(
      [snapshot(AAPL, "input-1", "1", "100")],
      "2026-08-09T02:00:00Z",
    );
    const input = { ...valid, ...change } as Record<string, unknown>;
    if (Object.hasOwn(change, "cash") && change.cash === undefined) {
      delete input.cash;
    }

    expect(() => parsePositionBackupDocument(input)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("distinguishes malformed JSON from a structurally invalid backup", () => {
    expect(() => parsePositionBackupJson("{not-json}"))
      .toThrowError(
        expect.objectContaining({
          code: "INVALID_JSON",
        }),
      );
    expect(() => parsePositionBackupJson("null")).toThrowError(
      expect.objectContaining({
        code: "INVALID_BACKUP_CONTENT",
      }),
    );
  });

  it("rejects unknown fields including non-current restore content", () => {
    const valid = createPositionBackupDocument(
      [snapshot(AAPL, "input-1", "1", "100")],
      "2026-08-09T02:00:00Z",
    );
    const withTopLevelCache = {
      ...valid,
      quoteCache: [],
    };
    const current = valid.snapshots[0]!;
    const withPrevious = {
      ...valid,
      snapshots: [
        {
          ...current,
          previous: current,
        },
      ],
    };

    expect(() => parsePositionBackupDocument(withTopLevelCache))
      .toThrowError(/unknown field: quoteCache/);
    expect(() => parsePositionBackupDocument(withPrevious))
      .toThrowError(/unknown field: previous/);
  });

  it("rejects duplicate normalized instruments", () => {
    const first = snapshot(AAPL, "input-1", "1", "100");
    const second = {
      ...snapshot(AAPL, "input-2", "2", "220"),
      batch: {
        ...snapshot(AAPL, "input-2", "2", "220").batch,
        instrument: {
          listingMarket: "nasdaq",
          symbol: "aapl",
          currency: "usd",
        },
        inputs: [
          {
            ...snapshot(AAPL, "input-2", "2", "220").batch.inputs[0]!,
            instrument: {
              listingMarket: "nasdaq",
              symbol: "aapl",
              currency: "usd",
            },
          },
        ],
      },
    };
    const input = {
      format: POSITION_BACKUP_FORMAT,
      formatVersion: 2,
      exportedAt: "2026-08-09T02:00:00Z",
      snapshots: [first, second],
      cash: null,
    };

    expect(() => parsePositionBackupDocument(input)).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_INSTRUMENT",
      }),
    );
  });

  it("rejects one symbol recorded under two supported listing markets", () => {
    const first = snapshot(AAPL, "input-1", "1", "100");
    const second = snapshot(AAPL, "input-2", "2", "220");
    const input = JSON.parse(
      JSON.stringify({
        format: POSITION_BACKUP_FORMAT,
        formatVersion: 2,
        exportedAt: "2026-08-09T02:00:00Z",
        snapshots: [
          first,
          {
            ...second,
            batch: {
              ...second.batch,
              instrument: {
                ...second.batch.instrument,
                listingMarket: "NYSE",
              },
              inputs: second.batch.inputs.map((positionInput) => ({
                ...positionInput,
                instrument: {
                  ...positionInput.instrument,
                  listingMarket: "NYSE",
                },
              })),
            },
          },
        ],
        cash: null,
      }),
    ) as unknown;

    expect(() => parsePositionBackupDocument(input)).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_INSTRUMENT" }),
    );
  });

  it.each([
    {
      name: "non-US listing and currency",
      instrument: {
        listingMarket: "LSE",
        symbol: "VOD",
        currency: "GBP",
      },
    },
    {
      name: "invalid US equity symbol",
      instrument: {
        listingMarket: "NASDAQ",
        symbol: "AAPL/../../",
        currency: "USD",
      },
    },
  ])("rejects $name", ({ instrument }) => {
    const input = JSON.parse(
      createPositionBackupFile(
        createPositionBackupDocument(
          [snapshot(AAPL, "input-1", "1", "100")],
          "2026-08-09T02:00:00Z",
        ),
      ).contents,
    ) as {
      snapshots: {
        batch: {
          instrument: unknown;
          inputs: { instrument: unknown }[];
        };
      }[];
    };
    input.snapshots[0]!.batch.instrument = instrument;
    input.snapshots[0]!.batch.inputs[0]!.instrument = instrument;

    expect(() => parsePositionBackupDocument(input)).toThrowError(
      expect.objectContaining({ code: "INVALID_BACKUP_CONTENT" }),
    );
  });

  it.each([
    {
      name: "numeric quantity",
      mutate: (input: Record<string, unknown>) => {
        const snapshots = input.snapshots as Record<string, unknown>[];
        const batchValue = snapshots[0]!.batch as Record<string, unknown>;
        const inputs = batchValue.inputs as Record<string, unknown>[];
        inputs[0]!.quantity = 1;
      },
    },
    {
      name: "invalid decimal",
      mutate: (input: Record<string, unknown>) => {
        const snapshots = input.snapshots as Record<string, unknown>[];
        const batchValue = snapshots[0]!.batch as Record<string, unknown>;
        const inputs = batchValue.inputs as Record<string, unknown>[];
        inputs[0]!.quantity = "1e3";
      },
    },
    {
      name: "invalid saved time",
      mutate: (input: Record<string, unknown>) => {
        const snapshots = input.snapshots as Record<string, unknown>[];
        snapshots[0]!.savedAt = "2026-02-30T02:00:00Z";
      },
    },
    {
      name: "revision without room for next revision",
      mutate: (input: Record<string, unknown>) => {
        const snapshots = input.snapshots as Record<string, unknown>[];
        snapshots[0]!.revision = Number.MAX_SAFE_INTEGER;
      },
    },
  ])("rejects $name without coercion", ({ mutate }) => {
    const input = JSON.parse(
      createPositionBackupFile(
        createPositionBackupDocument(
          [snapshot(AAPL, "input-1", "1", "100")],
          "2026-08-09T02:00:00Z",
        ),
      ).contents,
    ) as Record<string, unknown>;
    mutate(input);

    expect(() => parsePositionBackupDocument(input)).toThrowError(
      expect.objectContaining({
        code: "INVALID_BACKUP_CONTENT",
      }),
    );
  });

  it("rejects an invalid cash decimal", () => {
    const valid = createPositionBackupDocument(
      [],
      "2026-08-09T02:00:00Z",
      CASH_SNAPSHOT,
    );
    const input = JSON.parse(
      JSON.stringify(valid),
    ) as Record<string, unknown>;
    const cash = input.cash as Record<string, unknown>;
    const account = cash.account as Record<string, unknown>;
    account.balance = "0";

    expect(() => parsePositionBackupDocument(input)).toThrowError(
      expect.objectContaining({
        code: "INVALID_BACKUP_CONTENT",
      }),
    );
  });

  it("rejects cash whose fallback NAV does not equal its balance", () => {
    const valid = createPositionBackupDocument(
      [],
      "2026-08-09T02:00:00Z",
      CASH_SNAPSHOT,
    );
    const input = JSON.parse(JSON.stringify(valid)) as {
      cash: {
        account: {
          navSource: string;
        };
      };
    };
    input.cash.account.navSource = "CASH_BALANCE_FALLBACK";

    expect(() => parsePositionBackupDocument(input)).toThrowError(
      expect.objectContaining({ code: "INVALID_BACKUP_CONTENT" }),
    );
  });
});

interface PositionBackupDocumentShape {
  readonly cash: {
    readonly account: {
      readonly balance: unknown;
    };
  } | null;
  readonly snapshots: readonly {
    readonly batch: {
      readonly inputs: readonly {
        readonly quantity: unknown;
        readonly costInput: {
          readonly value: unknown;
        };
      }[];
    };
  }[];
}
