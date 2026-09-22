import { portfolioTarget } from "./runtime/build-target.ts";
import type { BrokerPortfolioRepository } from "./brokerage/types.ts";
import type { CashRepository } from "./cash/types.ts";
import { CloudPortfolioRepository } from "./cloud/browser/cloud-portfolio-repository.ts";
import type { PositionBackupRestorer } from "./positions/position-backup.ts";
import {
  IndexedDbPositionRepository,
  type PositionRepository,
} from "./positions/index.ts";

export type PortfolioRepository = PositionRepository &
  CashRepository &
  PositionBackupRestorer &
  BrokerPortfolioRepository;

export function createPortfolioRepository(): PortfolioRepository {
  const environment = (
    globalThis as typeof globalThis & {
      readonly process?: {
        readonly env?: Readonly<Record<string, string | undefined>>;
      };
    }
  ).process?.env;
  if (portfolioTarget() !== "sites" || environment?.NODE_ENV === "test" || environment?.VITEST === "true") {
    return new IndexedDbPositionRepository();
  }
  return new CloudPortfolioRepository();
}
