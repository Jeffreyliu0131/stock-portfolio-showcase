// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexedDbPositionRepository } from "../application/positions/index.ts";
import { AAPL } from "../tests/helpers.ts";
import { CashEntryForm } from "./cash-entry-form.tsx";

const router = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

afterEach(() => {
  cleanup();
  router.push.mockReset();
  vi.unstubAllGlobals();
});

describe("CashEntryForm", () => {
  it("saves IBKR cash without rewriting an existing stock position", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    const seedRepository = new IndexedDbPositionRepository({ indexedDB });
    const position = await seedRepository.replaceBatch({
      instrument: AAPL,
      displayName: "Apple Inc.",
      inputs: [
        {
          id: "existing-position",
          instrument: AAPL,
          quantity: "10",
          costInput: { mode: "TOTAL_OPEN_COST", value: "1000" },
        },
      ],
    });
    await seedRepository.close();

    render(<CashEntryForm />);
    await screen.findByRole("heading", { name: "录入 IBKR 现金" });
    fireEvent.change(screen.getByLabelText("IBKR USD 现金余额"), {
      target: { value: "20000" },
    });
    fireEvent.change(
      screen.getByLabelText("IBKR 账户净资产 NAV（可选）"),
      { target: { value: "80000" } },
    );

    expect(screen.getByText("+$250.40")).toBeInTheDocument();
    expect(screen.getByText("2.50%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存现金" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/");
    });

    const repository = new IndexedDbPositionRepository({ indexedDB });
    await expect(repository.getCashSnapshot()).resolves.toMatchObject({
      revision: 1,
      account: {
        balance: "20000",
        netAssetValue: "80000",
        navSource: "USER_ENTERED",
        pricingPlan: "IBKR_PRO",
      },
    });
    await expect(repository.getSnapshot(AAPL)).resolves.toEqual(position);
    await repository.close();
  });

  it("requires a second confirmation and deletes only the cash record", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    const seedRepository = new IndexedDbPositionRepository({ indexedDB });
    const position = await seedRepository.replaceBatch({
      instrument: AAPL,
      inputs: [
        {
          id: "existing-position",
          instrument: AAPL,
          quantity: "1",
          costInput: { mode: "TOTAL_OPEN_COST", value: "100" },
        },
      ],
    });
    await seedRepository.replaceCashAccount({
      provider: "IBKR",
      currency: "USD",
      balance: "15000",
      netAssetValue: "15000",
      navSource: "CASH_BALANCE_FALLBACK",
      pricingPlan: "IBKR_PRO",
    });
    await seedRepository.close();

    render(<CashEntryForm />);
    await screen.findByRole("heading", { name: "修改 IBKR 现金" });
    expect(screen.getByLabelText("IBKR USD 现金余额")).toHaveValue(
      "15000",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "删除现金记录" }),
    );
    expect(
      screen.getByText(/股票持仓不会受影响/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/");
    });

    const repository = new IndexedDbPositionRepository({ indexedDB });
    await expect(repository.getCashSnapshot()).resolves.toBeNull();
    await expect(repository.getSnapshot(AAPL)).resolves.toEqual(position);
    await repository.close();
  });
});
