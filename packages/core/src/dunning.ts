import { addDays, maxDate } from './calendar.js';
import { BillingError } from './errors.js';

export interface DunningPolicy {
  /** Days after the first failed payment on which the invoice is retried. */
  retryDays: readonly number[];
}

export const DEFAULT_DUNNING_POLICY: DunningPolicy = { retryDays: [1, 3, 5] };

export type DunningDecision = { action: 'retry'; at: Date } | { action: 'give_up' };

/**
 * `scheduledRetries` counts retries from the schedule that have already been
 * started. Retries triggered by a new payment method do not count, so a
 * failure there leaves the schedule where it was.
 */
export function decideAfterFailure(input: {
  policy: DunningPolicy;
  firstFailedAt: Date;
  scheduledRetries: number;
  now: Date;
}): DunningDecision {
  const days = input.policy.retryDays[input.scheduledRetries];
  if (days === undefined) {
    return { action: 'give_up' };
  }
  return { action: 'retry', at: maxDate(addDays(input.firstFailedAt, days), input.now) };
}

export function parseRetrySchedule(text: string): number[] {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const days = parts.map((part) => {
    const value = Number(part);
    if (!/^\d+$/.test(part) || !Number.isSafeInteger(value) || value <= 0) {
      throw new BillingError('invalid_argument', `retry days must be positive integers, got "${part}"`);
    }
    return value;
  });
  for (let i = 1; i < days.length; i++) {
    if (days[i]! <= days[i - 1]!) {
      throw new BillingError('invalid_argument', 'retry days must be strictly increasing');
    }
  }
  return days;
}
