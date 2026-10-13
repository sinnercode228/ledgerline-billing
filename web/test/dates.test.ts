import { describe, expect, it } from 'vitest';
import { formatDate, formatPeriod } from '../src/format/dates';

// Intl puts thin and narrow no-break spaces around range dashes and before "г."; compare with plain spaces.
const plain = (text: string) => text.replace(/[\u2009\u202f\u00a0]/g, ' ');

describe('formatPeriod', () => {
  it('names the shared month and year once', () => {
    expect(plain(formatPeriod('2026-11-10T00:00:00Z', '2026-11-25T00:00:00Z', 'en'))).toBe('10 – 25 Nov 2026');
    expect(plain(formatPeriod('2026-10-30T09:00:00Z', '2026-11-30T09:00:00Z', 'en'))).toBe('30 Oct – 30 Nov 2026');
    expect(plain(formatPeriod('2026-10-30T09:00:00Z', '2026-11-30T09:00:00Z', 'ru'))).toBe('30 окт. – 30 нояб. 2026 г.');
  });

  it('keeps both years when the period crosses one', () => {
    expect(plain(formatPeriod('2026-12-15T00:00:00Z', '2027-01-15T00:00:00Z', 'en'))).toBe('15 Dec 2026 – 15 Jan 2027');
    expect(plain(formatPeriod('2026-04-01T00:00:00Z', '2027-04-01T00:00:00Z', 'ru'))).toBe('1 апр. 2026 г. – 1 апр. 2027 г.');
  });

  it('reads billing days in UTC, like the engine', () => {
    expect(plain(formatPeriod('2026-01-31T23:30:00Z', '2026-02-28T23:30:00Z', 'en'))).toBe('31 Jan – 28 Feb 2026');
    expect(formatDate('2026-01-31T23:30:00Z', 'date', 'en')).toBe('31 Jan 2026');
  });
});
