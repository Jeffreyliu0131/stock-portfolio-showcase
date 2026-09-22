// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PortfolioHistoryCenter } from "./portfolio-history-center.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState({}, "", "/");
});

describe("PortfolioHistoryCenter", () => {
  it("records a future deposit only in the independent history store", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    render(<PortfolioHistoryCenter />);

    const summary = await screen.findByRole("region", {
      name: "历史数据概览",
    });
    expect(within(summary).getByText("外部现金流").nextElementSibling).toHaveTextContent("0");

    fireEvent.click(screen.getByRole("button", { name: "入金" }));
    fireEvent.change(screen.getByLabelText("发生时间"), {
      target: { value: "2026-08-11T10:30" },
    });
    fireEvent.change(screen.getByLabelText("USD 金额"), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存历史事件" }));

    expect(
      await screen.findByText(
        "外部现金流已记录，会进入长期收益调整；当前持仓未被修改。",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(summary).getByText("外部现金流").nextElementSibling).toHaveTextContent("1");
    });
    expect(screen.getByLabelText("USD 金额")).toHaveValue("");
  });

  it("exposes one multi-file local picker and the privacy boundary", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    render(<PortfolioHistoryCenter />);
    await screen.findByRole("region", { name: "历史数据概览" });

    const picker = screen.getByLabelText(/选择一个或多个文件/);
    expect(picker).toHaveAttribute("multiple");
    expect(picker).toHaveAttribute(
      "accept",
      ".csv,.pdf,.txt,text/csv,text/plain,application/pdf",
    );
    expect(
      screen.getByText(/原始文件、粘贴或提取文字、姓名和完整账户号不会上传或持久化/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从剪贴板读取" })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Starting Net Asset Value/),
    ).toBeInTheDocument();
  });

  it("previews and imports pasted monthly statement text without a file", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("crypto", webcrypto);
    render(<PortfolioHistoryCenter />);

    const summary = await screen.findByRole("region", { name: "历史数据概览" });
    const statement = `
      Monthly Statement of Margin Account
      Account Number: SYNTH-MOOMOO-PASTE
      Changes in Net Asset Value
      Starting Net Asset Value 20260630
      USD HKD CNH Equal to(USD)
      100,000.00 99,960.00 exchange rate : 1.000000
      Ending Net Asset Value 20260731
      USD HKD CNH Equal to(USD)
      110,000.00 109,960.00 exchange rate : 1.000000
      Changes in Cash USD HKD CNH
      Cash Dividend +100.00 0.00 0.00
      Total +100.00 0.00 0.00
      Changes in Position Value
    `;
    const textarea = screen.getByPlaceholderText(/Starting Net Asset Value/);
    fireEvent.change(textarea, { target: { value: statement } });
    fireEvent.click(screen.getByRole("button", { name: "预览粘贴内容" }));

    const preview = await screen.findByLabelText("导入预览");
    expect(within(preview).getByText("MOOMOO · TEXT")).toBeInTheDocument();
    expect(within(preview).getByText("2026年6月30日 – 2026年7月31日")).toBeInTheDocument();
    expect(within(preview).getByText("NAV").nextElementSibling).toHaveTextContent("2");
    expect(within(summary).getByText("NAV 点").nextElementSibling).toHaveTextContent("0");

    fireEvent.click(screen.getByRole("button", { name: "确认导入这批历史" }));
    expect(
      await screen.findByText("已导入 1 份资料、2 条新记录；0 项重复已跳过。"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(summary).getByText("导入批次").nextElementSibling).toHaveTextContent("1");
      expect(within(summary).getByText("NAV 点").nextElementSibling).toHaveTextContent("2");
    });
    expect(textarea).toHaveValue("");
  });

  it("reads statement text from the clipboard after a user action", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const navigatorWithClipboard = Object.create(globalThis.navigator) as Navigator;
    Object.defineProperty(navigatorWithClipboard, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue("Monthly Statement clipboard text") },
    });
    vi.stubGlobal("navigator", navigatorWithClipboard);
    render(<PortfolioHistoryCenter />);
    await screen.findByRole("region", { name: "历史数据概览" });

    fireEvent.click(screen.getByRole("button", { name: "从剪贴板读取" }));

    expect(
      await screen.findByText("已从剪贴板读取到本页内存；尚未解析或写入历史库。"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Starting Net Asset Value/)).toHaveValue(
      "Monthly Statement clipboard text",
    );
    expect(screen.getByRole("button", { name: "预览粘贴内容" })).toBeEnabled();
  });

  it("opens a fragment-delivered statement as a local preview and removes the fragment", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("crypto", webcrypto);
    const statement = `
      moomoo
      Monthly Statement of Margin Account
      Account Number: SYNTH-LINK-HISTORY
      Starting Net Asset Value 20260630 Equal to(USD) 100,000.00
      Ending Net Asset Value 20260731 Equal to(USD) 110,000.00
    `;
    const encoded = Buffer.from(statement, "utf8").toString("base64url");
    globalThis.history.replaceState({}, "", `/#history-text=${encoded}`);

    render(
      <StrictMode>
        <PortfolioHistoryCenter />
      </StrictMode>,
    );

    expect(await screen.findByText("MOOMOO · TEXT")).toBeInTheDocument();
    expect(
      screen.getByText(/iPhone 浏览器与主屏幕 App 的存储可能分开/),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Starting Net Asset Value/)).toHaveValue(statement);
    expect(globalThis.location.hash).toBe("");
    expect(screen.getByRole("button", { name: "确认导入这批历史" })).toBeEnabled();
  });

  it("removes a malformed history fragment without previewing or writing it", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    globalThis.history.replaceState({}, "", "/#history-text=%%%invalid%%%");

    render(<PortfolioHistoryCenter />);

    expect(
      await screen.findByText("一次性历史链接无效或已损坏，没有写入任何数据。"),
    ).toBeInTheDocument();
    expect(globalThis.location.hash).toBe("");
    expect(screen.queryByLabelText("导入预览")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "确认导入这批历史" }),
    ).not.toBeInTheDocument();
  });

  it("rejects and removes an oversized history fragment", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const encoded = "A".repeat(128 * 1024 * 2 + 1);
    globalThis.history.replaceState({}, "", `/#history-text=${encoded}`);

    render(<PortfolioHistoryCenter />);

    expect(
      await screen.findByText("一次性历史链接无效或已损坏，没有写入任何数据。"),
    ).toBeInTheDocument();
    expect(globalThis.location.hash).toBe("");
    expect(screen.queryByLabelText("导入预览")).not.toBeInTheDocument();
  });

  it("records a manual option with its full contract identity", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    render(<PortfolioHistoryCenter />);
    const summary = await screen.findByRole("region", { name: "历史数据概览" });

    fireEvent.change(screen.getByLabelText("发生时间"), {
      target: { value: "2026-08-11T10:30" },
    });
    fireEvent.change(screen.getByLabelText("资产类型"), {
      target: { value: "OPTION" },
    });
    fireEvent.change(screen.getByLabelText("期权标的代码"), {
      target: { value: "goog" },
    });
    fireEvent.change(screen.getByLabelText("到期日"), {
      target: { value: "2027-01-15" },
    });
    fireEvent.change(screen.getByLabelText("行权价 USD"), {
      target: { value: "270" },
    });
    fireEvent.change(screen.getByLabelText("期权类型"), {
      target: { value: "PUT" },
    });
    fireEvent.change(screen.getByLabelText("数量"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("成交价 USD"), {
      target: { value: "3.55" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存历史事件" }));

    expect(
      await screen.findByText("交易已记录用于历史审计；当前持仓未被自动修改。"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(summary).getByText("交易").nextElementSibling).toHaveTextContent("1");
    });
    expect(screen.getByLabelText("到期日")).toHaveValue("");
    expect(screen.getByLabelText("行权价 USD")).toHaveValue("");
  });
});
