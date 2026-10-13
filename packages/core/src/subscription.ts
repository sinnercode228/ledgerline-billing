import { periodBoundary, type BillingInterval } from './calendar.js';
import { BillingError } from './errors.js';
import type { Currency } from './money.js';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type SubscriptionEvent =
  | 'trial_ended'
  | 'payment_failed'
  | 'payment_recovered'
  | 'dunning_exhausted'
  | 'period_ended_canceled';

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  currency: Currency;
  status: SubscriptionStatus;
  /** Every period boundary is derived from this instant; it is the trial end when there is a trial. */
  billingAnchor: Date;
  /** Paid periods started so far; the next one is [boundary(paidCycles), boundary(paidCycles + 1)). */
  paidCycles: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TRANSITIONS: Record<SubscriptionStatus, Partial<Record<SubscriptionEvent, SubscriptionStatus>>> = {
  trialing: { trial_ended: 'active', period_ended_canceled: 'canceled' },
  active: { payment_failed: 'past_due', period_ended_canceled: 'canceled', dunning_exhausted: 'canceled' },
  past_due: { payment_failed: 'past_due', payment_recovered: 'active', dunning_exhausted: 'canceled' },
  canceled: {},
};

export function transition(status: SubscriptionStatus, event: SubscriptionEvent): SubscriptionStatus {
  const next = TRANSITIONS[status][event];
  if (!next) {
    throw new BillingError('invalid_transition', `subscription cannot handle ${event} while ${status}`, { status, event });
  }
  return next;
}

export function nextPeriod(
  subscription: Pick<Subscription, 'billingAnchor' | 'paidCycles' | 'currentPeriodStart' | 'currentPeriodEnd'>,
  interval: BillingInterval,
): { start: Date; end: Date } {
  const start = periodBoundary(subscription.billingAnchor, interval, subscription.paidCycles);
  if (start.getTime() !== subscription.currentPeriodEnd.getTime()) {
    throw new BillingError('invalid_argument', 'the next period must start where the current one ends', {
      expected: subscription.currentPeriodEnd.toISOString(),
      computed: start.toISOString(),
    });
  }
  return { start, end: periodBoundary(subscription.billingAnchor, interval, subscription.paidCycles + 1) };
}

export function isLive(status: SubscriptionStatus): boolean {
  return status !== 'canceled';
}
