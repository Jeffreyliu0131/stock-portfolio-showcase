// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CashSnapshot } from "../application/cash/types.ts";
import type { PositionSnapshot } from "../application/positions/types.ts";
import {
  resolveQuote,
  type InstrumentKey,
  type ResolvedQuote,
  type ValidMarketQuote,
} from "../domain/index.ts";
import { chatPortfolioConsultationOutput } from "../tests/portfolio-consultation-fixtures.ts";
import { createPortfolioCopySource } from "../ui/portfolio-copy-text.ts";
import { createPortfolioInsights } from "../ui/portfolio-insights.ts";
import { PortfolioAiChatDialog } from "./portfolio-ai-chat-dialog.tsx";

const NOW = "2026-08-15T07:00:00.000Z";

function instrument(symbol: string): InstrumentKey {
  return { listingMarket: "NASDAQ", symbol, currency: "USD" };
}

function snapshot(
  symbol: string,
  name: string,
  quantity: string,
  openCost: string,
): PositionSnapshot {
  const key = instrument(symbol);
  return {
    revision: 1,
    savedAt: "2026-08-15T06:00:00.000Z",
    batch: {
      instrument: key,
      displayName: name,
      inputs: [
        {
          id: `${symbol}-input`,
          instrument: key,
          quantity,
          costInput: { mode: "TOTAL_OPEN_COST", value: openCost },
        },
      ],
    },
  };
}

function quote(
  symbol: string,
  price: string,
  previousRegularClose: string,
): ResolvedQuote {
  const key = instrument(symbol);
  const candidate: ValidMarketQuote = {
    instrument: key,
    provider: "Alpaca",
    feed: "delayed_sip",
    price,
    priceType: "LATEST_TRADE",
    sourceEventAt: "2026-08-15T06:45:00.000Z",
    fetchedAt: NOW,
    marketSession: "REGULAR",
    previousRegularClose,
  };
  return resolveQuote({
    requestedInstrument: key,
    now: NOW,
    fetchStatus: "FETCH_OK",
    marketSession: "REGULAR",
    candidate,
  });
}

function source(applePrice = "200") {
  const cash: CashSnapshot = {
    revision: 1,
    savedAt: "2026-08-15T06:00:00.000Z",
    account: {
      provider: "IBKR",
      currency: "USD",
      balance: "1000",
      netAssetValue: "50000",
      navSource: "USER_ENTERED",
      pricingPlan: "IBKR_PRO",
    },
  };
  return createPortfolioCopySource(
    [
      snapshot("AAPL", "Apple Inc.", "10", "1000"),
      snapshot("MSFT", "Microsoft Corporation", "5", "1000"),
    ],
    [quote("AAPL", applePrice, "190"), quote("MSFT", "200", "205")],
    cash,
  );
}

function successResponse() {
  return {
    kind: "PORTFOLIO_CONSULTATION_RESULT",
    schemaVersion: 4,
    generatedAt: "2026-08-15T07:00:05.000Z",
    model: "deepseek-v4-flash",
    promptVersion: "portfolio-value-advisor-v4",
    mode: "CHAT",
    ...chatPortfolioConsultationOutput(),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PortfolioAiChatDialog", () => {
  it("opens as a clean standalone dialog and sends nothing before Send", async () => {
    const currentSource = source();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PortfolioAiChatDialog
        insights={createPortfolioInsights(currentSource)}
        portfolioSource={currentSource}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    const input = screen.getByPlaceholderText("直接问：这个判断的证据够吗？");
    await waitFor(() => expect(input).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "巴菲特框架顾问" }),
    ).toBeInTheDocument();
    expect(screen.getByText("直接问一个投资问题")).toBeInTheDocument();
    expect(screen.getByText(/不代表巴菲特本人/)).toBeInTheDocument();
    expect(screen.getByText(/不发送姓名、邮箱、券商账号/)).toBeInTheDocument();
    expect(screen.queryByText("会发送给 DeepSeek")).not.toBeInTheDocument();
    expect(screen.queryByText("不会发送")).not.toBeInTheDocument();
    expect(screen.queryByText(/例如/)).not.toBeInTheDocument();
    expect(screen.queryByText(/重新开始|重新体检/)).not.toBeInTheDocument();
  });

  it("sends the full current portfolio only after Send and renders the answer", async () => {
    const currentSource = source();
    let requestBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(successResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PortfolioAiChatDialog
        insights={createPortfolioInsights(currentSource)}
        portfolioSource={currentSource}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("直接问：这个判断的证据够吗？"), {
      target: { value: "现金在这个组合里起到什么作用？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText(chatPortfolioConsultationOutput().answer!.text);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      mode: "CHAT",
      priorClassifications: null,
      history: [],
      question: "现金在这个组合里起到什么作用？",
      portfolio: {
        positions: [
          expect.objectContaining({
            symbol: "AAPL",
            quantity: "10",
            averageCostUsd: "100",
            marketValueUsd: "2000",
          }),
          expect.objectContaining({ symbol: "MSFT" }),
        ],
        cash: expect.objectContaining({
          balanceUsd: "1000",
          ibkrInterest: expect.objectContaining({
            netAssetValueUsd: "50000",
          }),
        }),
      },
    });
    expect(screen.getByText(/USD 现金 \$1,000\.00 · 25\.00%/)).toBeInTheDocument();
    expect(screen.getByText("机会成本")).toBeInTheDocument();
    expect(screen.getByText("投资气质")).toBeInTheDocument();
  });

  it("keeps one snapshot and carries successful history across later turns", async () => {
    const openingSource = source();
    const refreshedSource = source("250");
    const requests: Array<{
      readonly portfolio: { readonly positions: readonly { readonly marketValueUsd: string }[] };
      readonly history: readonly unknown[];
      readonly question: string;
    }> = [];
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(successResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onClose = vi.fn();
    const { rerender } = render(
      <PortfolioAiChatDialog
        insights={createPortfolioInsights(openingSource)}
        portfolioSource={openingSource}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={onClose}
      />,
    );

    const input = screen.getByPlaceholderText("直接问：这个判断的证据够吗？");
    fireEvent.change(input, { target: { value: "当前组合最需要关注什么？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText(chatPortfolioConsultationOutput().answer!.text);

    rerender(
      <PortfolioAiChatDialog
        insights={createPortfolioInsights(refreshedSource)}
        portfolioSource={refreshedSource}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("当前数据已变化");
    fireEvent.change(screen.getByPlaceholderText("直接问：这个判断的证据够吗？"), {
      target: { value: "再说说现金的作用。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(requests[0]?.portfolio.positions[0]?.marketValueUsd).toBe("2000");
    expect(requests[1]?.portfolio.positions[0]?.marketValueUsd).toBe("2000");
    expect(requests[1]).toMatchObject({
      history: [
        { role: "user", content: "当前组合最需要关注什么？" },
        {
          role: "assistant",
          content: chatPortfolioConsultationOutput().answer!.text,
        },
      ],
      question: "再说说现金的作用。",
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft available when a request fails", async () => {
    const currentSource = source();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));

    render(
      <PortfolioAiChatDialog
        insights={createPortfolioInsights(currentSource)}
        portfolioSource={currentSource}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );
    const input = screen.getByPlaceholderText("直接问：这个判断的证据够吗？");
    fireEvent.change(input, { target: { value: "帮我看一下当前结构。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法回答，请重试");
    expect(input).toHaveValue("帮我看一下当前结构。");
  });

  it("can close immediately while an answer is still pending", async () => {
    const currentSource = source();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const onClose = vi.fn();

    render(
      <PortfolioAiChatDialog
        insights={createPortfolioInsights(currentSource)}
        portfolioSource={currentSource}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("直接问：这个判断的证据够吗？"), {
      target: { value: "帮我看一下当前结构。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("正在回答");

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});


describe("production chat entry", () => {
  it("keeps the existing chat label, empty state and zero request on open", () => {
    vi.stubEnv("NEXT_PUBLIC_PORTFOLIO_EXPERIENCE", "production");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const portfolioSource = source();
    render(<PortfolioAiChatDialog portfolioSource={portfolioSource} insights={createPortfolioInsights(portfolioSource)} displayCurrency="USD" usdCnyRate={null} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "AI 对话" })).toBeInTheDocument();
    expect(screen.queryByText("直接问一个投资问题")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
