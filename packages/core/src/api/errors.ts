import type { BillingErrorCode } from '../errors.js';

const STATUS_BY_CODE: Partial<Record<BillingErrorCode, number>> = {
  not_found: 404,
  idempotency_conflict: 409,
  duplicate_invoice: 409,
  duplicate_key: 409,
  invalid_transition: 409,
  // The engine balances every posting itself; reaching the store's check is a bug.
  unbalanced_transaction: 500,
};

/** The HTTP status the API answers a billing error with; rule violations are 422. */
export function statusForBillingError(code: BillingErrorCode): number {
  return STATUS_BY_CODE[code] ?? 422;
}
