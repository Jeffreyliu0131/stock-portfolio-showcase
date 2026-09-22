import { describe, expect, it, vi } from "vitest";

import {
  requestIntradayBars,
  type IntradayBarsFetch,
} from "../application/market-data/browser/intraday-bars-client.ts";
import { AAPL } from "./helpers.ts";

const GENERATED_AT = "2026-08-07T15:30:00Z";

function successBody() {
  return {
    kind: "INTRADAY_BARS",
    generatedAt: GENERATED_AT,
    requestedAsOf: GENERATED_AT,
    windowStartAt: "2026-08-07T08:00:00Z",
    availableThrough: "2026-08-07T15:15:00Z",
    provider: "alpaca",
    sourceFeed: "sip",
    delayPolicy: "AT_LEAST_15_MINUTES",
    delayMinutes: 15,
    timeframe: "15Min",
    adjustment: "split",
    series: [
      {
        instrument: AAPL,
        status: "OK",
        bars: [
          {
            close: "130.12345678",
            sourceEventAt: "2026-08-07T15:00:00Z",
            priceType: "MINUTE_BAR_CLOSE",
          },
        ],
      },
    ],
  };
}

describe("browser intraday bars client", () => {
  it("sends only instruments and optional asOf, then validates the response", async () => {
    const fetchImpl = vi.fn<IntradayBarsFetch>(async () =>
      new Response(JSON.stringify(successBody()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      requestIntradayBars([AAPL], {
        asOf: GENERATED_AT,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      kind: "INTRADAY_BARS",
      sourceFeed: "sip",
      series: [
        {
          bars: [{ close: "130.12345678" }],
        },
      ],
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/intraday-bars");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(String(init?.body))).toEqual({
      instruments: [AAPL],
      asOf: GENERATED_AT,
    });
    expect(String(init?.body)).not.toContain("quantity");
    expect(String(init?.body)).not.toContain("cost");
    expect(String(init?.body)).not.toContain("cash");
  });

  it("rejects malformed or unsorted financial data", async () => {
    const malformed = successBody();
    malformed.series[0]!.bars[0]!.close = "0";
    const fetchImpl: IntradayBarsFetch = async () =>
      new Response(JSON.stringify(malformed), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    await expect(
      requestIntradayBars([AAPL], { fetchImpl }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("preserves safe server error codes", async () => {
    const fetchImpl: IntradayBarsFetch = async () =>
      new Response(
        JSON.stringify({
          kind: "ERROR",
          code: "RATE_LIMITED",
          message: "请稍后重试。",
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        },
      );

    await expect(
      requestIntradayBars([AAPL], { fetchImpl }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "请稍后重试。",
    });
  });
});
