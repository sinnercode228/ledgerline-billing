import { CURRENCIES, type Currency } from './money.js';
import type { Plan } from './plans.js';
import type { DailyRevenue } from './ports/store.js';
import type { Subscription, SubscriptionStatus } from './subscription.js';

export interface Metrics {
  asOf: Date;
  /** Active and past-due subscriptions, yearly plans as a twelfth; trials are not revenue yet. */
  mrr: Array<{ currency: Currency; amount: number }>;
  subscriptions: Record<SubscriptionStatus, number>;
  churnedLast30Days: number;
  revenueByDay: DailyRevenue[];
}

export function monthlyRecurringRevenue(subscriptions: readonly Subscription[], plans: ReadonlyMap<string, Plan>): Metrics['mrr'] {
  return CURRENCIES.map((currency) => {
    let monthly = 0;
    let yearly = 0;
    for (const subscription of subscriptions) {
      if (subscription.currency !== currency) continue;
      if (subscription.status !== 'active' && subscription.status !== 'past_due') continue;
      const plan = plans.get(subscription.planId);
      const price = plan?.prices[currency];
      if (!plan || price === undefined) continue;
      if (plan.interval === 'month') monthly += price;
      else yearly += price;
    }
    // Yearly prices are summed first and divided once, rounding half up.
    return { currency, amount: monthly + Math.floor((yearly + 6) / 12) };
  });
}

export function countByStatus(subscriptions: readonly Subscription[]): Record<SubscriptionStatus, number> {
  const counts: Record<SubscriptionStatus, number> = { trialing: 0, active: 0, past_due: 0, canceled: 0 };
  for (const subscription of subscriptions) counts[subscription.status] += 1;
  return counts;
}

export function churnedBetween(subscriptions: readonly Subscription[], from: Date, to: Date): number {
  return subscriptions.filter((s) => s.status === 'canceled' && s.endedAt !== null && s.endedAt > from && s.endedAt <= to).length;
}
