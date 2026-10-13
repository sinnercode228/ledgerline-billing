import type { BillingInterval } from './calendar.js';
import { BillingError } from './errors.js';
import { assertNonNegativeMinorUnits, type Currency } from './money.js';

export interface Plan {
  id: string;
  name: string;
  interval: BillingInterval;
  trialDays: number;
  /** Price per billing interval in minor units; a plan is sold only in the currencies listed. */
  prices: Partial<Record<Currency, number>>;
}

export function priceFor(plan: Plan, currency: Currency): number {
  const price = plan.prices[currency];
  if (price === undefined) {
    throw new BillingError('plan_unavailable', `plan ${plan.id} has no ${currency} price`, { planId: plan.id, currency });
  }
  return assertNonNegativeMinorUnits(price, `${plan.id} ${currency} price`);
}

/** The catalog every environment starts with; prices are in minor units. */
export const PLAN_CATALOG: readonly Plan[] = [
  { id: 'plan_starter_monthly', name: 'Starter', interval: 'month', trialDays: 14, prices: { RUB: 99_000, EUR: 900 } },
  { id: 'plan_team_monthly', name: 'Team', interval: 'month', trialDays: 14, prices: { RUB: 299_000, EUR: 2_900 } },
  { id: 'plan_business_monthly', name: 'Business', interval: 'month', trialDays: 0, prices: { RUB: 990_000, EUR: 9_900 } },
  { id: 'plan_team_yearly', name: 'Team (yearly)', interval: 'year', trialDays: 0, prices: { RUB: 2_990_000, EUR: 29_000 } },
  { id: 'plan_business_yearly', name: 'Business (yearly)', interval: 'year', trialDays: 0, prices: { RUB: 9_900_000, EUR: 99_000 } },
];
