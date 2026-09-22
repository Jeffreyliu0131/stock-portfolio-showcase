import { describe, expect, it } from "vitest";

import {
  projectBrokerPortfolioCash,
  projectBrokerPortfolioSnapshots,
} from "../application/brokerage/index.ts";
import {
  aggregatePositionInputs,
  reconcileBrokerPortfolio,
} from "../domain/index.ts";
import { AAPL } from "../tests/helpers.ts";
import { createPortfolioConsultationRequest } from "./portfolio-consultation-context.ts";
import { createPortfolioCopySource } from "./portfolio-copy-text.ts";
import { createPortfolioInsights } from "./portfolio-insights.ts";
import { createPortfolioViewModel } from "./portfolio-view-model.ts";

function book() {
  return reconcileBrokerPortfolio(
    null,
    {
      positions: [
        {
          broker: "IBKR",
          instrument: AAPL,
          displayName: "Apple Inc.",
          quantity: "2",
          totalOpenCost: "200",
        },
        {
          broker: "MOOMOO",
          instrument: AAPL,
          displayName: "Apple Inc.",
          quantity: "1",
          totalOpenCost: "120",
        },
      ],
      cashAccounts: [
        {
          broker: "IBKR",
          currency: "USD",
          settledBalance: "1000",
          pendingBalance: "50",
          pricingPlan: "IBKR_PRO",
          netAssetValue: "50000",
          navSource: "USER_ENTERED",
        },
        {
          broker: "MOOMOO",
          currency: "USD",
          settledBalance: "300",
          pendingBalance: "0",
        },
      ],
      effectiveAt: "2026-08-20T01:00:00Z",
    },
    "2026-08-20T01:00:00Z",
    "baseline",
  );
}

describe("broker portfolio projections", () => {
  it("keeps one stock row and propagates aggregate plus broker cash to UI and AI", () => {
    const snapshots = projectBrokerPortfolioSnapshots(book());
    const cash = projectBrokerPortfolioCash(book());
    const [position] = aggregatePositionInputs(snapshots[0]!.batch.inputs);
    expect(position).toMatchObject({
      quantity: "3",
      openCost: "320",
    });

    const view = createPortfolioViewModel(snapshots, [], { currency: "USD" }, cash);
    expect(view).toMatchObject({
      viewState: "ready",
      marketValue: "$1,350.00",
      cash: {
        balance: "$1,350.00",
        accounts: [
          expect.objectContaining({ broker: "IBKR", balance: "$1,050.00" }),
          expect.objectContaining({ broker: "MOOMOO", balance: "$300.00" }),
        ],
      },
    });

    const source = createPortfolioCopySource(snapshots, [], cash);
    const insights = createPortfolioInsights(source);
    const request = createPortfolioConsultationRequest(source, insights, {
      mode: "CHAT",
      generatedAt: "2026-08-20T02:00:00Z",
      question: "现金结构是什么？",
    });
    expect(request).toMatchObject({
      schemaVersion: 4,
      portfolio: {
        summary: { cashBalanceUsd: "1350" },
        cash: {
          provider: "PORTFOLIO",
          balanceUsd: "1350",
          accounts: [
            expect.objectContaining({ provider: "IBKR", pendingBalanceUsd: "50" }),
            expect.objectContaining({ provider: "MOOMOO", settledBalanceUsd: "300" }),
          ],
          ibkrInterest: expect.objectContaining({
            netAssetValueUsd: "50000",
          }),
        },
      },
    });
  });
});
