// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getCashSnapshot = vi.fn();
const listSnapshots = vi.fn();

vi.mock("../application/positions/index.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../application/positions/index.ts")
  >();
  return {
    ...actual,
    IndexedDbPositionRepository: class {
      async getBrokerPortfolioBook() {
        return {
          revision: 1,
          savedAt: "2026-08-20T01:00:00Z",
          positions: [
            {
              broker: "IBKR",
              instrument: {
                listingMarket: "NASDAQ",
                symbol: "AAPL",
                currency: "USD",
              },
              displayName: "Apple Inc.",
              quantity: "2",
              totalOpenCost: "200",
            },
            {
              broker: "MOOMOO",
              instrument: {
                listingMarket: "NASDAQ",
                symbol: "AAPL",
                currency: "USD",
              },
              displayName: "Apple Inc.",
              quantity: "1",
              totalOpenCost: "120",
            },
          ],
          cashAccounts: [
            {
              broker: "IBKR",
              currency: "USD",
              settledBalance: "1000",
              pendingBalance: "50",
              pricingPlan: "IBKR_PRO",
              netAssetValue: "50000",
              navSource: "USER_ENTERED",
            },
            {
              broker: "MOOMOO",
              currency: "USD",
              settledBalance: "300",
              pendingBalance: "0",
            },
          ],
          events: [
            {
              id: "baseline",
              type: "RECONCILIATION",
              effectiveAt: "2026-08-20T01:00:00Z",
              recordedAt: "2026-08-20T01:00:00Z",
              reason: "baseline",
            },
          ],
        };
      }

      listSnapshots = listSnapshots;
      getCashSnapshot = getCashSnapshot;
    },
  };
});

vi.mock("../application/fx/browser/usd-cny-rate-client.ts", () => ({
  requestUsdCnyRate: vi.fn().mockRejectedValue(new Error("no fx")),
}));
vi.mock("../application/market-data/browser/quote-client.ts", () => ({
  requestDelayedQuotes: vi.fn().mockResolvedValue({
    generatedAt: "2026-08-20T02:00:00Z",
    quotes: [],
  }),
}));
vi.mock("../application/market-data/browser/intraday-bars-client.ts", () => ({
  requestIntradayBars: vi.fn().mockRejectedValue(new Error("no bars")),
}));

import { PortfolioController } from "./portfolio-controller.tsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortfolioController broker book", () => {
  it("projects one unified stock row, one cash pool, and buy/sell actions", async () => {
    render(<PortfolioController />);

    await screen.findByRole("heading", { name: "总仓位" });
    expect(screen.getByText("3 股")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /组合 USD 现金 \$1,350\.00/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/统一现金池/)).toBeInTheDocument();
    expect(screen.queryByText("MOOMOO 现金")).not.toBeInTheDocument();
    expect(listSnapshots).not.toHaveBeenCalled();
    expect(getCashSnapshot).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: /AAPL Apple Inc\. 持仓，点按或长按打开操作/,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "AAPL 持仓操作" });
    expect(within(dialog).getByRole("link", { name: /买入/ })).toHaveAttribute(
      "href",
      expect.stringContaining("side=BUY"),
    );
    expect(within(dialog).getByRole("link", { name: /卖出/ })).toHaveAttribute(
      "href",
      expect.stringContaining("side=SELL"),
    );
    expect(within(dialog).queryByText("删除持仓")).not.toBeInTheDocument();
  });
});
