import { describe, expect, it } from 'vitest';
import { decidePaymentUpdate, paymentIdempotencyKey } from '../src/payments.js';

describe('payment results', () => {
  it('derives the outgoing idempotency key from the invoice and attempt', () => {
    expect(paymentIdempotencyKey('in_7f3a', 1)).toBe('ledgerline:in_7f3a:attempt:1');
    expect(paymentIdempotencyKey('in_7f3a', 2)).not.toBe(paymentIdempotencyKey('in_7f3a', 1));
  });

  it('only moves forward: pending -> failed -> succeeded', () => {
    expect(decidePaymentUpdate('pending', 'succeeded')).toBe('apply');
    expect(decidePaymentUpdate('pending', 'failed')).toBe('apply');
    expect(decidePaymentUpdate('failed', 'succeeded')).toBe('apply');
  });

  it('treats repeats as duplicates and a failure after success as stale', () => {
    expect(decidePaymentUpdate('succeeded', 'succeeded')).toBe('duplicate');
    expect(decidePaymentUpdate('failed', 'failed')).toBe('duplicate');
    expect(decidePaymentUpdate('succeeded', 'failed')).toBe('stale');
  });
});
