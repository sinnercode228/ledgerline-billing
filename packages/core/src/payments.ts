import type { Currency } from './money.js';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed';
export type PaymentTrigger = 'initial' | 'scheduled_retry' | 'payment_method_updated';

export interface Payment {
  id: string;
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
  /** 1-based attempt number for the invoice; part of the outgoing idempotency key. */
  attempt: number;
  trigger: PaymentTrigger;
  idempotencyKey: string;
  paymentMethodId: string | null;
  providerPaymentId: string | null;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** When the provider was last asked about this payment; drives recovery of lost responses. */
  lastAttemptAt: Date;
}

export function paymentIdempotencyKey(invoiceId: string, attempt: number): string {
  return `ledgerline:${invoiceId}:attempt:${attempt}`;
}

export type PaymentUpdateDecision = 'apply' | 'duplicate' | 'stale';

const RANK: Record<PaymentStatus, number> = { pending: 0, failed: 1, succeeded: 2 };

/**
 * Payment status only moves forward. Money that was taken is never "un-taken"
 * by a late failure event, which is recorded as stale instead.
 */
export function decidePaymentUpdate(current: PaymentStatus, incoming: Exclude<PaymentStatus, 'pending'>): PaymentUpdateDecision {
  if (current === incoming) return 'duplicate';
  return RANK[incoming] > RANK[current] ? 'apply' : 'stale';
}
