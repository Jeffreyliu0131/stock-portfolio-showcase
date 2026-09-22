import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudPortfolioRepository } from "../application/cloud/browser/cloud-portfolio-repository.ts";
import { PositionRepositoryError } from "../application/positions/types.ts";

const AAPL = {
  listingMarket: "NASDAQ",
  symbol: "AAPL",
  currency: "USD",
} as const;

const snapshot = {
  revision: 1,
  savedAt: "2026-08-20T06:00:00.000Z",
  batch: {
    instrument: AAPL,
    displayName: "Apple Inc.",
    inputs: [
      {
        id: "aapl-1",
        instrument: AAPL,
        quantity: "1",
        costInput: { mode: "TOTAL_OPEN_COST" as const, value: "100" },
      },
    ],
  },
};

function state(snapshots: readonly typeof snapshot[] = []) {
  return {
    kind: "CLOUD_PORTFOLIO_STATE",
    version: 1,
    stateRevision: snapshots.length,
    snapshots,
    previousSnapshots: [],
    cash: null,
    previousCash: null,
    brokerBook: null,
    previousBrokerBook: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CloudPortfolioRepository", () => {
  it("reads authenticated account current from the same-origin API", async () => {
    const fetch = vi.fn(async () =>
      Response.json(state([snapshot]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    const repository = new CloudPortfolioRepository();
    expect(await repository.listSnapshots()).toEqual([snapshot]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/portfolio",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
  });

  it("writes through the API and reuses the returned current", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.action).toBe("REPLACE_BATCH");
      return Response.json({
        kind: "CLOUD_PORTFOLIO_MUTATION_RESULT",
        action: "REPLACE_BATCH",
        changed: true,
        state: state([snapshot]),
      });
    });
    vi.stubGlobal("fetch", fetch);

    const repository = new CloudPortfolioRepository();
    expect(
      await repository.replaceBatch(snapshot.batch, {
        expectedRevision: null,
      }),
    ).toEqual(snapshot);
    expect(await repository.listSnapshots()).toEqual([snapshot]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps a stale cloud write to a typed zero-write conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            kind: "CLOUD_PORTFOLIO_ERROR",
            code: "CONFLICT",
            message: "账号持仓已变化",
          },
          { status: 409 },
        ),
      ),
    );

    const repository = new CloudPortfolioRepository();
    await expect(
      repository.replaceBatch(snapshot.batch, { expectedRevision: 1 }),
    ).rejects.toMatchObject({
      code: "POSITION_SNAPSHOT_CONFLICT",
    } satisfies Partial<PositionRepositoryError>);
  });
});
