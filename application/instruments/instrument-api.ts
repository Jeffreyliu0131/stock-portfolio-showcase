import type { InstrumentKey } from "../../domain/instrument.ts";

export type InstrumentApiErrorCode =
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "INSTRUMENT_NOT_SUPPORTED"
  | "INSTRUMENT_SERVICE_NOT_CONFIGURED"
  | "INSTRUMENT_SERVICE_UNAVAILABLE";

export interface InstrumentApiSuccess {
  readonly kind: "INSTRUMENT";
  readonly instrument: InstrumentKey;
  readonly displayName: string;
}

export interface InstrumentApiError {
  readonly kind: "ERROR";
  readonly code: InstrumentApiErrorCode;
  readonly message: string;
}

export type InstrumentApiResponse =
  | InstrumentApiSuccess
  | InstrumentApiError;
