import { describe, expect, it } from "vitest";

import type { PositionSnapshot } from "../application/positions/types.ts";
import { resolveQuote } from "../domain/quotes.ts";
import { AAPL, validQuote } from "../tests/helpers.ts";
import {
  mergeFreshWithCached,
  reconcileQuoteWithCache,
  shouldShowUnavailableNotice,
} from "./portfolio-controller.tsx";

const NOW = "2026-07-29T15:02:00Z";

const snapshot: PositionSnapshot = {
  revision: 1,
  savedAt: "2026-07-29T15:00:00Z",
  batch: {
    instrument: AAPL,
    displayName: "Apple Inc.",
    inputs: [
      {
        id: "aapl",
        instrument: AAPL,
        quantity: "1",
        costInput: {
          mode: "TOTAL_OPEN_COST",
          value: "100",
        },
      },
    ],
  },
};

function accepted(
  price: string,
  sourceEventAt: string,
  fetchedAt: string,
) {
  return resolveQuote({
    requestedInstrument: AAPL,
    now: NOW,
    fetchStatus: "FETCH_OK",
    marketSession: "REGULAR",
    candidate: validQuote({
      instrument: AAPL,
      price,
      sourceEventAt,
      fetchedAt,
    }),
  });
}

function cached(
  price: string,
  sourceEventAt: string,
  fetchedAt: string,
) {
  return resolveQuote({
    requestedInstrument: AAPL,
    now: NOW,
    fetchStatus: "FETCH_FAILED",
    marketSession: "REGULAR",
    lastValidQuote: validQuote({
      instrument: AAPL,
      price,
      sourceEventAt,
      fetchedAt,
    }),
  });
}

describe("browser quote reconciliation", () => {
  it("keeps the newer persisted event when a server instance returns older data", () => {
    const persisted = cached(
      "130",
      "2026-07-29T14:46:00Z",
      "2026-07-29T15:01:00Z",
    );
    const older = accepted(
      "120",
      "2026-07-29T14:45:00Z",
      "2026-07-29T15:02:00Z",
    );

    expect(
      reconcileQuoteWithCache(older, persisted, NOW),
    ).toMatchObject({
      effectivePrice: "130",
      effectivePriceType: "LAST_VALID_FALLBACK",
      usedLastValid: true,
      acceptedCandidate: false,
      candidateRejection: "OLDER_THAN_LAST_VALID",
    });
    expect(
      mergeFreshWithCached(
        [snapshot],
        [older],
        [persisted],
      )[0],
    ).toEqual(persisted);
  });

  it("rejects a new event with an anomalous jump against the browser cache", () => {
    const persisted = cached(
      "100",
      "2026-07-29T14:45:00Z",
      "2026-07-29T15:00:00Z",
    );
    const anomalous = accepted(
      "200",
      "2026-07-29T14:46:00Z",
      "2026-07-29T15:02:00Z",
    );

    expect(
      reconcileQuoteWithCache(anomalous, persisted, NOW),
    ).toMatchObject({
      effectivePrice: "100",
      effectivePriceType: "LAST_VALID_FALLBACK",
      usedLastValid: true,
      acceptedCandidate: false,
      candidateRejection: "ANOMALOUS_CHANGE",
    });
  });

  it("uses the current overnight close reference even when the browser keeps a cached price", () => {
    const persisted = cached(
      "130",
      "2026-07-29T14:46:00Z",
      "2026-07-29T15:01:00Z",
    );
    const serverFallback = resolveQuote({
      requestedInstrument: AAPL,
      now: NOW,
      fetchStatus: "FETCH_FAILED",
      marketSession: "OVERNIGHT",
      lastValidQuote: validQuote({
        instrument: AAPL,
        price: "129",
        sourceEventAt: "2026-07-29T14:45:00Z",
        fetchedAt: "2026-07-29T15:00:00Z",
        previousRegularClose: "128",
      }),
    });

    expect(
      reconcileQuoteWithCache(serverFallback, persisted, NOW),
    ).toMatchObject({
      effectivePrice: "130",
      previousRegularClose: "128",
      usedLastValid: true,
    });
    expect(
      reconcileQuoteWithCache(
        { ...serverFallback, previousRegularClose: null },
        persisted,
        NOW,
      ),
    ).toMatchObject({
      effectivePrice: "130",
      previousRegularClose: null,
      usedLastValid: true,
    });
  });

  it("does not present a deliberate cache-only period as an outage", () => {
    const intentionallySkipped = resolveQuote({
      requestedInstrument: AAPL,
      now: NOW,
      fetchStatus: "NOT_REQUESTED",
      marketSession: "CLOSED",
    });
    const failed = resolveQuote({
      requestedInstrument: AAPL,
      now: NOW,
      fetchStatus: "FETCH_FAILED",
      marketSession: "UNKNOWN",
    });

    expect(
      shouldShowUnavailableNotice([intentionallySkipped]),
    ).toBe(false);
    expect(shouldShowUnavailableNotice([failed])).toBe(true);
  });

});
