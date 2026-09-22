export const BUFFETT_RESEARCH_SYMBOLS = ["AAPL", "MSFT"] as const;

export type BuffettResearchSymbol =
  (typeof BUFFETT_RESEARCH_SYMBOLS)[number];

export interface BuffettResearchIssuer {
  readonly symbol: BuffettResearchSymbol;
  readonly companyName: string;
  readonly cik: string;
  readonly allowedWebDomains: readonly string[];
}

const ISSUERS: Readonly<Record<BuffettResearchSymbol, BuffettResearchIssuer>> = {
  AAPL: {
    symbol: "AAPL",
    companyName: "Apple Inc.",
    cik: "0000320193",
    allowedWebDomains: ["sec.gov", "apple.com"],
  },
  MSFT: {
    symbol: "MSFT",
    companyName: "Microsoft Corporation",
    cik: "0000789019",
    allowedWebDomains: ["sec.gov", "microsoft.com"],
  },
};

export function isBuffettResearchSymbol(
  value: unknown,
): value is BuffettResearchSymbol {
  return value === "AAPL" || value === "MSFT";
}

export function buffettResearchIssuer(
  symbol: BuffettResearchSymbol,
): BuffettResearchIssuer {
  return ISSUERS[symbol];
}
