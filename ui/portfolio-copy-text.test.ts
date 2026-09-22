import { describe, expect, it } from "vitest";

import type { CashSnapshot } from "../application/cash/types.ts";
import type { PositionSnapshot } from "../application/positions/types.ts";
import {
  resolveQuote,
  type InstrumentKey,
  type ResolvedQuote,
} from "../domain/index.ts";
import { validQuote } from "../tests/helpers.ts";
import {
  createPortfolioCopySource,
  createPortfolioCopyText,
} from "./portfolio-copy-text.ts";

const COPIED_AT = "2026-08-01T08:00:00Z";
const QUOTE_NOW = "2026-08-01T07:47:00Z";
const IBKR_CASH: CashSnapshot = {
  revision: 1,
  savedAt: "2026-08-02T01:00:00Z",
  account: {
    provider: "IBKR",
    currency: "USD",
    balance: "20000",
    netAssetValue: "80000",
    navSource: "USER_ENTERED",
    pricingPlan: "IBKR_PRO",
  },
};

function instrument(
  symbol: string,
  listingMarket = "NASDAQ",
): InstrumentKey {
  return { listingMarket, symbol, currency: "USD" };
}

function snapshot(
  symbol: string,
  options: {
    quantity?: string;
    openCost?: string;
    name?: string;
    listingMarket?: string;
  } = {},
): PositionSnapshot {
  const key = instrument(symbol, options.listingMarket);
  return {
    revision: 7,
    savedAt: "2026-08-01T06:00:00Z",
    batch: {
      instrument: key,
      displayName: options.name ?? `${symbol} Company`,
      inputs: [
        {
          id: `private-input-${symbol}`,
          instrument: key,
          quantity: options.quantity ?? "1",
          costInput: {
            mode: "TOTAL_OPEN_COST",
            value: options.openCost ?? "10",
          },
        },
      ],
    },
  };
}

function quote(
  symbol: string,
  price: string,
  options: {
    listingMarket?: string;
    lastValid?: boolean;
    marketSession?: ResolvedQuote["marketSession"];
    priceType?: "LATEST_TRADE" | "INDICATIVE_TRADE";
    sourceEventAt?: string;
  } = {},
): ResolvedQuote {
  const key = instrument(symbol, options.listingMarket);
  const marketSession = options.marketSession ?? "REGULAR";
  const marketQuote = validQuote({
    instrument: key,
    price,
    feed: options.priceType === "INDICATIVE_TRADE" ? "overnight" : "delayed_sip",
    priceType: options.priceType ?? "LATEST_TRADE",
    sourceEventAt: options.sourceEventAt ?? "2026-08-01T07:45:00Z",
    fetchedAt: "2026-08-01T07:46:00Z",
    marketSession,
  });
  return options.lastValid
    ? resolveQuote({
        requestedInstrument: key,
        now: QUOTE_NOW,
        fetchStatus: "FETCH_FAILED",
        marketSession: "CLOSED",
        lastValidQuote: marketQuote,
      })
    : resolveQuote({
        requestedInstrument: key,
        now: QUOTE_NOW,
        fetchStatus: "FETCH_OK",
        marketSession,
        candidate: marketQuote,
      });
}

describe("portfolio copy text", () => {
  it("creates a compact AI-ready portfolio document from raw values", () => {
    const source = createPortfolioCopySource(
      [
        snapshot("AAPL", {
          quantity: "120.5",
          openCost: "20653.7",
          name: "Apple Inc.",
        }),
      ],
      [quote("AAPL", "203.1", { lastValid: true })],
    );

    const text = createPortfolioCopyText(
      source,
      { kind: "all" },
      COPIED_AT,
    );

    expect(text).toBe(`持仓资料（USD）
范围：全部持仓（1 只）
资料生成：2026-08-01T08:00Z
行情：Alpaca 延迟约 15 分钟，非实时；价格时间 2026-08-01T07:45Z；休市或故障时可能使用最后有效价。

【组合】
估算总市值：$24,473.55
股票：1 只（已定价 1）；成本 $20,653.70；浮动盈亏 +$3,819.85

【持仓（按市值降序）】
| 排名 | 标的 | 数量（股） | 均价 | 现价 | 市值 | 盈亏 | 收益率 | 占总市值 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1/1 | AAPL · Apple Inc. | 120.5 | $171.40 | $203.10* | $24,473.55 | +$3,819.85 | +18.49% | 100.00% |
* 现价为上一有效价。
`);
    expect(text).not.toContain("定价覆盖");
    expect(text).not.toContain("行情来源");
    expect(text).not.toContain("市场时段");
    expect(text).not.toContain("行情获取时间");
    expect(text).not.toContain("请分析");
    expect(text).not.toContain("private-input-AAPL");
    expect(text).not.toContain("revision");
  });

  it("selects the top five by unrounded market value and reports coverage", () => {
    const values = ["100", "90", "80", "70", "60.004", "60.003"];
    const snapshots = values.map((_, index) =>
      snapshot(`S${index + 1}`, { openCost: "1" }),
    );
    const quotes = values.map((value, index) =>
      quote(`S${index + 1}`, value),
    );
    const source = createPortfolioCopySource(snapshots, quotes);

    const text = createPortfolioCopyText(
      source,
      { kind: "top", limit: 5 },
      COPIED_AT,
    );

    expect(text).toContain("范围：前 5 大持仓");
    expect(text).toContain(
      "本范围：5 只；市值 $400.00；占总市值 86.96%",
    );
    expect(text).toContain("S5 · S5 Company");
    expect(text).not.toContain("S6 · S6 Company");
  });

  it("compresses quote metadata into one time range and price exception markers", () => {
    const source = createPortfolioCopySource(
      [snapshot("AAPL"), snapshot("MSFT")],
      [
        quote("AAPL", "20", { sourceEventAt: "2026-08-01T07:44:10Z" }),
        quote("MSFT", "30", {
          marketSession: "OVERNIGHT",
          priceType: "INDICATIVE_TRADE",
          sourceEventAt: "2026-08-01T07:45:50Z",
        }),
      ],
    );

    const text = createPortfolioCopyText(source, { kind: "all" }, COPIED_AT);

    expect(text).toContain(
      "价格时间 2026-08-01T07:44Z–2026-08-01T07:45Z",
    );
    expect(text).toContain("$30.00†");
    expect(text).toContain("† 现价为隔夜指示价。");
    expect(text).not.toContain("overnight");
    expect(text).not.toContain("行情事件时间");
  });

  it("selects exactly the top ten from an eleven-position portfolio", () => {
    const snapshots = Array.from({ length: 11 }, (_, index) =>
      snapshot(`S${index + 1}`, { openCost: "1" }),
    );
    const quotes = Array.from({ length: 11 }, (_, index) =>
      quote(`S${index + 1}`, String(index + 1)),
    );
    const source = createPortfolioCopySource(snapshots, quotes);

    const text = createPortfolioCopyText(
      source,
      { kind: "top", limit: 10 },
      COPIED_AT,
    );

    expect(text).toContain("范围：前 10 大持仓");
    expect(text).toContain("S11 · S11 Company");
    expect(text).not.toContain("S1 · S1 Company");
  });

  it("copies one position with portfolio summary, weight, and rank only", () => {
    const source = createPortfolioCopySource(
      [
        snapshot("AAPL", { openCost: "40", name: "Apple Inc." }),
        snapshot("MSFT", { openCost: "20", name: "Microsoft Corp." }),
      ],
      [quote("AAPL", "75"), quote("MSFT", "25")],
    );

    const text = createPortfolioCopyText(
      source,
      {
        kind: "single",
        instrumentKey: source.positions[0]?.instrumentKey ?? "",
      },
      COPIED_AT,
    );

    expect(text).toContain("范围：单只持仓：AAPL");
    expect(text).toContain("股票：2 只（已定价 2）");
    expect(text).toContain(
      "| 1/2 | AAPL · Apple Inc. | 1 | $40.00 | $75.00 | $75.00 | +$35.00 | +87.50% | 75.00% |",
    );
    expect(text).not.toContain("MSFT · Microsoft Corp.");
  });

  it("includes IBKR cash and its interest assumptions in total-asset copy", () => {
    const source = createPortfolioCopySource(
      [snapshot("AAPL", { openCost: "10", name: "Apple Inc." })],
      [quote("AAPL", "100")],
      IBKR_CASH,
    );

    const text = createPortfolioCopyText(
      source,
      { kind: "all" },
      COPIED_AT,
    );

    expect(text).toContain("范围：全部资产（1 只股票 + IBKR 现金）");
    expect(text).toContain("估算总资产：$20,100.00");
    expect(text).toContain(
      "股票：1 只（已定价 1）；市值 $100.00；成本 $10.00；浮动盈亏 +$90.00",
    );
    expect(text).toContain("现金：IBKR USD $20,000.00（占总资产 99.50%）");
    expect(text).toContain("【IBKR 现金】");
    expect(text).toContain(
      "方案 / NAV：IBKR Pro；$80,000.00（用户填写）",
    );
    expect(text).toContain(
      "利息口径：计息余额 $10,000.00；档位年利率 3.13% → NAV 调整后 2.50%；整笔现金年化 1.25%",
    );
    expect(text).toContain(
      "利息估算：年 +$250.40；月均 +$20.87；首 $10,000.00 不计息；利率 2026-08-02 核验且可变",
    );
    expect(text).toContain(
      "| 1/1 | AAPL · Apple Inc. | 1 | $10.00 | $100.00 | $100.00 | +$90.00 | +900.00% | 0.50% |",
    );
  });

  it("creates a complete total-asset copy when cash is the only asset", () => {
    const source = createPortfolioCopySource([], [], IBKR_CASH);

    const text = createPortfolioCopyText(
      source,
      { kind: "all" },
      COPIED_AT,
    );

    expect(text).toContain("范围：全部资产（0 只股票 + IBKR 现金）");
    expect(text).toContain("估算总资产：$20,000.00");
    expect(text).toContain("现金：IBKR USD $20,000.00（占总资产 100.00%）");
    expect(text).toContain("【IBKR 现金】");
    expect(text).toContain("暂无股票持仓。");
    expect(text).not.toContain("行情：");
  });

  it("keeps unpriced positions explicit and places them after priced ties", () => {
    const source = createPortfolioCopySource(
      [
        snapshot("ZZZ", { quantity: "0.12345678", openCost: "100" }),
        snapshot("BBB", { openCost: "100" }),
        snapshot("AAA", {
          openCost: "100",
          listingMarket: "NYSE",
        }),
      ],
      [
        quote("BBB", "150"),
        quote("AAA", "150", { listingMarket: "NYSE" }),
      ],
    );
    const text = createPortfolioCopyText(
      source,
      { kind: "all" },
      COPIED_AT,
    );

    expect(text.indexOf("AAA · AAA Company")).toBeLessThan(
      text.indexOf("BBB · BBB Company"),
    );
    expect(text.indexOf("BBB · BBB Company")).toBeLessThan(
      text.indexOf("ZZZ · ZZZ Company"),
    );
    expect(text).toContain(
      "| 无法计算 | ZZZ · ZZZ Company | 0.12345678 | $810.00 | 暂无有效价格 | 无法计算 | 无法计算 | 无法计算 | 无法计算 |",
    );
    expect(text).toContain(
      "未定价：1 只；成本 $100.00（未计入资产与盈亏）",
    );
  });

  it("does not manufacture zero prices when the entire portfolio is unpriced", () => {
    const source = createPortfolioCopySource(
      [snapshot("AAPL", { openCost: "999999999999.99" })],
      [],
    );
    const text = createPortfolioCopyText(
      source,
      { kind: "all" },
      COPIED_AT,
    );

    expect(text).toContain("已定价市值：暂无有效价格");
    expect(text).toContain("股票：1 只（已定价 0）");
    expect(text).toContain(
      "未定价：1 只；成本 $999,999,999,999.99（未计入资产与盈亏）",
    );
    expect(text).toContain("暂无有效价格 | 无法计算");
    expect(text).not.toContain("$0.00");
  });
});
