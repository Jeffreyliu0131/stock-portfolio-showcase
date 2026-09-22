import { SlidingWindowRateLimiter } from "@/application/ai/server/sliding-window-rate-limiter";

export const instrumentRouteLimiter = new SlidingWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
});

export const quoteRouteLimiter = new SlidingWindowRateLimiter({
  limit: 60,
  windowMs: 60_000,
});

export const intradayBarsRouteLimiter = new SlidingWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
});

export const fxRouteLimiter = new SlidingWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
});

export const portfolioAiRouteLimiter = new SlidingWindowRateLimiter({
  limit: 12,
  windowMs: 60_000,
});

export const buffettResearchRouteLimiter = new SlidingWindowRateLimiter({
  limit: 4,
  windowMs: 60_000,
});

export function resetInstrumentRateLimitForTests(): void {
  instrumentRouteLimiter.clear();
}

export function resetQuoteRateLimitForTests(): void {
  quoteRouteLimiter.clear();
}

export function resetIntradayBarsRateLimitForTests(): void {
  intradayBarsRouteLimiter.clear();
}

export function resetPortfolioAiRateLimitForTests(): void {
  portfolioAiRouteLimiter.clear();
}

export function resetBuffettResearchRateLimitForTests(): void {
  buffettResearchRouteLimiter.clear();
}
