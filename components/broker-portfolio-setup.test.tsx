// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexedDbPositionRepository } from "../application/positions/index.ts";
import { AAPL } from "../tests/helpers.ts";
import { BrokerPortfolioSetup } from "./broker-portfolio-setup.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("../application/instruments/browser/instrument-client.ts", () => ({
  requestInstrumentResolution: vi.fn(async (symbol: string) => ({
    instrument: { listingMarket: "NASDAQ", symbol, currency: "USD" },
    displayName: "Apple Inc.",
  })),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("BrokerPortfolioSetup", () => {
  it("adds a current holding that was missing from the legacy aggregate", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: "setup-add-symbol",
    });
    render(<BrokerPortfolioSetup repository={repository} />);
    await screen.findByRole("heading", { name: "启用双券商账本" });
    fireEvent.change(
      screen.getByPlaceholderText("股票代码，例如 BOXX"),
      { target: { value: "AAPL" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "添加到校准" }));

    expect(await screen.findByText("Apple Inc.")).toBeInTheDocument();
    await repository.close();
  });

  it("creates a reviewed broker baseline while preserving legacy current", async () => {
    const repository = new IndexedDbPositionRepository({
      indexedDB: new IDBFactory(),
      databaseName: "setup-component",
      now: () => "2026-08-20T01:00:00Z",
    });
    const legacy = await repository.replaceBatch({
      instrument: AAPL,
      displayName: "Apple Inc.",
      inputs: [
        {
          id: "legacy-aapl",
          instrument: AAPL,
          quantity: "10",
          costInput: { mode: "TOTAL_OPEN_COST", value: "1000" },
        },
      ],
    });

    render(<BrokerPortfolioSetup repository={repository} />);
    const heading = await screen.findByRole("heading", {
      name: "启用双券商账本",
    });
    expect(heading).toBeInTheDocument();
    const stock = screen.getByText("AAPL").closest("article")!;
    const assignButtons = within(stock).getAllByRole("button", {
      name: "旧值全部归这里",
    });
    fireEvent.click(assignButtons[0]!);
    fireEvent.click(screen.getByRole("button", { name: "检查并生成预览" }));

    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "确认启用双券商账本" }),
    );

    expect(await repository.getBrokerPortfolioBook()).toMatchObject({
      revision: 1,
      positions: [
        expect.objectContaining({
          broker: "IBKR",
          quantity: "10",
          totalOpenCost: "1000",
        }),
      ],
    });
    expect(await repository.getSnapshot(AAPL)).toEqual(legacy);
    expect(push).toHaveBeenCalledWith("/");
    await repository.close();
  });
});
