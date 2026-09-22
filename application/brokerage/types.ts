import {
  createBrokerPortfolioBook,
  type ApplyBrokerTradeInput,
  type BrokerPortfolioBaselineInput,
  type BrokerPortfolioBook,
} from "../../domain/index.ts";

export interface ReplaceBrokerPortfolioOptions {
  readonly expectedRevision?: number | null;
  readonly eventId: string;
}

export interface ApplyBrokerTradeOptions {
  readonly expectedRevision: number;
}

export interface BrokerPortfolioRepository {
  getBrokerPortfolioBook(): Promise<BrokerPortfolioBook | null>;
  getPreviousBrokerPortfolioBook(): Promise<BrokerPortfolioBook | null>;
  replaceBrokerPortfolioBaseline(
    baseline: BrokerPortfolioBaselineInput,
    options: ReplaceBrokerPortfolioOptions,
  ): Promise<BrokerPortfolioBook>;
  applyBrokerTrade(
    trade: ApplyBrokerTradeInput,
    options: ApplyBrokerTradeOptions,
  ): Promise<BrokerPortfolioBook>;
  restoreBrokerPortfolioBackup(
    book: BrokerPortfolioBook,
  ): Promise<BrokerPortfolioBook>;
}

export function cloneBrokerPortfolioBook(
  book: BrokerPortfolioBook,
): BrokerPortfolioBook {
  return createBrokerPortfolioBook(book);
}
