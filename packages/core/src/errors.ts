export type BillingErrorCode =
  | 'invalid_amount'
  | 'invalid_argument'
  | 'currency_mismatch'
  | 'unbalanced_transaction'
  | 'not_found'
  | 'invalid_transition'
  | 'plan_unavailable'
  | 'interval_mismatch'
  | 'same_plan'
  | 'subscription_not_changeable'
  | 'payment_method_required'
  | 'card_not_supported'
  | 'idempotency_conflict'
  | 'duplicate_invoice'
  | 'duplicate_key'
  | 'clock_not_set';

export class BillingError extends Error {
  override readonly name = 'BillingError';

  constructor(
    readonly code: BillingErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

export function isBillingError(error: unknown, code?: BillingErrorCode): error is BillingError {
  return error instanceof BillingError && (code === undefined || error.code === code);
}
