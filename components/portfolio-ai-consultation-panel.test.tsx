// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CashSnapshot } from "../application/cash/types.ts";
import type { PositionSnapshot } from "../application/positions/types.ts";
import {
  resolveQuote,
  type InstrumentKey,
  type ResolvedQuote,
  type ValidMarketQuote,
} from "../domain/index.ts";
import { initialPortfolioConsultationOutput } from "../tests/portfolio-consultation-fixtures.ts";
import { createPortfolioCopySource } from "../ui/portfolio-copy-text.ts";
import { createPortfolioInsights } from "../ui/portfolio-insights.ts";
import { PortfolioAiConsultationPanel } from "./portfolio-ai-consultation-panel.tsx";

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
    mode: "INITIAL_ANALYSIS",
    ...initialPortfolioConsultationOutput(),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PortfolioAiConsultationPanel", () => {
  it("waits for an explicit start, sends full context, and renders local exposure totals", async () => {
    const currentSource = source();
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as {
        readonly mode: string;
        readonly portfolio: {
          readonly positions: readonly Record<string, unknown>[];
          readonly cash: Record<string, unknown>;
        };
      };
      expect(request.mode).toBe("INITIAL_ANALYSIS");
      expect(request.portfolio.positions[0]).toMatchObject({
        symbol: "AAPL",
        name: "Apple Inc.",
        quantity: "10",
        averageCostUsd: "100",
        marketValueUsd: "2000",
        unrealizedPnlUsd: "1000",
      });
      expect(request.portfolio.cash).toMatchObject({
        balanceUsd: "1000",
        accounts: [
          expect.objectContaining({
            provider: "IBKR",
            settledBalanceUsd: "1000",
          }),
        ],
        ibkrInterest: expect.objectContaining({
          netAssetValueUsd: "50000",
        }),
      });
      return new Response(JSON.stringify(successResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PortfolioAiConsultationPanel
        insights={createPortfolioInsights(currentSource)}
        portfolioSource={currentSource}
        displayCurrency="USD"
        usdCnyRate={null}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/开始后，当前持仓/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始 AI 解读" }));
    await screen.findByText(initialPortfolioConsultationOutput().brief!.headline);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sectorSection = document.getElementById("ai-sector-title")?.closest("section");
    expect(sectorSection).not.toBeNull();
    expect(within(sectorSection!).getByText("信息技术").parentElement).toHaveTextContent(
      "AAPL · MSFT",
    );
    expect(within(sectorSection!).getByText("75.00%")).toBeInTheDocument();
    expect(screen.queryByText("会发送给 DeepSeek")).not.toBeInTheDocument();
    expect(screen.queryByText("不会发送")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("DeepSeek V4 Flash")).not.toBeInTheDocument();
  });

  it("renders monetary evidence from the fixed USD snapshot in CNY mode", async () => {
    const currentSource = source();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(successResponse()), { status: 200 }),
      ),
    );

    render(
      <PortfolioAiConsultationPanel
        insights={createPortfolioInsights(currentSource)}
        portfolioSource={currentSource}
        displayCurrency="CNY"
        usdCnyRate="7.2"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始 AI 解读" }));
    await screen.findByText(initialPortfolioConsultationOutput().brief!.headline);
    expect(screen.getAllByText(/总资产 ¥28,800\.00/)).not.toHaveLength(0);
    expect(screen.getAllByText(/USD 现金 ¥7,200\.00 · 25\.00%/)).not.toHaveLength(0);
  });

  it("rejects unsafe output and exposes only a compact retry", async () => {
    const currentSource = source();
    const unsafe = {
      ...successResponse(),
      brief: {
        ...initialPortfolioConsultationOutput().brief!,
        summary: "建议卖出最大持仓来降低风险。",
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(unsafe), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successResponse()), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PortfolioAiConsultationPanel
        insights={createPortfolioInsights(currentSource)}
        portfolioSource={currentSource}
        displayCurrency="USD"
        usdCnyRate={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始 AI 解读" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI 分析暂时不可用");
    expect(screen.queryByText("建议卖出最大持仓来降低风险。")).not.toBeInTheDocument();
    expect(screen.queryByText("持仓没有被修改")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText(initialPortfolioConsultationOutput().brief!.headline);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the opening snapshot when dashboard data refreshes in the background", async () => {
    const openingSource = source();
    const refreshedSource = source("250");
    let sentMarketValue: string | null = null;
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as {
        readonly portfolio: {
          readonly positions: readonly { readonly marketValueUsd: string }[];
        };
      };
      sentMarketValue = request.portfolio.positions[0]?.marketValueUsd ?? null;
      return new Response(JSON.stringify(successResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <PortfolioAiConsultationPanel
        insights={createPortfolioInsights(openingSource)}
        portfolioSource={openingSource}
        displayCurrency="USD"
        usdCnyRate={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始 AI 解读" }));
    await screen.findByText(initialPortfolioConsultationOutput().brief!.headline);

    rerender(
      <PortfolioAiConsultationPanel
        insights={createPortfolioInsights(refreshedSource)}
        portfolioSource={refreshedSource}
        displayCurrency="USD"
        usdCnyRate={null}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentMarketValue).toBe("2000");
    expect(screen.getByRole("status")).toHaveTextContent("当前数据已变化");
    fireEvent.click(screen.getByRole("button", { name: "用当前数据重新解读" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentMarketValue).toBe("2500");
  });
  it("uses data refreshed before the first explicit start without any earlier request", async () => {
    const initial = source();
    const latest = source("250");
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).portfolio.positions[0].marketValueUsd).toBe("2500");
      return new Response(JSON.stringify(successResponse()), {status: 200});
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<PortfolioAiConsultationPanel insights={createPortfolioInsights(initial)} portfolioSource={initial} displayCurrency="USD" usdCnyRate={null} />);
    rerender(<PortfolioAiConsultationPanel insights={createPortfolioInsights(latest)} portfolioSource={latest} displayCurrency="USD" usdCnyRate={null} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "开始 AI 解读"}));
    await screen.findByText(initialPortfolioConsultationOutput().brief!.headline);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});


describe("production experience compatibility", () => {
  it("starts once when opened, preserves the v3 wire, and does not restart on refresh", async () => {
    vi.stubEnv("NEXT_PUBLIC_PORTFOLIO_EXPERIENCE", "production");
    const fetchMock = vi.fn(async () => Response.json({ ...successResponse(), schemaVersion: 3, promptVersion: "portfolio-consultation-v3" }));
    vi.stubGlobal("fetch", fetchMock);
    const renderPanel = (price = "200") => {
      const portfolioSource = source(price);
      return <StrictMode><PortfolioAiConsultationPanel portfolioSource={portfolioSource} insights={createPortfolioInsights(portfolioSource)} displayCurrency="USD" usdCnyRate={null} /></StrictMode>;
    };
    const view = render(renderPanel());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText("AI 体检");
    expect(screen.queryByRole("button", { name: "开始 AI 解读" })).toBeNull();
    expect(screen.queryByRole("button", { name: "用当前数据重新解读" })).toBeNull();
    view.rerender(renderPanel("210"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
