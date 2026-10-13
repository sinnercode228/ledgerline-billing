import type { InvoiceDetail, JournalTransactionDto, PaymentDto } from '../../api/types';

export type InvoiceEvent =
  | { at: string; kind: 'created' | 'paid' | 'uncollectible' | 'refunded' | 'retryScheduled' }
  | { at: string; kind: 'finalized'; number: string }
  | { at: string; kind: 'attempt'; payment: PaymentDto };

/** Oldest first: the order an accountant reads an invoice's life in. */
export function invoiceTimeline(invoice: InvoiceDetail, journal: readonly JournalTransactionDto[]): InvoiceEvent[] {
  const events: InvoiceEvent[] = [{ at: invoice.createdAt, kind: 'created' }];
  if (invoice.finalizedAt && invoice.number) events.push({ at: invoice.finalizedAt, kind: 'finalized', number: invoice.number });
  for (const payment of invoice.payments) events.push({ at: payment.createdAt, kind: 'attempt', payment });
  if (invoice.paidAt) events.push({ at: invoice.paidAt, kind: 'paid' });
  if (invoice.uncollectibleAt) events.push({ at: invoice.uncollectibleAt, kind: 'uncollectible' });
  for (const refund of journal.filter((transaction) => transaction.kind === 'refund')) events.push({ at: refund.postedAt, kind: 'refunded' });
  if (invoice.status === 'open' && invoice.nextRetryAt) events.push({ at: invoice.nextRetryAt, kind: 'retryScheduled' });
  // Payments share the instant of the invoice they settle; a stable sort keeps the order above within it.
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
