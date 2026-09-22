// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const cashSnapshot = {
  revision: 1,
  savedAt: "2026-08-08T08:00:00Z",
  account: {
    provider: "IBKR" as const,
    currency: "USD" as const,
    balance: "25000",
    netAssetValue: "80000",
    navSource: "USER_ENTERED" as const,
    pricingPlan: "IBKR_PRO" as const,
  },
};

vi.mock("../application/positions/index.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../application/positions/index.ts")
  >();
  return {
    ...actual,
    IndexedDbPositionRepository: class {
      async listSnapshots() {
        return [];
      }

      async getCashSnapshot() {
        return cashSnapshot;
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

import { PortfolioController } from "./portfolio-controller.tsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("portfolio controller lifecycle", () => {
  it("finishes the local portfolio load when StrictMode replays the mount effect", async () => {
    render(
      <StrictMode>
        <PortfolioController />
      </StrictMode>,
    );

    expect(
      await screen.findByRole("region", { name: "估算总资产" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$25,000.00")).not.toHaveLength(0);
    expect(
      screen.queryByRole("main", { name: "正在载入总仓位" }),
    ).not.toBeInTheDocument();
  });
});
