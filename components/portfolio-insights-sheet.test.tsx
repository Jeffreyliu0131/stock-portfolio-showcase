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

import type { PortfolioInsights } from "../ui/portfolio-insights.ts";
import { PortfolioInsightsSheet } from "./portfolio-insights-sheet.tsx";

function completeInsights(): PortfolioInsights {
  return {
    currency: "USD",
    structure: {
      pricingComplete: true,
      pricedPositionCount: 3,
      unpricedPositionCount: 0,
      totalPricedAssetsUsd: "200",
      weightBasis: "TOTAL_ASSETS",
      positions: [
        {
          instrumentKey: "NASDAQ:AAPL:USD",
          symbol: "AAPL",
          name: "Apple Inc.",
          marketRank: 1,
          marketValueUsd: "100",
          assetWeight: "0.5",
        },
        {
          instrumentKey: "NASDAQ:MSFT:USD",
          symbol: "MSFT",
          name: "Microsoft Corp.",
          marketRank: 2,
          marketValueUsd: "50",
          assetWeight: "0.25",
        },
        {
          instrumentKey: "NASDAQ:NVDA:USD",
          symbol: "NVDA",
          name: "NVIDIA Corp.",
          marketRank: 3,
          marketValueUsd: "20",
          assetWeight: "0.1",
        },
      ],
      cash: {
        balanceUsd: "30",
        assetWeight: "0.15",
      },
      concentration: {
        status: "COMPLETE",
        top1: {
          includedPositionCount: 1,
          marketValueUsd: "100",
          assetWeight: "0.5",
        },
        top3: {
          includedPositionCount: 3,
          marketValueUsd: "170",
          assetWeight: "0.85",
        },
        top5: {
          includedPositionCount: 3,
          marketValueUsd: "170",
          assetWeight: "0.85",
        },
      },
    },
    daily: {
      status: "COMPLETE",
      totalPositionCount: 3,
      calculablePositionCount: 3,
      netEffectUsd: "6",
      calculableAbsoluteEffectUsd: "12",
      shareBasis: "COMPLETE_PORTFOLIO",
      contributions: [
        {
          instrumentKey: "NASDAQ:AAPL:USD",
          symbol: "AAPL",
          name: "Apple Inc.",
          status: "AVAILABLE",
          amountUsd: "9",
          direction: "POSITIVE",
          absoluteContributionShare: "0.75",
        },
        {
          instrumentKey: "NASDAQ:MSFT:USD",
          symbol: "MSFT",
          name: "Microsoft Corp.",
          status: "AVAILABLE",
          amountUsd: "-3",
          direction: "NEGATIVE",
          absoluteContributionShare: "0.25",
        },
        {
          instrumentKey: "NASDAQ:NVDA:USD",
          symbol: "NVDA",
          name: "NVIDIA Corp.",
          status: "AVAILABLE",
          amountUsd: "0",
          direction: "NEUTRAL",
          absoluteContributionShare: "0",
        },
      ],
      largestPositiveContributor: {
        instrumentKey: "NASDAQ:AAPL:USD",
        symbol: "AAPL",
        name: "Apple Inc.",
        amountUsd: "9",
        absoluteContributionShare: "0.75",
      },
      largestNegativeContributor: {
        instrumentKey: "NASDAQ:MSFT:USD",
        symbol: "MSFT",
        name: "Microsoft Corp.",
        amountUsd: "-3",
        absoluteContributionShare: "0.25",
      },
    },
  };
}

function partialInsights(): PortfolioInsights {
  return {
    currency: "USD",
    structure: {
      pricingComplete: false,
      pricedPositionCount: 2,
      unpricedPositionCount: 1,
      totalPricedAssetsUsd: "150",
      weightBasis: "PRICED_ASSETS",
      positions: [
        {
          instrumentKey: "NASDAQ:KNOWN:USD",
          symbol: "KNOWN",
          name: "Known Corp.",
          marketRank: 1,
          marketValueUsd: "100",
          assetWeight: "0.66666666666666666667",
        },
        {
          instrumentKey: "NASDAQ:NO_CLOSE:USD",
          symbol: "NO_CLOSE",
          name: "No Close Corp.",
          marketRank: 2,
          marketValueUsd: "50",
          assetWeight: "0.33333333333333333333",
        },
        {
          instrumentKey: "NASDAQ:NO_PRICE:USD",
          symbol: "NO_PRICE",
          name: "No Price Corp.",
          marketRank: null,
          marketValueUsd: null,
          assetWeight: null,
        },
      ],
      cash: null,
      concentration: {
        status: "PARTIAL",
        top1: {
          includedPositionCount: 1,
          marketValueUsd: "100",
          assetWeight: "0.66666666666666666667",
        },
        top3: {
          includedPositionCount: 2,
          marketValueUsd: "150",
          assetWeight: "1",
        },
        top5: {
          includedPositionCount: 2,
          marketValueUsd: "150",
          assetWeight: "1",
        },
      },
    },
    daily: {
      status: "PARTIAL",
      totalPositionCount: 3,
      calculablePositionCount: 1,
      netEffectUsd: null,
      calculableAbsoluteEffectUsd: "5",
      shareBasis: "CALCULABLE_POSITIONS",
      contributions: [
        {
          instrumentKey: "NASDAQ:KNOWN:USD",
          symbol: "KNOWN",
          name: "Known Corp.",
          status: "AVAILABLE",
          amountUsd: "5",
          direction: "POSITIVE",
          absoluteContributionShare: "1",
        },
        {
          instrumentKey: "NASDAQ:NO_CLOSE:USD",
          symbol: "NO_CLOSE",
          name: "No Close Corp.",
          status: "MISSING_PREVIOUS_CLOSE",
          amountUsd: null,
          direction: "UNAVAILABLE",
          absoluteContributionShare: null,
        },
        {
          instrumentKey: "NASDAQ:NO_PRICE:USD",
          symbol: "NO_PRICE",
          name: "No Price Corp.",
          status: "MISSING_PRICE",
          amountUsd: null,
          direction: "UNAVAILABLE",
          absoluteContributionShare: null,
        },
      ],
      largestPositiveContributor: {
        instrumentKey: "NASDAQ:KNOWN:USD",
        symbol: "KNOWN",
        name: "Known Corp.",
        amountUsd: "5",
        absoluteContributionShare: "1",
      },
      largestNegativeContributor: null,
    },
  };
}

function contributionRow(symbol: string): HTMLElement {
  const list = screen.getByRole("list", {
    name: "逐股今日盈亏贡献",
  });
  const symbolNode = within(list).getByText(symbol);
  const row = symbolNode.closest<HTMLElement>("[role='listitem']");
  if (row === null) {
    throw new Error(`contribution row not found: ${symbol}`);
  }
  return row;
}

function allocationRow(symbol: string): HTMLElement {
  const list = screen.getByRole("list", {
    name: "资产仓位结构",
  });
  const symbolNode = within(list).getByText(symbol);
  const row = symbolNode.closest<HTMLElement>("[role='listitem']");
  if (row === null) {
    throw new Error(`allocation row not found: ${symbol}`);
  }
  return row;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortfolioInsightsSheet", () => {
  it("renders a complete allocation donut, concentration summary, and zero-axis contribution analysis in USD", async () => {
    const onClose = vi.fn();
    render(
      <PortfolioInsightsSheet
        insights={completeInsights()}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={onClose}
      />,
    );

    expect(screen.getByLabelText("今日变化摘要")).toHaveTextContent("AAPL +$9.00");
    expect(screen.getByLabelText("今日变化摘要")).toHaveTextContent("MSFT −$3.00");
    expect(document.getElementById("daily-contribution-title")!.compareDocumentPosition(document.getElementById("structure-title")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const dialog = screen.getByRole("dialog", {
      name: "组合分析",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("估值货币 · USD")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", { name: /组合仓位环图/ }),
    ).toHaveAccessibleName(/AAPL 50\.00%/);
    expect(within(dialog).getByText("最大单股").parentElement).toHaveTextContent(
      "50.0%",
    );
    expect(
      within(dialog).getByText("Top 1（最大单股）").parentElement,
    ).toHaveTextContent("50.00%");
    expect(within(dialog).getByText("Top 3").parentElement).toHaveTextContent(
      "85.00%",
    );
    expect(
      within(dialog).getByText("Top 5（实际 3 只）").parentElement,
    ).toHaveTextContent("85.00%");
    expect(
      within(dialog).getByText("股票合计（不含现金）").parentElement,
    ).toHaveTextContent("85.00%");
    expect(allocationRow("USD 现金")).toHaveTextContent(
      "15.00%$30.00",
    );
    expect(
      within(dialog).getAllByText("覆盖 3/3 只 · 完整"),
    ).toHaveLength(2);
    expect(
      within(dialog).getByText("组合净贡献").parentElement,
    ).toHaveTextContent("+$6.00");
    expect(
      within(dialog).getByText("涨跌贡献比例").parentElement,
    ).toHaveTextContent("75.0%/25.0%");
    expect(
      within(dialog).getByRole("img", { name: /今日贡献零轴图/ }),
    ).toHaveAccessibleName(/MSFT −\$3\.00，绝对贡献 25\.00%/);
    expect(contributionRow("AAPL")).toHaveTextContent("绝对贡献 75.00%");
    expect(contributionRow("AAPL")).toHaveTextContent("+$9.00");
    expect(contributionRow("MSFT")).toHaveTextContent("绝对贡献 25.00%");
    expect(contributionRow("MSFT")).toHaveTextContent("−$3.00");
    expect(
      contributionRow("AAPL").querySelector("strong.numeric"),
    ).toHaveClass("insight-tone--positive");
    expect(
      contributionRow("MSFT").querySelector("strong.numeric"),
    ).toHaveClass("insight-tone--negative");
    expect(
      contributionRow("NVDA").querySelector("strong.numeric"),
    ).toHaveClass("insight-tone--neutral");

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "关闭组合分析" }),
      ).toHaveFocus();
    });
  });

  it("derives every displayed amount from USD truth in CNY mode", () => {
    render(
      <PortfolioInsightsSheet
        insights={completeInsights()}
        displayCurrency="CNY"
        usdCnyRate="7.2"
        cnySourceDisclosure="人民币金额按 1 USD ≈ ¥7.2 折算 · Alpaca 中间价 · 汇率时间 8月9日 22:00。占比和排序保持 USD 真值口径。"
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("估值货币 · CNY 估算")).toBeInTheDocument();
    expect(
      screen.getByText(/1 USD ≈ ¥7\.2 折算 · Alpaca 中间价/),
    ).toHaveTextContent("占比和排序保持 USD 真值口径");
    expect(allocationRow("AAPL")).toHaveTextContent("¥720.00");
    expect(allocationRow("USD 现金")).toHaveTextContent("¥216.00");
    expect(screen.getByText("组合净贡献").parentElement).toHaveTextContent(
      "+¥43.20",
    );
    expect(contributionRow("AAPL")).toHaveTextContent("+¥64.80");
    expect(contributionRow("MSFT")).toHaveTextContent("−¥21.60");
    expect(screen.queryByText("$100.00")).not.toBeInTheDocument();
    expect(allocationRow("AAPL")).toHaveTextContent("50.00%");
  });

  it("keeps the unrounded USD cents when deriving a high-significance CNY amount", () => {
    const base = completeInsights();
    const highSignificance: PortfolioInsights = {
      ...base,
      structure: {
        ...base.structure,
        positions: [
          {
            ...base.structure.positions[0]!,
            marketValueUsd: "1000000000000000000.0049",
          },
          ...base.structure.positions.slice(1),
        ],
      },
    };
    render(
      <PortfolioInsightsSheet
        insights={highSignificance}
        displayCurrency="CNY"
        usdCnyRate="7.2"
        onClose={() => undefined}
      />,
    );

    expect(allocationRow("AAPL")).toHaveTextContent(
      "¥7,200,000,000,000,000,000.04",
    );
  });

  it("shows partial price coverage and distinguishes missing price from missing previous close", () => {
    render(
      <PortfolioInsightsSheet
        insights={partialInsights()}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("覆盖 2/3 只 · 部分口径")).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 只股票缺价，未进入分母；其成本没有被当成市值。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("覆盖 1/3 只 · 部分口径")).toBeInTheDocument();
    expect(screen.getByLabelText("今日变化摘要")).toHaveTextContent("不能据此判断完整组合净变化");
    expect(
      screen.getByText("组合净贡献").parentElement,
    ).toHaveTextContent("—需全部股票可计算");
    expect(screen.getByText("子集涨跌贡献").parentElement).toHaveTextContent(
      "100.0%/0.0%",
    );

    const missingPrice = contributionRow("NO_PRICE");
    expect(missingPrice).toHaveTextContent("缺少有效估值价");
    expect(missingPrice).toHaveTextContent("—");
    expect(missingPrice).not.toHaveTextContent("$0.00");

    const missingClose = contributionRow("NO_CLOSE");
    expect(missingClose).toHaveTextContent("缺少前一常规收盘价");
    expect(missingClose).toHaveTextContent("—");
    expect(missingClose).not.toHaveTextContent("$0.00");

    const known = contributionRow("KNOWN");
    expect(known).toHaveTextContent("+$5.00");
    expect(known).toHaveTextContent("绝对贡献 100.00%");
    expect(
      screen.getByRole("img", { name: /今日贡献零轴图/ }),
    ).toBeInTheDocument();

    expect(allocationRow("NO_PRICE")).toHaveTextContent("—未计价");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Top 3（实际 2 只）")).toBeInTheDocument();
    expect(screen.getByText("Top 5（实际 2 只）")).toBeInTheDocument();
  });

  it("does not manufacture a cash percentage when the whole structure is unavailable", () => {
    const base = partialInsights();
    const unavailable: PortfolioInsights = {
      ...base,
      structure: {
        ...base.structure,
        pricingComplete: false,
        pricedPositionCount: 0,
        unpricedPositionCount: 1,
        totalPricedAssetsUsd: null,
        weightBasis: "UNAVAILABLE",
        positions: [
          {
            instrumentKey: "NASDAQ:NO_PRICE:USD",
            symbol: "NO_PRICE",
            name: "No Price Corp.",
            marketRank: null,
            marketValueUsd: null,
            assetWeight: null,
          },
        ],
        cash: null,
        concentration: {
          status: "UNAVAILABLE",
          top1: null,
          top3: null,
          top5: null,
        },
      },
    };

    render(
      <PortfolioInsightsSheet
        insights={unavailable}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("覆盖 0/1 只 · 暂不可用")).toBeInTheDocument();
    expect(screen.getByText("结构暂不可用")).toBeInTheDocument();
    expect(
      screen.getByText("股票合计（不含现金）").parentElement,
    ).toHaveTextContent("—");
    expect(
      screen.getByText("股票合计（不含现金）").parentElement,
    ).not.toHaveTextContent("0.00%");
  });

  it("shows a true zero net change while retaining offsetting absolute contributions", () => {
    const base = completeInsights();
    const zeroNet: PortfolioInsights = {
      ...base,
      daily: {
        ...base.daily,
        totalPositionCount: 2,
        calculablePositionCount: 2,
        netEffectUsd: "0",
        calculableAbsoluteEffectUsd: "20",
        contributions: [
          {
            ...base.daily.contributions[0]!,
            amountUsd: "10",
            absoluteContributionShare: "0.5",
          },
          {
            ...base.daily.contributions[1]!,
            amountUsd: "-10",
            absoluteContributionShare: "0.5",
          },
        ],
        largestPositiveContributor: {
          ...base.daily.largestPositiveContributor!,
          amountUsd: "10",
          absoluteContributionShare: "0.5",
        },
        largestNegativeContributor: {
          ...base.daily.largestNegativeContributor!,
          amountUsd: "-10",
          absoluteContributionShare: "0.5",
        },
      },
    };
    render(
      <PortfolioInsightsSheet
        insights={zeroNet}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    const netChange = screen.getByText("组合净贡献").parentElement;
    expect(netChange).toHaveTextContent("$0.00");
    expect(netChange?.querySelector("dd.numeric")).toHaveClass(
      "insight-tone--neutral",
    );
    expect(contributionRow("AAPL")).toHaveTextContent("+$10.00");
    expect(contributionRow("AAPL")).toHaveTextContent("绝对贡献 50.00%");
    expect(contributionRow("MSFT")).toHaveTextContent("−$10.00");
    expect(contributionRow("MSFT")).toHaveTextContent("绝对贡献 50.00%");
  });

  it("shows a zero-absolute-effect state without manufacturing contribution percentages", () => {
    const base = completeInsights();
    const zeroAbsolute: PortfolioInsights = {
      ...base,
      daily: {
        ...base.daily,
        totalPositionCount: 2,
        calculablePositionCount: 2,
        netEffectUsd: "0",
        calculableAbsoluteEffectUsd: "0",
        shareBasis: "ZERO_ABSOLUTE_EFFECT",
        contributions: base.daily.contributions.slice(0, 2).map((row) => ({
          ...row,
          amountUsd: "0",
          direction: "NEUTRAL" as const,
          absoluteContributionShare: null,
        })),
        largestPositiveContributor: null,
        largestNegativeContributor: null,
      },
    };

    render(
      <PortfolioInsightsSheet
        insights={zeroAbsolute}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("今日绝对变化为 0")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /今日贡献零轴图/ })).not.toBeInTheDocument();
    expect(contributionRow("AAPL")).toHaveTextContent("占比不适用");
    expect(contributionRow("MSFT")).toHaveTextContent("占比不适用");
  });

  it("keeps the deterministic sheet clean when AI portfolio context is unavailable", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PortfolioInsightsSheet
        insights={completeInsights()}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("会发送给 DeepSeek")).not.toBeInTheDocument();
    expect(screen.queryByText("不会发送")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("组合结构")).toBeInTheDocument();
    expect(screen.getByText("今日贡献")).toBeInTheDocument();
  });

  it("keeps deterministic analysis available when full AI context is unavailable", () => {
    render(
      <PortfolioInsightsSheet
        insights={completeInsights()}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("组合结构")).toBeInTheDocument();
    expect(screen.getByText("今日贡献")).toBeInTheDocument();
    expect(screen.queryByText("AI 组合咨询")).not.toBeInTheDocument();
  });

  it("aggregates holdings after the top five in the donut while retaining every detail row", () => {
    const base = completeInsights();
    const expanded: PortfolioInsights = {
      ...base,
      structure: {
        ...base.structure,
        pricedPositionCount: 6,
        positions: [
          ...base.structure.positions,
          {
            instrumentKey: "NYSE:BRK.B:USD",
            symbol: "BRK.B",
            name: "Berkshire Hathaway Inc.",
            marketRank: 4,
            marketValueUsd: "10",
            assetWeight: "0.05",
          },
          {
            instrumentKey: "NYSE:V:USD",
            symbol: "V",
            name: "Visa Inc.",
            marketRank: 5,
            marketValueUsd: "6",
            assetWeight: "0.03",
          },
          {
            instrumentKey: "NYSE:KO:USD",
            symbol: "KO",
            name: "Coca-Cola Co.",
            marketRank: 6,
            marketValueUsd: "4",
            assetWeight: "0.02",
          },
        ],
      },
    };

    render(
      <PortfolioInsightsSheet
        insights={expanded}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={() => undefined}
      />,
    );

    expect(
      screen.getByText("环图将第 6 名起的 1 只股票合并为“其他股票”，明细仍逐只列出。"),
    ).toBeInTheDocument();
    expect(allocationRow("KO")).toHaveTextContent("2.00%$4.00");
  });

  it("isolates the background, traps Tab in the dialog, and restores isolation on unmount", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <>
        <button type="button">背景操作</button>
        <PortfolioInsightsSheet
          insights={completeInsights()}
          displayCurrency="USD"
          usdCnyRate={null}
          onClose={onClose}
        />
      </>,
    );

    const background = screen.getByText("背景操作");
    const close = screen.getByRole("button", { name: "关闭组合分析" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");

    background.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    background.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();

    unmount();
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
  });

  it("closes from the explicit button and Escape key", () => {
    const onClose = vi.fn();
    render(
      <PortfolioInsightsSheet
        insights={completeInsights()}
        displayCurrency="USD"
        usdCnyRate={null}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭组合分析" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
