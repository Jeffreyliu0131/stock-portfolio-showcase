import { describe, expect, it, vi } from "vitest";

import { copyPortfolioText } from "../application/positions/browser/copy-portfolio-text.ts";

describe("copyPortfolioText", () => {
  it("invokes the clipboard writer synchronously before awaiting completion", async () => {
    let resolveWrite: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const writeText = vi.fn(() => pending);

    const result = copyPortfolioText("持仓资料", {
      clipboard: { writeText },
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("持仓资料");
    resolveWrite?.();
    await expect(result).resolves.toBe("copied");
  });

  it("returns a manual fallback when clipboard access is unavailable", async () => {
    await expect(copyPortfolioText("持仓资料", {})).resolves.toBe(
      "manual-fallback",
    );
  });

  it("returns a manual fallback when the platform rejects the write", async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });

    await expect(
      copyPortfolioText("持仓资料", { clipboard: { writeText } }),
    ).resolves.toBe("manual-fallback");
    expect(writeText).toHaveBeenCalledOnce();
  });
});
