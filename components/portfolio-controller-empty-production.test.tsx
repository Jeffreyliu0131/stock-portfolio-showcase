// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { restoreCurrentBackup } = vi.hoisted(() => ({
  restoreCurrentBackup: vi.fn(),
}));

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
        return null;
      }

      restoreCurrentBackup = restoreCurrentBackup;
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

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  window.localStorage.clear();
  restoreCurrentBackup.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("portfolio controller production startup", () => {
  it("keeps a new browser origin empty without writing current assets or a marker", async () => {
    render(<PortfolioController />);

    expect(
      await screen.findByRole("heading", { name: "还没有资产" }),
    ).toBeInTheDocument();
    expect(restoreCurrentBackup).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
  });
});
