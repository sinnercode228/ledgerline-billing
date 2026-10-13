export type BillingInterval = 'month' | 'year';

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Billing instants are whole seconds so proration works on exact second counts. */
export function truncateToSecond(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / SECOND_MS) * SECOND_MS);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}

/**
 * Moves `months` calendar months from the anchor, keeping the anchor's day of
 * month and time of day and clamping the day to the target month's length.
 * Always computed from the anchor, never from the previous boundary, so
 * Jan 31 -> Feb 28 -> Mar 31 instead of drifting to the 28th.
 */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const totalMonths = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month));
  return new Date(
    Date.UTC(year, month, day, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()),
  );
}

/** Start of the billing period with the given index; period i is [boundary(i), boundary(i + 1)). */
export function periodBoundary(anchor: Date, interval: BillingInterval, index: number): Date {
  return addMonthsClamped(anchor, interval === 'month' ? index : index * 12);
}

export function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}
