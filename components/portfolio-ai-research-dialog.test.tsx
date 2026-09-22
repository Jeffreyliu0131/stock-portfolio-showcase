// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aaplResearchSuccess } from "../tests/buffett-research-fixtures.ts";
import { PortfolioAiResearchDialog } from "./portfolio-ai-research-dialog.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortfolioAiResearchDialog", () => {
  it("opens with zero requests and discloses the privacy boundary", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PortfolioAiResearchDialog onClose={() => undefined} />);
    const input = screen.getByPlaceholderText(/这家公司的现金创造/);
    await waitFor(() => expect(input).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "巴菲特研究系统" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/不发送持仓数量、成本、现金/)).toBeInTheDocument();
  });

  it("submits one issuer question and renders metrics, sources, unknowns, and trace", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify(aaplResearchSuccess()), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PortfolioAiResearchDialog onClose={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText(/这家公司的现金创造/), {
      target: { value: "现金创造与资本配置有哪些证据与反证？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    await screen.findByText(aaplResearchSuccess().headline);
    expect(body).toMatchObject({
      kind: "BUFFETT_RESEARCH_REQUEST",
      symbol: "AAPL",
      question: "现金创造与资本配置有哪些证据与反证？",
    });
    expect(screen.getByText("$133.5B")).toBeInTheDocument();
    expect(screen.getByText("所有者收益：需要假设")).toBeInTheDocument();
    expect(screen.getByText("证据缺口")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Apple Inc. 10-K" }),
    ).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByText("Research Trace"));
    const trace = screen.getByText("Research Trace").closest("details")!;
    expect(within(trace).getByText("EVIDENCE_GATE")).toBeInTheDocument();
  });

  it("can select MSFT and closes with Escape", async () => {
    const onClose = vi.fn();
    render(<PortfolioAiResearchDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "MSFT" }));
    expect(screen.getByRole("button", { name: "MSFT" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
