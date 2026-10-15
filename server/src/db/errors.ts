import { BillingError } from '@ledgerline/core';
import pg from 'pg';

const BY_CONSTRAINT: Record<string, ConstructorParameters<typeof BillingError>[0]> = {
  invoices_one_per_period: 'duplicate_invoice',
  invoices_status_transition: 'illegal_invoice_transition',
  journal_transaction_balanced: 'unbalanced_transaction',
  journal_entries_transaction_currency_fkey: 'currency_mismatch',
  journal_entries_account_currency_fkey: 'currency_mismatch',
};

/** Turns constraint violations into the same BillingError codes MemoryStore raises; anything else passes through. */
export function translateDatabaseError(error: unknown): unknown {
  if (!(error instanceof pg.DatabaseError)) return error;
  const code = error.constraint ? BY_CONSTRAINT[error.constraint] : undefined;
  if (code) return new BillingError(code, error.message, { constraint: error.constraint });
  if (error.code === '23505') return new BillingError('duplicate_key', error.detail ?? error.message, { constraint: error.constraint });
  if (error.code === '23503') return new BillingError('not_found', error.detail ?? error.message, { constraint: error.constraint });
  return error;
}

/** Deadlocks and serialization failures are safe to retry: the transaction was rolled back as a whole. */
export function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof pg.DatabaseError && (error.code === '40P01' || error.code === '40001');
}
