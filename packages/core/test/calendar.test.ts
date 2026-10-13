import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMonthsClamped, daysInMonth, periodBoundary, truncateToSecond, utcDay } from '../src/calendar.js';

const iso = (d: Date) => d.toISOString();

describe('billing anchors', () => {
  it('keeps the anchor day and clamps to shorter months', () => {
    const anchor = new Date('2026-01-31T10:15:00Z');
    const boundaries = [0, 1, 2, 3, 4].map((i) => iso(periodBoundary(anchor, 'month', i)));
    expect(boundaries).toEqual([
      '2026-01-31T10:15:00.000Z',
      '2026-02-28T10:15:00.000Z',
      '2026-03-31T10:15:00.000Z',
      '2026-04-30T10:15:00.000Z',
      '2026-05-31T10:15:00.000Z',
    ]);
  });

  it('uses February 29 in leap years', () => {
    const anchor = new Date('2028-01-30T00:00:00Z');
    expect(iso(periodBoundary(anchor, 'month', 1))).toBe('2028-02-29T00:00:00.000Z');
    expect(iso(periodBoundary(anchor, 'month', 2))).toBe('2028-03-30T00:00:00.000Z');
  });

  it('renews a yearly plan anchored on February 29 on the 28th until the next leap year', () => {
    const anchor = new Date('2028-02-29T12:00:00Z');
    const boundaries = [0, 1, 2, 3, 4].map((i) => iso(periodBoundary(anchor, 'year', i)));
    expect(boundaries).toEqual([
      '2028-02-29T12:00:00.000Z',
      '2029-02-28T12:00:00.000Z',
      '2030-02-28T12:00:00.000Z',
      '2031-02-28T12:00:00.000Z',
      '2032-02-29T12:00:00.000Z',
    ]);
  });

  it('crosses year boundaries', () => {
    expect(iso(addMonthsClamped(new Date('2026-12-31T23:59:59Z'), 2))).toBe('2027-02-28T23:59:59.000Z');
  });

  it('produces contiguous, strictly increasing periods that never drift from the anchor day', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2090-12-31T00:00:00Z'), noInvalidDate: true }),
        fc.constantFrom('month' as const, 'year' as const),
        fc.integer({ min: 0, max: 120 }),
        (rawAnchor, interval, index) => {
          const anchor = truncateToSecond(rawAnchor);
          const start = periodBoundary(anchor, interval, index);
          const end = periodBoundary(anchor, interval, index + 1);
          expect(end.getTime()).toBeGreaterThan(start.getTime());
          const expectedDay = Math.min(anchor.getUTCDate(), daysInMonth(end.getUTCFullYear(), end.getUTCMonth()));
          expect(end.getUTCDate()).toBe(expectedDay);
          expect(end.getUTCHours()).toBe(anchor.getUTCHours());
          expect(end.getUTCMinutes()).toBe(anchor.getUTCMinutes());
          expect(end.getUTCSeconds()).toBe(anchor.getUTCSeconds());
        },
      ),
    );
  });

  it('counts days per month including leap years', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2100, 1)).toBe(28);
    expect(daysInMonth(2000, 1)).toBe(29);
    expect(daysInMonth(2026, 11)).toBe(31);
  });

  it('formats UTC days', () => {
    expect(utcDay(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
    expect(iso(truncateToSecond(new Date('2026-03-01T23:30:00.987Z')))).toBe('2026-03-01T23:30:00.000Z');
  });
});
