import { webcrypto } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  parseHistoryImportFiles,
  parseHistoryImportText,
} from "../application/history/history-import.ts";

function localFile(name: string, text: string, type = "text/plain") {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(0),
  };
}

beforeAll(() => {
  if (globalThis.crypto?.subtle === undefined) {
    vi.stubGlobal("crypto", webcrypto);
  }
});

describe("local broker history import", () => {
  it("extracts two real NAV anchors from a synthetic moomoo monthly statement", async () => {
    const statement = `
      Monthly Statement of Margin Account
      Account Number: SYNTH-MOOMOO-0001
      Changes in Net Asset Value
      Starting Net Asset Value 20260630
      USD HKD CNH Equal to(USD)
      100,000.00 99,960.00 exchange rate : 1.000000
      Ending Net Asset Value 20260731
      USD HKD CNH Equal to(USD)
      110,000.00 109,960.00 exchange rate : 1.000000
      Changes in Cash USD HKD CNH
      Cash Dividend +100.00 0.00 0.00
      NRA Withholding Tax -10.00 0.00 0.00
      Total +90.00 0.00 0.00
      Changes in Position Value
    `;
    const [candidate] = await parseHistoryImportFiles(
      [localFile("statement.txt", statement)],
      { now: () => "2026-08-11T00:00:00Z" },
    );

    expect(candidate?.document).toMatchObject({ broker: "MOOMOO", eventCount: 2 });
    expect(candidate?.issues.some((issue) => issue.severity === "BLOCKING")).toBe(false);
    expect(candidate?.events).toEqual([
      expect.objectContaining({ type: "NAV_SNAPSHOT", valueUsd: "100000" }),
      expect.objectContaining({ type: "NAV_SNAPSHOT", valueUsd: "110000" }),
    ]);
    expect(candidate?.events[0]).not.toHaveProperty("accountNumber");
  });

  it("deduplicates IBKR execution repeats and keeps options separate from stocks", async () => {
    const csv = [
      "Account,Symbol,Date/Time,Type,Quantity,Price,Commission,TradeID,Asset Category,Broker",
      "U99999999,AAPL,2026-01-23 11:22:08,BUY,25,248.60,0.32,T-1,Stocks,Interactive Brokers",
      "U99999999,AAPL,2026-01-23 11:22:08,BUY,25,248.60,0.32,T-1,Stocks,Interactive Brokers",
      "U99999999,GOOG 27FEB26 285 P,2026-02-05 10:12:34,SELL,-1,2.13,1.05,T-2,Options,Interactive Brokers",
    ].join("\n");
    const [candidate] = await parseHistoryImportFiles(
      [localFile("trades.csv", csv, "text/csv")],
      { now: () => "2026-08-11T00:00:00Z" },
    );

    expect(candidate?.events).toHaveLength(2);
    expect(candidate?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "TRADE", symbol: "AAPL", assetClass: "STOCK" }),
        expect.objectContaining({
          type: "TRADE",
          symbol: "GOOG",
          assetClass: "OPTION",
          option: expect.objectContaining({ right: "PUT", strike: "285" }),
        }),
      ]),
    );
    expect(candidate?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MISSING_NAV", severity: "WARNING" })]),
    );
  });

  it("reads the duplicated summary/exchange rows from an IBKR text-layer confirmation", async () => {
    const report = `
      Interactive Brokers 交易确认报告
      U99999998 AAPL 2026-01-23, 11:22:08 2026-01-26 - BUY 25 248.6000 -6,215.00 -0.32 0.00 LMT O
      U99999998 AAPL 2026-01-23, 11:22:08 2026-01-26 NASDAQ BUY 25 248.6000 -6,215.00 -0.32 0.00 LMT O
      U99999998 GOOG 27FEB26 285 P 2026-02-05, 10:12:34 2026-02-06 BOX SELL -1 2.1300 213.00 -1.05 0.00 LMT O
    `;
    const [candidate] = await parseHistoryImportFiles(
      [localFile("confirmation.txt", report)],
      { now: () => "2026-08-11T00:00:00Z" },
    );

    expect(candidate?.events).toHaveLength(2);
    expect(candidate?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "TRADE", symbol: "AAPL", quantity: "25" }),
        expect.objectContaining({ type: "TRADE", symbol: "GOOG", assetClass: "OPTION" }),
      ]),
    );
  });

  it("blocks a cash label whose external/internal meaning cannot be proved", async () => {
    const statement = `
      Monthly Statement of Margin Account
      Account Number: SYNTH-MOOMOO-0002
      Starting Net Asset Value 20260630
      USD HKD CNH Equal to(USD)
      100,000.00
      Ending Net Asset Value 20260731
      USD HKD CNH Equal to(USD)
      101,000.00
      Changes in Cash USD HKD CNH
      Transfer In +1,000.00 0.00 0.00
      Total +1,000.00 0.00 0.00
      Changes in Position Value
    `;
    const [candidate] = await parseHistoryImportFiles(
      [localFile("statement.txt", statement)],
      { now: () => "2026-08-11T00:00:00Z" },
    );
    expect(candidate?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_CASH_CLASSIFICATION", severity: "BLOCKING" }),
      ]),
    );
  });

  it("explains why a current holdings snapshot cannot unlock long ranges", async () => {
    const candidate = await parseHistoryImportText(
      `
        持仓资料（USD）
        范围：全部资产（2 只股票 + IBKR 现金）
        【组合】
        估算总资产：$10,000.00
        【持仓（按市值降序）】
        | 排名 | 标的 | 数量（股） | 现价 |
        | 1/2 | AAA | 1 | $100.00 |
      `,
      { now: () => "2026-08-11T00:00:00Z" },
    );

    expect(candidate.events).toEqual([]);
    expect(candidate.issues).toEqual([
      expect.objectContaining({
        code: "CURRENT_SNAPSHOT_ONLY",
        severity: "BLOCKING",
        message: expect.stringContaining("只能支持当前估值与 1D"),
      }),
    ]);
  });

  it("keeps a prepared account-only history explicitly partial", async () => {
    const candidate = await parseHistoryImportText(
      `
        moomoo
        Monthly Statement of Margin Account
        Account Number: SYNTH-PARTIAL-HISTORY
        Portfolio Coverage: PARTIAL
        Starting Net Asset Value 20260630 Equal to(USD) 100,000.00
        Ending Net Asset Value 20260731 Equal to(USD) 110,000.00
      `,
      { now: () => "2026-08-11T00:00:00Z" },
    );

    expect(candidate.events).toEqual([
      expect.objectContaining({ type: "NAV_SNAPSHOT", coverage: "PARTIAL" }),
      expect.objectContaining({ type: "NAV_SNAPSHOT", coverage: "PARTIAL" }),
    ]);
  });
});
