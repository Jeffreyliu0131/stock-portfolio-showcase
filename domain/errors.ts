export type DomainIssueCode =
  | "CALCULATION_VERSION_MISMATCH"
  | "DECIMAL_SCALE_EXCEEDED"
  | "DUPLICATE_ENTRY_ID"
  | "ENTRY_AT_OR_BEFORE_OPENING"
  | "INVALID_COST"
  | "INVALID_CURRENCY"
  | "INVALID_DECIMAL"
  | "INVALID_ENTRY"
  | "INVALID_FEE"
  | "INVALID_IDENTIFIER"
  | "INVALID_INSTRUMENT"
  | "INVALID_PRICE"
  | "INVALID_QUANTITY"
  | "INVALID_RATE"
  | "INVALID_TIMESTAMP"
  | "MISSING_RECONCILIATION_REASON"
  | "MIXED_LEDGER_GROUP"
  | "MULTIPLE_OPENING_POSITIONS"
  | "NEGATIVE_POSITION"
  | "SUPERSEDE_CYCLE"
  | "SUPERSEDE_FORK"
  | "SUPERSEDE_GROUP_MISMATCH"
  | "SUPERSEDE_REASON_REQUIRED"
  | "SUPERSEDE_TYPE_MISMATCH"
  | "UNKNOWN_SUPERSEDED_ENTRY"
  | "ZERO_QUANTITY_REQUIRES_ZERO_COST";

export interface DomainIssue {
  readonly code: DomainIssueCode;
  readonly message: string;
  readonly field?: string;
  readonly entryId?: string;
}

export class DomainValidationError extends Error {
  readonly code = "DOMAIN_VALIDATION_ERROR";
  readonly issues: readonly DomainIssue[];

  constructor(issues: readonly DomainIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

export function failDomain(issue: DomainIssue): never {
  throw new DomainValidationError([issue]);
}

export function requireNonEmpty(
  value: string,
  field: string,
  entryId?: string,
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    failDomain({
      code: "INVALID_IDENTIFIER",
      field,
      ...(entryId === undefined ? {} : { entryId }),
      message: `${field} must not be empty`,
    });
  }
  return normalized;
}
