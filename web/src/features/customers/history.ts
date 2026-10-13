import type { InvoiceDto, JournalTransactionDto, SubscriptionDto } from '../../api/types';

export type HistoryKind = 'subscribed' | 'trialEnded' | 'renewed' | 'prorated' | 'downgradeCredit' | 'paymentFailed' | 'writtenOff' | 'canceled';

export interface HistoryEvent {
  at: string;
  kind: HistoryKind;
  invoice?: InvoiceDto;
  amount?: number;
  planId?: string;
}

/** Within one instant, the order things happen in. */
const ORDER: Record<HistoryKind, number> = {
  subscribed: 0,
  trialEnded: 1,
  renewed: 2,
  prorated: 3,
  downgradeCredit: 4,
  paymentFailed: 5,
  writtenOff: 6,
  canceled: 7,
};

/**
 * A subscription's story, newest first, put together from what the API
 * records: its own dates, its invoices, their dunning fields and the credits
 * the ledger booked for downgrades.
 */
export function subscriptionHistory(
  subscription: SubscriptionDto,
  invoices: readonly InvoiceDto[],
  downgradeCredits: readonly JournalTransactionDto[],
  now: string,
): HistoryEvent[] {
  // The plan at the start is the one the first period was billed for; later changes show up as prorations and credits.
  const firstCycle = invoices
    .filter((invoice) => invoice.subscriptionId === subscription.id && invoice.kind === 'cycle')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const startPlan = firstCycle?.lines.find((line) => line.kind === 'plan')?.planId ?? subscription.planId;
  const events: HistoryEvent[] = [{ at: subscription.createdAt, kind: 'subscribed', planId: startPlan }];
  if (subscription.trialEnd !== null && subscription.trialEnd <= now && subscription.paidCycles > 0) {
    events.push({ at: subscription.trialEnd, kind: 'trialEnded' });
  }
  for (const invoice of invoices) {
    if (invoice.subscriptionId !== subscription.id || invoice.finalizedAt === null) continue;
    events.push({ at: invoice.finalizedAt, kind: invoice.kind === 'cycle' ? 'renewed' : 'prorated', invoice, amount: invoice.total });
    if (invoice.firstFailedAt !== null) events.push({ at: invoice.firstFailedAt, kind: 'paymentFailed', invoice });
    if (invoice.uncollectibleAt !== null) events.push({ at: invoice.uncollectibleAt, kind: 'writtenOff', invoice, amount: invoice.amountDue - invoice.amountPaid });
  }
  for (const credit of downgradeCredits) {
    if (credit.refs.subscriptionId !== subscription.id) continue;
    events.push({ at: credit.postedAt, kind: 'downgradeCredit', amount: credit.entries.reduce((sum, entry) => sum + Math.max(entry.amount, 0), 0) });
  }
  if (subscription.endedAt !== null && subscription.endedAt <= now) events.push({ at: subscription.endedAt, kind: 'canceled' });
  return events.sort((a, b) => b.at.localeCompare(a.at) || ORDER[b.kind] - ORDER[a.kind]);
}
