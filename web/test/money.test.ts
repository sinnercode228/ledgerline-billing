import { describe, expect, it } from 'vitest';
import { formatMoney, formatMinorUnits } from '../src/format/money';

// Intl separates groups with narrow no-break spaces in Russian; compare with plain spaces.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('turns minor units into the locale format with the currency symbol', () => {
    expect(formatMoney(299_000, 'RUB', 'en')).toBe('₽2,990.00');
    expect(plain(formatMoney(299_000, 'RUB', 'ru'))).toBe('2 990,00 ₽');
    expect(formatMoney(2_900, 'EUR', 'en')).toBe('€29.00');
    expect(plain(formatMoney(2_900, 'EUR', 'ru'))).toBe('29,00 €');
  });

  it('keeps every kopeck and cent, including single ones and negatives', () => {
    expect(formatMoney(1, 'EUR', 'en')).toBe('€0.01');
    expect(formatMoney(-675, 'EUR', 'en')).toBe('-€6.75');
    expect(plain(formatMoney(-675, 'EUR', 'ru'))).toBe('-6,75 €');
    expect(formatMoney(0, 'RUB', 'en')).toBe('₽0.00');
  });

  it('is exact for amounts beyond what a float holds after dividing by 100', () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER, 'EUR', 'en')).toBe('€90,071,992,547,409.91');
    expect(formatMoney(-Number.MAX_SAFE_INTEGER, 'EUR', 'en')).toBe('-€90,071,992,547,409.91');
  });

  it('can leave the symbol out for columns that already name the currency', () => {
    expect(formatMinorUnits(123_456_789, 'en')).toBe('1,234,567.89');
    expect(plain(formatMinorUnits(-5, 'ru'))).toBe('-0,05');
  });

  it('refuses amounts that are not whole minor units', () => {
    expect(() => formatMoney(10.5, 'EUR', 'en')).toThrow(/minor units/);
  });
});
