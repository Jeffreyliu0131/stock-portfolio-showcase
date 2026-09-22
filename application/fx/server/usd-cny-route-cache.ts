import type { UsdCnyRate } from "@/application/fx";
import { fxRouteLimiter } from "@/application/http/public-route-rate-limiters";

const FX_CACHE_TTL_MS = 15 * 60_000;

let cachedRate: {
  readonly rate: UsdCnyRate;
  readonly expiresAt: number;
} | null = null;
let inFlightRate: Promise<UsdCnyRate> | null = null;

export async function getCachedUsdCnyRate(
  fetchLatestRate: () => Promise<UsdCnyRate>,
  now: number = Date.now(),
): Promise<UsdCnyRate> {
  if (cachedRate !== null && cachedRate.expiresAt > now) {
    return cachedRate.rate;
  }
  if (inFlightRate !== null) {
    return inFlightRate;
  }
  inFlightRate = fetchLatestRate();
  try {
    const rate = await inFlightRate;
    cachedRate = { rate, expiresAt: now + FX_CACHE_TTL_MS };
    return rate;
  } finally {
    inFlightRate = null;
  }
}

export function resetFxRouteSecurityForTests(): void {
  fxRouteLimiter.clear();
  cachedRate = null;
  inFlightRate = null;
}
