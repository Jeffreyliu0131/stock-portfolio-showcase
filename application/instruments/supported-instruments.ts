import {
  createInstrumentKey,
  type InstrumentKey,
} from "../../domain/instrument.ts";

export const SUPPORTED_LISTING_MARKETS = [
  "NASDAQ",
  "NYSE",
  "AMEX",
  "ARCA",
  "NYSEARCA",
  "BATS",
] as const;

export type SupportedListingMarket =
  (typeof SUPPORTED_LISTING_MARKETS)[number];

export type InstrumentResolutionIssue =
  | "INVALID_INPUT"
  | "INVALID_SYMBOL"
  | "UNSUPPORTED_MARKET"
  | "UNSUPPORTED_CURRENCY";

export type InstrumentResolutionResult =
  | {
      readonly ok: true;
      readonly instrument: InstrumentKey;
    }
  | {
      readonly ok: false;
      readonly issue: InstrumentResolutionIssue;
    };

const SUPPORTED_MARKETS = new Set<string>(SUPPORTED_LISTING_MARKETS);
const US_EQUITY_SYMBOL = /^[A-Z][A-Z0-9.-]{0,14}$/;

export function normalizeSupportedSymbol(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const symbol = input.trim().toUpperCase();
  return US_EQUITY_SYMBOL.test(symbol) ? symbol : null;
}

function field(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = input[key];
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

/**
 * Validates a complete instrument key after its listing market has been
 * resolved by the provider.
 */
export function resolveSupportedInstrument(
  input: unknown,
): InstrumentResolutionResult {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return { ok: false, issue: "INVALID_INPUT" };
  }

  const record = input as Readonly<Record<string, unknown>>;
  const symbol = normalizeSupportedSymbol(record.symbol);
  const listingMarket = field(record, "listingMarket");
  const currency = field(record, "currency") ?? "USD";

  if (symbol === null) {
    return { ok: false, issue: "INVALID_SYMBOL" };
  }
  if (
    listingMarket === null ||
    !SUPPORTED_MARKETS.has(listingMarket)
  ) {
    return { ok: false, issue: "UNSUPPORTED_MARKET" };
  }
  if (currency !== "USD") {
    return { ok: false, issue: "UNSUPPORTED_CURRENCY" };
  }

  return {
    ok: true,
    instrument: createInstrumentKey({
      listingMarket,
      symbol,
      currency,
    }),
  };
}

export function isSupportedInstrument(
  instrument: InstrumentKey,
): boolean {
  return resolveSupportedInstrument(instrument).ok;
}
