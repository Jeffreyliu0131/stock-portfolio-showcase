import { describe, expect, it, vi } from "vitest";

import {
  requestDelayedQuotes,
  type QuoteFetch,
} from "../application/market-data/browser/quote-client.ts";
import { AAPL } from "./helpers.ts";

const GENERATED_AT = "2026-07-30T15:00:00Z";

describe("browser delayed quote client", () => {
  it("returns the server-generated review time with the quote batch", async () => {
    const fetchImpl = vi.fn<QuoteFetch>(async () =>
      new Response(
        JSON.stringify({
          kind: "QUOTES",
          generatedAt: GENERATED_AT,
          quotes: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      requestDelayedQuotes([AAPL], fetchImpl),
    ).resolves.toEqual({
      generatedAt: GENERATED_AT,
      quotes: [],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/quotes",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      }),
    );
  });

  it("rejects a success-shaped response without a server review time", async () => {
    const fetchImpl: QuoteFetch = async () =>
      new Response(
        JSON.stringify({
          kind: "QUOTES",
          quotes: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    await expect(
      requestDelayedQuotes([AAPL], fetchImpl),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
