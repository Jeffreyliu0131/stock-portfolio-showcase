import { describe, expect, it } from "vitest";

import {
  resolveQuote,
  type MarketSession,
  type QuoteCandidate,
} from "../domain/index.ts";
import { goldenFixture } from "./fixtures/golden.ts";
import { AAPL, MSFT, validQuote } from "./helpers.ts";

function resolveCandidateAt(
  now: string,
  sourceEventAt: string,
  fetchedAt = "2026-07-29T15:16:00Z",
) {
  return resolveQuote({
    requestedInstrument: AAPL,
    now,
    fetchStatus: "FETCH_OK",
    marketSession: "REGULAR",
    candidate: validQuote({ sourceEventAt, fetchedAt }),
  });
}

describe("quote validation and freshness state machine", () => {
  it("uses exact healthy, aging, and stale boundaries", () => {
    expect(
      resolveCandidateAt(
        "2026-07-29T15:17:00Z",
        "2026-07-29T15:00:00Z",
      ).valuationStatus,
    ).toBe("HEALTHY_DELAYED");
    expect(
      resolveCandidateAt(
        "2026-07-29T15:17:00.000000001Z",
        "2026-07-29T15:00:00Z",
      ).valuationStatus,
    ).toBe("AGING");
    expect(
      resolveCandidateAt(
        "2026-07-29T15:20:00Z",
        "2026-07-29T15:00:00Z",
        "2026-07-29T15:19:00Z",
      ).valuationStatus,
    ).toBe("AGING");
    expect(
      resolveCandidateAt(
        "2026-07-29T15:20:00.000000001Z",
        "2026-07-29T15:00:00Z",
        "2026-07-29T15:19:00Z",
      ).valuationStatus,
    ).toBe("STALE");
  });

  it("marks a fetch chain older than two minutes as aging", () => {
    expect(
      resolveCandidateAt(
        "2026-07-29T15:17:00Z",
        "2026-07-29T15:00:00Z",
        "2026-07-29T15:15:00Z",
      ).valuationStatus,
    ).toBe("HEALTHY_DELAYED");
    expect(
      resolveCandidateAt(
        "2026-07-29T15:17:00.000000001Z",
        "2026-07-29T15:00:00Z",
        "2026-07-29T15:15:00Z",
      ).valuationStatus,
    ).toBe("AGING");
  });

  it("passes G-005 by preserving the last valid price and timestamps on failure", () => {
    const input = goldenFixture.cases.G005;
    const resolved = resolveQuote({
      requestedInstrument: AAPL,
      now: input.failedAt,
      fetchStatus: "FETCH_FAILED",
      marketSession: "REGULAR",
      lastValidQuote: validQuote({
        price: input.price,
        sourceEventAt: input.sourceEventAt,
        fetchedAt: input.fetchedAt,
      }),
    });

    expect(resolved.effectivePrice).toBe(input.price);
    expect(resolved.effectivePrice).not.toBe("0");
    expect(resolved.sourceEventAt).toBe(input.sourceEventAt);
    expect(resolved.fetchedAt).toBe(input.fetchedAt);
    expect(resolved.fetchStatus).toBe("FETCH_FAILED");
    expect(resolved.valuationStatus).not.toBe("HEALTHY_DELAYED");
    expect(resolved.effectivePriceType).toBe("LAST_VALID_FALLBACK");
  });

  it("isolates a change over 50% but accepts exactly 50%", () => {
    const lastValidQuote = validQuote({ price: "100" });
    const exactThreshold = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "REGULAR",
      candidate: validQuote({ price: "150" }),
      lastValidQuote,
    });
    const overThreshold = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "REGULAR",
      candidate: validQuote({ price: "150.00000001" }),
      lastValidQuote,
    });

    expect(exactThreshold.acceptedCandidate).toBe(true);
    expect(exactThreshold.effectivePrice).toBe("150");
    expect(overThreshold.acceptedCandidate).toBe(false);
    expect(overThreshold.effectivePrice).toBe("100");
    expect(overThreshold.valuationStatus).toBe("ANOMALOUS");
    expect(overThreshold.candidateRejection).toBe("ANOMALOUS_CHANGE");
  });

  it("rejects candidates that would move the last valid quote backward", () => {
    const lastValidQuote = validQuote({
      price: "130",
      sourceEventAt: "2026-07-29T14:45:00Z",
      fetchedAt: "2026-07-29T15:00:30Z",
    });
    const olderEvent = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "REGULAR",
      candidate: validQuote({
        price: "129",
        sourceEventAt: "2026-07-29T14:44:59Z",
        fetchedAt: "2026-07-29T15:00:45Z",
      }),
      lastValidQuote,
    });
    const olderFetchForSameEvent = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "REGULAR",
      candidate: validQuote({
        price: "129",
        sourceEventAt: "2026-07-29T14:45:00Z",
        fetchedAt: "2026-07-29T15:00:29.999999999Z",
      }),
      lastValidQuote,
    });

    for (const resolved of [olderEvent, olderFetchForSameEvent]) {
      expect(resolved.acceptedCandidate).toBe(false);
      expect(resolved.usedLastValid).toBe(true);
      expect(resolved.candidateRejection).toBe("OLDER_THAN_LAST_VALID");
      expect(resolved.effectivePrice).toBe("130");
      expect(resolved.sourceEventAt).toBe("2026-07-29T14:45:00Z");
      expect(resolved.fetchedAt).toBe("2026-07-29T15:00:30Z");
    }
  });

  it("still accepts a candidate newer than the last valid quote", () => {
    const resolved = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "REGULAR",
      candidate: validQuote({
        price: "131",
        sourceEventAt: "2026-07-29T14:46:00Z",
        fetchedAt: "2026-07-29T15:00:45Z",
      }),
      lastValidQuote: validQuote({
        price: "130",
        sourceEventAt: "2026-07-29T14:45:00Z",
        fetchedAt: "2026-07-29T15:00:30Z",
      }),
    });

    expect(resolved.acceptedCandidate).toBe(true);
    expect(resolved.usedLastValid).toBe(false);
    expect(resolved.candidateRejection).toBeNull();
    expect(resolved.effectivePrice).toBe("131");
    expect(resolved.sourceEventAt).toBe("2026-07-29T14:46:00Z");
    expect(resolved.fetchedAt).toBe("2026-07-29T15:00:45Z");
  });

  it.each([
    ["zero", validQuote({ price: "0" }), "NON_POSITIVE_PRICE"],
    ["negative", validQuote({ price: "-1" }), "NON_POSITIVE_PRICE"],
    [
      "future event",
      validQuote({ sourceEventAt: "2026-07-29T15:02:00Z" }),
      "SOURCE_EVENT_IN_FUTURE",
    ],
    [
      "future fetch",
      validQuote({ fetchedAt: "2026-07-29T15:02:00Z" }),
      "FETCH_TIME_IN_FUTURE",
    ],
    [
      "event after fetch",
      validQuote({
        sourceEventAt: "2026-07-29T15:00:00Z",
        fetchedAt: "2026-07-29T14:59:59Z",
      }),
      "SOURCE_EVENT_AFTER_FETCH",
    ],
    [
      "instrument mismatch",
      validQuote({ instrument: MSFT }),
      "INSTRUMENT_MISMATCH",
    ],
  ] as const)(
    "rejects %s without overwriting the last valid quote",
    (_label, candidate, rejection) => {
      const resolved = resolveQuote({
        requestedInstrument: AAPL,
        now: "2026-07-29T15:01:00Z",
        fetchStatus: "FETCH_OK",
        marketSession: "REGULAR",
        candidate,
        lastValidQuote: validQuote({ price: "130" }),
      });

      expect(resolved.effectivePrice).toBe("130");
      expect(resolved.usedLastValid).toBe(true);
      expect(resolved.candidateRejection).toBe(rejection);
      expect(resolved.valuationStatus).toBe("ANOMALOUS");
    },
  );

  it("returns no effective value when an invalid first quote has no fallback", () => {
    const candidate: QuoteCandidate = {
      instrument: AAPL,
      provider: "fixture-provider",
      feed: "delayed_sip",
      priceType: "LATEST_ELIGIBLE_TRADE",
      sourceEventAt: "2026-07-29T14:45:00Z",
      fetchedAt: "2026-07-29T15:00:00Z",
      marketSession: "REGULAR",
    };
    const resolved = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "REGULAR",
      candidate,
    });

    expect(resolved.effectivePrice).toBeNull();
    expect(resolved.valuationStatus).toBe("ANOMALOUS");
    expect(resolved.candidateRejection).toBe("MALFORMED");
  });

  it("distinguishes no recent trade from provider failure", () => {
    const quote = validQuote({
      sourceEventAt: "2026-07-29T14:30:00Z",
      fetchedAt: "2026-07-29T14:31:00Z",
    });
    const noTrade = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "REGULAR",
      lastValidQuote: quote,
      noRecentTrade: true,
    });
    const failure = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_FAILED",
      marketSession: "REGULAR",
      lastValidQuote: quote,
    });

    expect(noTrade.valuationStatus).toBe("NO_RECENT_TRADE");
    expect(noTrade.fetchStatus).toBe("FETCH_OK");
    expect(failure.valuationStatus).toBe("STALE");
    expect(failure.fetchStatus).toBe("FETCH_FAILED");
  });

  it("treats closed final data as final without accumulating weekend staleness", () => {
    const closed = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-08-02T12:00:00Z",
      fetchStatus: "FETCH_OK",
      marketSession: "CLOSED",
      lastValidQuote: validQuote({
        sourceEventAt: "2026-07-31T20:00:00Z",
        fetchedAt: "2026-07-31T20:15:00Z",
      }),
      closedSessionDataFinal: true,
    });
    expect(closed.valuationStatus).toBe("CLOSED_FINAL");
  });

  it("keeps an intentional cache-only closure distinct from a fetch failure", () => {
    const closed = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-08-02T12:00:00Z",
      fetchStatus: "NOT_REQUESTED",
      marketSession: "CLOSED",
      lastValidQuote: validQuote({
        sourceEventAt: "2026-07-31T19:45:00Z",
        fetchedAt: "2026-07-31T20:00:00Z",
      }),
    });

    expect(closed).toMatchObject({
      fetchStatus: "NOT_REQUESTED",
      marketSession: "CLOSED",
      valuationStatus: "AGING",
      effectivePriceType: "LAST_VALID_FALLBACK",
      usedLastValid: true,
    });
  });

  it.each([
    ["RATE_LIMITED", "RATE_LIMITED"],
    ["UNAUTHORIZED", "UNAUTHORIZED"],
  ] as const)("keeps %s distinct", (fetchStatus, expected) => {
    const result = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus,
      marketSession: "REGULAR",
      lastValidQuote: validQuote(),
    });
    expect(result.fetchStatus).toBe(expected);
    expect(result.effectivePrice).toBe("130");
  });

  it("does not claim healthy delayed data for an unknown market session", () => {
    const marketSession: MarketSession = "UNKNOWN";
    const result = resolveQuote({
      requestedInstrument: AAPL,
      now: "2026-07-29T15:01:00Z",
      fetchStatus: "FETCH_OK",
      marketSession,
      candidate: validQuote({ marketSession }),
    });
    expect(result.valuationStatus).toBe("AGING");
  });

  it("rejects contradictory provider outcomes", () => {
    expect(() =>
      resolveQuote({
        requestedInstrument: AAPL,
        now: "2026-07-29T15:01:00Z",
        fetchStatus: "FETCH_FAILED",
        marketSession: "REGULAR",
        candidate: validQuote(),
      }),
    ).toThrow();
    expect(() =>
      resolveQuote({
        requestedInstrument: AAPL,
        now: "2026-07-29T15:01:00Z",
        fetchStatus: "RATE_LIMITED",
        marketSession: "REGULAR",
        lastValidQuote: validQuote(),
        noRecentTrade: true,
      }),
    ).toThrow();
    expect(() =>
      resolveQuote({
        requestedInstrument: AAPL,
        now: "2026-07-29T15:01:00Z",
        fetchStatus: "FETCH_OK",
        marketSession: "REGULAR",
        candidate: validQuote(),
        noRecentTrade: true,
      }),
    ).toThrow();
  });
});
