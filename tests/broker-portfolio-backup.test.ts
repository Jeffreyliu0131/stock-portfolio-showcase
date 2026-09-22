import { describe, expect, it } from "vitest";

import {
  BROKER_PORTFOLIO_BACKUP_FORMAT,
  createBrokerPortfolioBackupDocument,
  createBrokerPortfolioBackupFile,
  parseBrokerPortfolioBackupJson,
} from "../application/brokerage/index.ts";
import { reconcileBrokerPortfolio } from "../domain/index.ts";
import { AAPL } from "./helpers.ts";

function book() {
  return reconcileBrokerPortfolio(
    null,
    {
      positions: [
        {
          broker: "IBKR",
          instrument: AAPL,
          quantity: "1.25",
          totalOpenCost: "200.5",
        },
      ],
      cashAccounts: [
        {
          broker: "IBKR",
          currency: "USD",
          settledBalance: "1000",
          pendingBalance: "50",
        },
        {
          broker: "MOOMOO",
          currency: "USD",
          settledBalance: "200",
          pendingBalance: "-25",
        },
      ],
      effectiveAt: "2026-08-20T01:00:00Z",
    },
    "2026-08-20T01:00:00Z",
    "baseline",
  );
}

describe("broker portfolio backup", () => {
  it("round trips a strict v3 current book with decimal strings", () => {
    const document = createBrokerPortfolioBackupDocument(
      book(),
      "2026-08-20T02:00:00Z",
    );
    const file = createBrokerPortfolioBackupFile(document);

    expect(document.format).toBe(BROKER_PORTFOLIO_BACKUP_FORMAT);
    expect(parseBrokerPortfolioBackupJson(file.contents)).toEqual(document);
    expect(file.fileName).toContain("broker-backup");
  });

  it("rejects unknown top-level fields", () => {
    const document = createBrokerPortfolioBackupDocument(
      book(),
      "2026-08-20T02:00:00Z",
    );

    expect(() =>
      parseBrokerPortfolioBackupJson(
        JSON.stringify({ ...document, unexpected: true }),
      ),
    ).toThrow(/unknown fields/);
  });

  it("rejects unknown nested financial fields", () => {
    const document = createBrokerPortfolioBackupDocument(
      book(),
      "2026-08-20T02:00:00Z",
    );
    const mutable = structuredClone(document) as unknown as {
      book: { cashAccounts: Array<Record<string, unknown>> };
    };
    mutable.book.cashAccounts[0]!.secretBalance = "999";

    expect(() => parseBrokerPortfolioBackupJson(JSON.stringify(mutable))).toThrow(
      /unknown fields/,
    );
  });
});
