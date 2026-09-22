import {
  DomainValidationError,
  createIbkrUsdCashAccount,
  rfc3339ToEpochNanoseconds,
  type IbkrUsdCashAccount,
} from "../../domain/index.ts";
import { PositionRepositoryError } from "../positions/types.ts";

export interface CashSnapshot {
  readonly revision: number;
  readonly savedAt: string;
  readonly account: IbkrUsdCashAccount;
}

export interface ReplaceCashSnapshotOptions {
  readonly expectedRevision?: number | null;
}

export interface CashRepository {
  getCashSnapshot(): Promise<CashSnapshot | null>;
  getPreviousCashSnapshot(): Promise<CashSnapshot | null>;
  replaceCashAccount(
    account: IbkrUsdCashAccount,
    options?: ReplaceCashSnapshotOptions,
  ): Promise<CashSnapshot>;
  deleteCashSnapshot(
    options?: ReplaceCashSnapshotOptions,
  ): Promise<boolean>;
}

export function validateCashSavedAt(value: string, field: string): string {
  try {
    rfc3339ToEpochNanoseconds(value, field);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw new PositionRepositoryError(
        "INVALID_PERSISTED_POSITION_DATA",
        error.message,
      );
    }
    throw error;
  }
  return value;
}

export function cloneCashSnapshot(snapshot: CashSnapshot): CashSnapshot {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1
  ) {
    throw new PositionRepositoryError(
      "INVALID_PERSISTED_POSITION_DATA",
      "cash snapshot revision must be a positive safe integer",
    );
  }
  validateCashSavedAt(snapshot.savedAt, "cashSnapshot.savedAt");
  return {
    revision: snapshot.revision,
    savedAt: snapshot.savedAt,
    account: createIbkrUsdCashAccount(snapshot.account),
  };
}
