// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repositoryScenario = vi.hoisted(() => ({ hasStock: false }));

vi.mock("../application/positions/index.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../application/positions/index.ts")
  >();
  return {
    ...actual,
    IndexedDbPositionRepository: class {
      async listSnapshots() {
        if (!repositoryScenario.hasStock) {
          return [];
        }
        const instrument = {
          listingMarket: "NASDAQ",
          symbol: "AAPL",
          currency: "USD",
        } as const;
        return [
          {
            revision: 1,
            savedAt: "2026-08-09T13:00:00Z",
            batch: {
              instrument,
              displayName: "Apple Inc.",
              inputs: [
                {
                  id: "aapl-current",
                  instrument,
                  quantity: "1",
                  costInput: {
                    mode: "TOTAL_OPEN_COST",
                    value: "100",
                  },
                },
              ],
            },
          },
        ];
      }

      async getCashSnapshot() {
        throw new Error("cash store unavailable");
      }
    },
  };
});

vi.mock(
  "../application/fx/browser/usd-cny-rate-client.ts",
  () => ({
    requestUsdCnyRate: vi
      .fn()
      .mockRejectedValue(new Error("rate unavailable in test")),
  }),
);

vi.mock(
  "../application/market-data/browser/quote-client.ts",
  () => ({
    requestDelayedQuotes: vi
      .fn()
      .mockResolvedValue({
        generatedAt: "2026-08-09T14:00:00Z",
        quotes: [],
      }),
  }),
);

import { PortfolioController } from "./portfolio-controller.tsx";

beforeEach(() => {
  repositoryScenario.hasStock = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("portfolio controller cash-read safety", () => {
  it("does not report an empty portfolio when cash existence cannot be verified", async () => {
    render(<PortfolioController />);

    expect(
      await screen.findByRole("heading", { name: "无法读取持仓" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/无法确认账号现金记录/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "还没有资产" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
  });

  it("keeps stocks visible but suppresses structure insights when cash cannot be read", async () => {
    repositoryScenario.hasStock = true;
    render(<PortfolioController />);

    expect(
      await screen.findByRole("heading", { name: "总仓位" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/现金记录暂时无法读取/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    const more = screen.getByRole("dialog", { name: "更多操作" });
    expect(
      within(more).queryByRole("button", {
        name: /组合分析/,
      }),
    ).not.toBeInTheDocument();
  });
});
