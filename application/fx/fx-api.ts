import type { UsdCnyRate } from "./types.ts";

export type FxRateApiErrorCode =
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "FX_RATE_UNAVAILABLE";

export interface FxRateApiSuccess {
  readonly kind: "USD_CNY_RATE";
  readonly rate: UsdCnyRate;
}

export interface FxRateApiError {
  readonly kind: "ERROR";
  readonly code: FxRateApiErrorCode;
  readonly message: string;
}

export type FxRateApiResponse = FxRateApiSuccess | FxRateApiError;
