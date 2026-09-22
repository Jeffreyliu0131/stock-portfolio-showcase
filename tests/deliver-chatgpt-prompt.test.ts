import { describe, expect, it, vi } from "vitest";

import {
  buildChatGptPromptUrl,
  deliverChatGptPrompt,
} from "../application/positions/browser/deliver-chatgpt-prompt.ts";

describe("deliverChatGptPrompt", () => {
  it("copies first and navigates synchronously without waiting for the clipboard", async () => {
    const calls: string[] = [];
    let resolveWrite: (() => void) | undefined;
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const writeText = vi.fn((_text: string) => {
      calls.push("clipboard");
      return pendingWrite;
    });
    const navigate = vi.fn((_url: string) => {
      calls.push("navigate");
    });

    const result = deliverChatGptPrompt("持仓资料", {
      clipboard: { writeText },
      navigate,
    });

    expect(calls).toEqual(["clipboard", "navigate"]);
    expect(writeText).toHaveBeenCalledWith("持仓资料");
    expect(navigate).toHaveBeenCalledWith(
      "https://chatgpt.com/?prompt=%E6%8C%81%E4%BB%93%E8%B5%84%E6%96%99",
    );

    resolveWrite?.();
    await expect(result).resolves.toBe("copied");
  });

  it("still navigates and returns manual fallback without clipboard access", async () => {
    const navigate = vi.fn();

    const result = deliverChatGptPrompt("持仓资料", { navigate });

    expect(navigate).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe("manual-fallback");
  });

  it("still navigates when the clipboard write is rejected", async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    const navigate = vi.fn();

    const result = deliverChatGptPrompt("持仓资料", {
      clipboard: { writeText },
      navigate,
    });

    expect(navigate).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe("manual-fallback");
  });

  it("encodes the complete prompt as one query value", () => {
    const prompt = "NVDA & MSFT\n问题：收益率 + 10%？";

    expect(buildChatGptPromptUrl(prompt)).toBe(
      `https://chatgpt.com/?prompt=${encodeURIComponent(prompt)}`,
    );
  });
});
