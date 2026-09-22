// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexedDbPositionRepository } from "../application/positions/index.ts";
import { instrumentKeyId } from "../domain/index.ts";
import { AAPL } from "../tests/helpers.ts";
import { BrokerTradeForm } from "./broker-trade-form.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("BrokerTradeForm", () => {
  it("records a sell against the selected broker and its cash", async () => {
    let clockIndex = 0;
    const timestamps = [
      "2026-08-20T01:00:00Z",
      "2026-08-20T02:00:00Z",
    ];
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: "trade-component",
      now: () => timestamps[clockIndex++]!,
    });
    await repository.replaceBrokerPortfolioBaseline(
      {
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
            settledBalance: "500",
            pendingBalance: "0",
          },
          {
            broker: "MOOMOO",
            currency: "USD",
            settledBalance: "100",
            pendingBalance: "0",
          },
        ],
        effectiveAt: "2026-08-20T01:00:00Z",
      },
      { expectedRevision: null, eventId: "baseline" },
    );

    render(
      <BrokerTradeForm
        repository={repository}
        initialSide="SELL"
        initialInstrumentKey={instrumentKeyId(AAPL)}
      />,
    );
    await screen.findByRole("heading", { name: "卖出股票" });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "4" } });
    fireEvent.change(inputs[1]!, { target: { value: "120" } });
    fireEvent.change(inputs[2]!, { target: { value: "1" } });
    expect(screen.getByText("组合现金").nextElementSibling).toHaveTextContent(
      "$600.00 → $1,079.00",
    );
    fireEvent.click(screen.getByRole("button", { name: "确认卖出" }));

    const book = await repository.getBrokerPortfolioBook();
    expect(book).toMatchObject({
      revision: 2,
      positions: [expect.objectContaining({ quantity: "6", totalOpenCost: "600" })],
      cashAccounts: expect.arrayContaining([
        expect.objectContaining({ broker: "IBKR", pendingBalance: "479" }),
      ]),
    });
    expect(push).toHaveBeenCalledWith("/");
    await repository.close();
  });
});
