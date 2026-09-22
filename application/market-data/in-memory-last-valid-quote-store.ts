import {
  compareRfc3339,
  createInstrumentKey,
  instrumentKeyId,
  type InstrumentKey,
  type ValidMarketQuote,
} from "../../domain/index.ts";
import type {
  LastValidQuoteStore,
  LastValidQuoteWriteResult,
} from "./types.ts";

function cloneQuote(quote: ValidMarketQuote): ValidMarketQuote {
  return {
    instrument: { ...quote.instrument },
    provider: quote.provider,
    feed: quote.feed,
    price: quote.price,
    priceType: quote.priceType,
    sourceEventAt: quote.sourceEventAt,
    fetchedAt: quote.fetchedAt,
    marketSession: quote.marketSession,
    ...(quote.previousRegularClose === undefined
      ? {}
      : { previousRegularClose: quote.previousRegularClose }),
  };
}

function incomingIsOlder(
  incoming: ValidMarketQuote,
  current: ValidMarketQuote,
): boolean {
  const eventOrder = compareRfc3339(
    incoming.sourceEventAt,
    current.sourceEventAt,
  );
  if (eventOrder !== 0) {
    return eventOrder < 0;
  }
  return compareRfc3339(incoming.fetchedAt, current.fetchedAt) < 0;
}

export class InMemoryLastValidQuoteStore
  implements LastValidQuoteStore
{
  private readonly quotes = new Map<string, ValidMarketQuote>();

  async getLastValidQuote(
    instrumentInput: InstrumentKey,
  ): Promise<ValidMarketQuote | null> {
    const instrument = createInstrumentKey(instrumentInput);
    const quote = this.quotes.get(instrumentKeyId(instrument));
    return quote === undefined ? null : cloneQuote(quote);
  }

  async putLastValidQuoteIfNewer(
    quoteInput: ValidMarketQuote,
  ): Promise<LastValidQuoteWriteResult> {
    const quote = cloneQuote({
      ...quoteInput,
      instrument: createInstrumentKey(quoteInput.instrument),
    });
    const key = instrumentKeyId(quote.instrument);
    const current = this.quotes.get(key);

    if (current !== undefined && incomingIsOlder(quote, current)) {
      return {
        stored: false,
        current: cloneQuote(current),
      };
    }

    this.quotes.set(key, quote);
    return {
      stored: true,
      current: cloneQuote(quote),
    };
  }
}
