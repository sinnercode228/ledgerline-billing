import { SECOND_MS, truncateToSecond } from './calendar.js';
import { BillingError } from './errors.js';
import type { InvoiceLine } from './invoice.js';
import { mulDivFloor, negate } from './money.js';

/**
 * Proration rule: the unused part of the old price is credited and the
 * remaining part of the new price is charged, each computed from whole
 * seconds as price × remaining / period and rounded down to a minor unit.
 *
 * Rounding down both amounts means a full period prorates to exactly the
 * price, a credit never exceeds what was paid for the period, and each line
 * is at most one minor unit away from the exact value.
 */
export function prorationAmount(price: number, remainingSeconds: number, periodSeconds: number): number {
  if (remainingSeconds > periodSeconds) {
    throw new BillingError('invalid_argument', 'remaining time cannot exceed the period');
  }
  return mulDivFloor(price, remainingSeconds, periodSeconds);
}

export interface PricedPlan {
  planId: string;
  name: string;
  price: number;
}

export interface ProrationQuote {
  changeAt: Date;
  periodStart: Date;
  periodEnd: Date;
  remainingSeconds: number;
  periodSeconds: number;
  credit: number;
  charge: number;
  /** charge - credit: positive is invoiced now, negative becomes customer credit. */
  net: number;
  lines: InvoiceLine[];
}

export function quotePlanChange(input: {
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
  from: PricedPlan;
  to: PricedPlan;
}): ProrationQuote {
  const changeAt = truncateToSecond(input.changeAt);
  const { periodStart, periodEnd } = input;
  if (changeAt < periodStart || changeAt >= periodEnd) {
    throw new BillingError('invalid_argument', 'a plan change must happen inside the current period');
  }
  const periodSeconds = (periodEnd.getTime() - periodStart.getTime()) / SECOND_MS;
  const remainingSeconds = (periodEnd.getTime() - changeAt.getTime()) / SECOND_MS;
  if (!Number.isInteger(periodSeconds) || !Number.isInteger(remainingSeconds)) {
    throw new BillingError('invalid_argument', 'period bounds must be whole seconds');
  }
  const credit = prorationAmount(input.from.price, remainingSeconds, periodSeconds);
  const charge = prorationAmount(input.to.price, remainingSeconds, periodSeconds);
  return {
    changeAt,
    periodStart,
    periodEnd,
    remainingSeconds,
    periodSeconds,
    credit,
    charge,
    net: charge - credit,
    lines: [
      {
        kind: 'proration_credit',
        description: `Unused time on ${input.from.name}`,
        amount: negate(credit),
        planId: input.from.planId,
        periodStart: changeAt,
        periodEnd,
      },
      {
        kind: 'proration_charge',
        description: `Remaining time on ${input.to.name}`,
        amount: charge,
        planId: input.to.planId,
        periodStart: changeAt,
        periodEnd,
      },
    ],
  };
}
