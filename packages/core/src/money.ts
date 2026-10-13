import { BillingError } from './errors.js';

/**
 * Amounts are integers in minor units (kopecks, cents) stored in `number`.
 * Every amount entering the core is checked to be a safe integer; products
 * that could pass 2^53 (price × seconds in proration) are computed in bigint.
 */
export const CURRENCIES = ['RUB', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

export function assertMinorUnits(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new BillingError('invalid_amount', `${label} must be a whole number of minor units, got ${value}`);
  }
  return value;
}

export function assertNonNegativeMinorUnits(value: number, label = 'amount'): number {
  assertMinorUnits(value, label);
  if (value < 0) {
    throw new BillingError('invalid_amount', `${label} must not be negative, got ${value}`);
  }
  return value;
}

export function sumMinor(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += assertMinorUnits(value);
    if (!Number.isSafeInteger(total)) {
      throw new BillingError('invalid_amount', 'sum left the safe integer range');
    }
  }
  return total;
}

/** floor(value × numerator / denominator) for non-negative inputs, exact for any safe integers. */
export function mulDivFloor(value: number, numerator: number, denominator: number): number {
  assertNonNegativeMinorUnits(value, 'value');
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new BillingError('invalid_argument', `numerator must be a non-negative integer, got ${numerator}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new BillingError('invalid_argument', `denominator must be a positive integer, got ${denominator}`);
  }
  return Number((BigInt(value) * BigInt(numerator)) / BigInt(denominator));
}

/** Negation that never produces -0, which would otherwise leak into equality checks and JSON. */
export function negate(amount: number): number {
  return amount === 0 ? 0 : -amount;
}

export function formatMoney(amount: number, currency: Currency): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(assertMinorUnits(amount));
  const major = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `${sign}${major}.${minor} ${currency}`;
}
