import { failDomain, requireNonEmpty } from "./errors.ts";

export interface InstrumentKey {
  readonly listingMarket: string;
  readonly symbol: string;
  readonly currency: string;
}

export function createInstrumentKey(input: InstrumentKey): InstrumentKey {
  const listingMarket = requireNonEmpty(
    input.listingMarket,
    "instrument.listingMarket",
  ).toUpperCase();
  const symbol = requireNonEmpty(
    input.symbol,
    "instrument.symbol",
  ).toUpperCase();
  const currency = requireNonEmpty(
    input.currency,
    "instrument.currency",
  ).toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    failDomain({
      code: "INVALID_CURRENCY",
      field: "instrument.currency",
      message: "instrument.currency must be a three-letter currency code",
    });
  }

  return { listingMarket, symbol, currency };
}

export function instrumentKeyId(instrument: InstrumentKey): string {
  const normalized = createInstrumentKey(instrument);
  return JSON.stringify([
    normalized.listingMarket,
    normalized.symbol,
    normalized.currency,
  ]);
}

export function sameInstrument(
  left: InstrumentKey,
  right: InstrumentKey,
): boolean {
  return instrumentKeyId(left) === instrumentKeyId(right);
}
