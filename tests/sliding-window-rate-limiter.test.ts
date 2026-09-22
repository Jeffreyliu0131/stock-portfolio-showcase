import { describe, expect, it } from "vitest";

import { SlidingWindowRateLimiter } from "../application/ai/server/sliding-window-rate-limiter.ts";

describe("SlidingWindowRateLimiter", () => {
  it("limits each key independently and reopens after the window", () => {
    const limiter = new SlidingWindowRateLimiter({
      limit: 2,
      windowMs: 1_000,
    });

    expect(limiter.take("a", 0)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(limiter.take("a", 100)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(limiter.take("b", 100)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(limiter.take("a", 200)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.take("a", 1_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("clears in-memory state", () => {
    const limiter = new SlidingWindowRateLimiter({
      limit: 1,
      windowMs: 60_000,
    });
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 1).allowed).toBe(false);
    limiter.clear();
    expect(limiter.take("a", 2).allowed).toBe(true);
  });
});
