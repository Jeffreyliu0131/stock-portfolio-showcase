export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface RateLimitBucket {
  readonly timestamps: number[];
  lastSeenAt: number;
}

/**
 * Best-effort per-instance protection for a stateless serverless route. A
 * provider balance cap or edge-level limiter remains the hard spend boundary.
 */
export class SlidingWindowRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxBuckets: number;
  readonly #buckets = new Map<string, RateLimitBucket>();

  constructor(input: {
    readonly limit: number;
    readonly windowMs: number;
    readonly maxBuckets?: number;
  }) {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      !Number.isSafeInteger(input.windowMs) ||
      input.windowMs < 1
    ) {
      throw new Error("invalid sliding-window rate limiter configuration");
    }
    this.#limit = input.limit;
    this.#windowMs = input.windowMs;
    this.#maxBuckets = input.maxBuckets ?? 2_000;
  }

  take(key: string, now: number = Date.now()): RateLimitDecision {
    this.#pruneBuckets(now);
    const bucket = this.#buckets.get(key) ?? {
      timestamps: [],
      lastSeenAt: now,
    };
    bucket.lastSeenAt = now;
    const cutoff = now - this.#windowMs;
    while ((bucket.timestamps[0] ?? Number.POSITIVE_INFINITY) <= cutoff) {
      bucket.timestamps.shift();
    }
    if (bucket.timestamps.length >= this.#limit) {
      const oldest = bucket.timestamps[0] ?? now;
      this.#buckets.set(key, bucket);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + this.#windowMs - now) / 1_000),
        ),
      };
    }
    bucket.timestamps.push(now);
    this.#buckets.set(key, bucket);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  clear(): void {
    this.#buckets.clear();
  }

  #pruneBuckets(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.lastSeenAt <= now - this.#windowMs) {
        this.#buckets.delete(key);
      }
    }
    if (this.#buckets.size < this.#maxBuckets) {
      return;
    }
    const oldest = [...this.#buckets.entries()]
      .toSorted((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, Math.ceil(this.#maxBuckets / 10));
    for (const [key] of oldest) {
      this.#buckets.delete(key);
    }
  }
}
