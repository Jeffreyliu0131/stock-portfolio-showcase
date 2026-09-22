import {
  normalizeUsdCnyRate,
  type UsdCnyRate,
} from "../types.ts";

export const USD_CNY_RATE_CACHE_KEY =
  "stock-portfolio:last-valid-usd-cny-rate:v1";

export function readCachedUsdCnyRate(
  storage: Pick<Storage, "getItem">,
): UsdCnyRate | null {
  try {
    const serialized = storage.getItem(USD_CNY_RATE_CACHE_KEY);
    if (serialized === null) {
      return null;
    }
    return normalizeUsdCnyRate(JSON.parse(serialized) as unknown);
  } catch {
    return null;
  }
}

export function writeCachedUsdCnyRate(
  rate: UsdCnyRate,
  storage: Pick<Storage, "setItem">,
): boolean {
  try {
    storage.setItem(USD_CNY_RATE_CACHE_KEY, JSON.stringify(rate));
    return true;
  } catch {
    return false;
  }
}
