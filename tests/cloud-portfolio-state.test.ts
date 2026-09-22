import { describe, expect, it } from "vitest";

import {
  applyCloudPortfolioMutation,
  cloudPortfolioStateView,
  emptyCloudPortfolioState,
} from "../application/cloud/portfolio-state.ts";
import {
  parseCloudPortfolioMutation,
  parseCloudPortfolioStateView,
} from "../application/cloud/portfolio-api.ts";
import {
  PositionRepositoryError,
  type PositionBatch,
} from "../application/positions/types.ts";
import {
  createPositionBackupDocument,
} from "../application/positions/position-backup.ts";
import { brokerCashBookBalance } from "../domain/index.ts";
import {
  D1PortfolioStore,
} from "../application/cloud/server/d1-portfolio-store.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResultLike,
} from "../db/index.ts";

const NOW = "2026-08-20T06:00:00.000Z";
const AAPL = {
  listingMarket: "NASDAQ",
  symbol: "AAPL",
  currency: "USD",
} as const;

function batch(quantity = "10", cost = "1000"): PositionBatch {
  return {
    instrument: AAPL,
    displayName: "Apple Inc.",
    inputs: [
      {
        id: "aapl-input-1",
        instrument: AAPL,
        quantity,
        costInput: { mode: "TOTAL_OPEN_COST", value: cost },
      },
    ],
  };
}

describe("cloud portfolio state", () => {
  it("creates account current data and enforces optimistic revisions", () => {
    const first = applyCloudPortfolioMutation(
      emptyCloudPortfolioState(),
      {
        action: "REPLACE_BATCH",
        batch: batch(),
        options: { expectedRevision: null },
      },
      NOW,
    );

    expect(first.state.positions[0]?.current).toMatchObject({
      revision: 1,
      savedAt: NOW,
    });

    expect(() =>
      applyCloudPortfolioMutation(
        first.state,
        {
          action: "REPLACE_BATCH",
          batch: batch("11", "1100"),
          options: { expectedRevision: null },
        },
        "2026-08-20T06:01:00.000Z",
      ),
    ).toThrowError(PositionRepositoryError);

    const second = applyCloudPortfolioMutation(
      first.state,
      {
        action: "ADD_INPUTS",
        batch: {
          ...batch("1", "120"),
          inputs: [
            {
              ...batch("1", "120").inputs[0]!,
              id: "aapl-input-2",
            },
          ],
        },
        options: { expectedRevision: 1 },
      },
      "2026-08-20T06:01:00.000Z",
    );
    expect(second.state.positions[0]?.current.revision).toBe(2);
    expect(second.state.positions[0]?.current.batch.inputs).toHaveLength(2);
    expect(second.state.positions[0]?.previous?.revision).toBe(1);
  });

  it("keeps broker stock and cash in one state transition", () => {
    const reconciled = applyCloudPortfolioMutation(
      emptyCloudPortfolioState(),
      {
        action: "RECONCILE_BROKER",
        baseline: {
          positions: [
            {
              broker: "IBKR",
              instrument: AAPL,
              displayName: "Apple Inc.",
              quantity: "10",
              totalOpenCost: "1000",
            },
          ],
          cashAccounts: [
            {
              broker: "IBKR",
              currency: "USD",
              settledBalance: "2000",
              pendingBalance: "0",
            },
            {
              broker: "MOOMOO",
              currency: "USD",
              settledBalance: "500",
              pendingBalance: "0",
            },
          ],
          effectiveAt: NOW,
        },
        options: { expectedRevision: null, eventId: "reconcile-1" },
      },
      NOW,
    );

    const traded = applyCloudPortfolioMutation(
      reconciled.state,
      {
        action: "APPLY_BROKER_TRADE",
        trade: {
          id: "buy-1",
          side: "BUY",
          broker: "MOOMOO",
          instrument: AAPL,
          displayName: "Apple Inc.",
          quantity: "1.5",
          unitPrice: "120",
          fee: "1",
          cashStatus: "SETTLED",
          effectiveAt: "2026-08-20T06:02:00.000Z",
        },
        options: { expectedRevision: 1 },
      },
      "2026-08-20T06:02:00.000Z",
    );

    const book = traded.state.broker?.current;
    expect(book?.revision).toBe(2);
    expect(book?.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ broker: "IBKR", quantity: "10" }),
        expect.objectContaining({ broker: "MOOMOO", quantity: "1.5" }),
      ]),
    );
    const moomooCash = book?.cashAccounts.find(
      (account) => account.broker === "MOOMOO",
    );
    expect(moomooCash && brokerCashBookBalance(moomooCash)).toBe("319");
  });

  it("restores v2 only into an empty account and resets revisions", () => {
    const source = {
      revision: 17,
      savedAt: "2026-08-19T00:00:00.000Z",
      batch: batch(),
    };
    const backup = createPositionBackupDocument(
      [source],
      "2026-08-20T05:00:00.000Z",
      null,
    );
    const restored = applyCloudPortfolioMutation(
      emptyCloudPortfolioState(),
      { action: "RESTORE_V2", backup },
      NOW,
    );
    expect(restored.state.positions[0]?.current.revision).toBe(1);
    expect(restored.restoreResult).toEqual({
      positionCount: 1,
      cashRestored: false,
    });

    expect(() =>
      applyCloudPortfolioMutation(
        restored.state,
        { action: "RESTORE_V2", backup },
        NOW,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "BACKUP_RESTORE_TARGET_NOT_EMPTY" }),
    );
  });

  it("strictly parses mutations and round-trips the account view", () => {
    expect(() =>
      parseCloudPortfolioMutation({
        action: "DELETE_POSITION",
        instrument: AAPL,
        options: {},
        unexpected: true,
      }),
    ).toThrow(/unknown fields/);

    const state = applyCloudPortfolioMutation(
      emptyCloudPortfolioState(),
      {
        action: "REPLACE_BATCH",
        batch: batch(),
        options: { expectedRevision: null },
      },
      NOW,
    ).state;
    const view = cloudPortfolioStateView(state, 9);
    expect(parseCloudPortfolioStateView(JSON.parse(JSON.stringify(view)))).toEqual(
      view,
    );
  });
});

interface FakeRow {
  stateVersion: number;
  stateJson: string;
}

class FakeStatement implements D1PreparedStatementLike {
  readonly #database: FakeD1;
  readonly #sql: string;
  #values: readonly unknown[] = [];

  constructor(database: FakeD1, sql: string) {
    this.#database = database;
    this.#sql = sql;
  }

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    this.#values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (!this.#sql.startsWith("SELECT state_json")) {
      throw new Error("unsupported fake first query");
    }
    const userId = String(this.#values[0]);
    const row = this.#database.rows.get(userId);
    return (row === undefined
      ? null
      : {
          state_json: row.stateJson,
          state_version: row.stateVersion,
        }) as T | null;
  }

  async run(): Promise<D1RunResultLike> {
    if (this.#sql.startsWith("CREATE TABLE")) {
      return { meta: { changes: 0 } };
    }
    if (this.#sql.startsWith("INSERT OR IGNORE")) {
      const userId = String(this.#values[0]);
      if (this.#database.rows.has(userId)) {
        return { meta: { changes: 0 } };
      }
      this.#database.rows.set(userId, {
        stateVersion: 1,
        stateJson: String(this.#values[1]),
      });
      return { meta: { changes: 1 } };
    }
    if (this.#sql.startsWith("UPDATE user_portfolios")) {
      const nextRevision = Number(this.#values[0]);
      const stateJson = String(this.#values[1]);
      const userId = String(this.#values[3]);
      const expectedRevision = Number(this.#values[4]);
      const existing = this.#database.rows.get(userId);
      if (existing?.stateVersion !== expectedRevision) {
        return { meta: { changes: 0 } };
      }
      this.#database.rows.set(userId, {
        stateVersion: nextRevision,
        stateJson,
      });
      return { meta: { changes: 1 } };
    }
    throw new Error("unsupported fake run query");
  }
}

class FakeD1 implements D1DatabaseLike {
  readonly rows = new Map<string, FakeRow>();

  prepare(sql: string): D1PreparedStatementLike {
    return new FakeStatement(this, sql);
  }

  async batch(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1RunResultLike[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

describe("D1 portfolio account isolation", () => {
  it("uses the authenticated Sites user id as the storage partition", async () => {
    const database = new FakeD1();
    const store = new D1PortfolioStore(database);

    await store.mutate(
      "chatgpt-user-a",
      {
        action: "REPLACE_BATCH",
        batch: batch(),
        options: { expectedRevision: null },
      },
      NOW,
    );

    const first = await store.load("chatgpt-user-a");
    const second = await store.load("chatgpt-user-b");
    expect(first.state.positions).toHaveLength(1);
    expect(first.stateRevision).toBe(1);
    expect(second.state.positions).toHaveLength(0);
    expect(second.stateRevision).toBe(0);
    expect(database.rows).toHaveLength(1);
  });
});
