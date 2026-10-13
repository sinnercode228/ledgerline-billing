import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertMinorUnits, formatMoney, isCurrency, mulDivFloor, sumMinor } from '../src/money.js';

describe('money', () => {
  it('accepts only safe integers as minor units', () => {
    expect(assertMinorUnits(99_000)).toBe(99_000);
    expect(() => assertMinorUnits(1.5)).toThrow(/whole number of minor units/);
    expect(() => assertMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow(/whole number of minor units/);
    expect(() => assertMinorUnits(Number.NaN)).toThrow();
  });

  it('refuses sums that leave the safe integer range', () => {
    expect(sumMinor([1, 2, -3])).toBe(0);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(/safe integer/);
  });

  it('multiplies before dividing without losing precision', () => {
    // 9_007_199_254 * 31_622_400 overflows 2^53, the bigint path does not.
    expect(mulDivFloor(9_007_199_254, 31_622_399, 31_622_400)).toBe(9_007_198_969);
    expect(mulDivFloor(1000, 1, 3)).toBe(333);
    expect(mulDivFloor(1000, 0, 3)).toBe(0);
    expect(() => mulDivFloor(-1, 1, 2)).toThrow();
    expect(() => mulDivFloor(1, 1, 0)).toThrow();
  });

  it('floors exactly like the rational value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 1, max: 40_000_000 }),
        fc.integer({ min: 0, max: 40_000_000 }),
        (value, denominator, rawNumerator) => {
          const numerator = rawNumerator % (denominator + 1);
          const expected = (BigInt(value) * BigInt(numerator)) / BigInt(denominator);
          expect(BigInt(mulDivFloor(value, numerator, denominator))).toBe(expected);
        },
      ),
    );
  });

  it('knows the supported currencies', () => {
    expect(isCurrency('RUB')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('USD')).toBe(false);
  });

  it('formats minor units for humans', () => {
    expect(formatMoney(99_000, 'RUB')).toBe('990.00 RUB');
    expect(formatMoney(-5, 'EUR')).toBe('-0.05 EUR');
  });
});
