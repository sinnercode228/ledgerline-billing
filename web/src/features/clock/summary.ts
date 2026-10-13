import type { DayReportDto } from '../../api/types';

/** The counts of a day report, in the order the summary reads them out. */
export const ACTIVITIES = [
  'renewals',
  'trialsEnded',
  'paymentsSucceeded',
  'paymentsFailed',
  'retries',
  'canceled',
  'writtenOff',
  'recoveredPayments',
] as const;

export type Activity = (typeof ACTIVITIES)[number];
export type Totals = Record<Activity, number>;

export function totalsOf(days: readonly DayReportDto[]): Totals {
  const totals = Object.fromEntries(ACTIVITIES.map((activity) => [activity, 0])) as Totals;
  for (const day of days) {
    for (const activity of ACTIVITIES) totals[activity] += day[activity];
  }
  return totals;
}

export const isQuiet = (totals: Totals): boolean => ACTIVITIES.every((activity) => totals[activity] === 0);
