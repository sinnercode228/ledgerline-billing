import { describe, expect, it } from 'vitest';
import { assertInvoiceTransition, cycleLines, formatInvoiceNumber, invoiceAmounts } from '../src/invoice.js';

describe('invoices', () => {
  it('formats gapless numbers per year', () => {
    expect(formatInvoiceNumber(2026, 123)).toBe('LL-2026-000123');
    expect(formatInvoiceNumber(2027, 1)).toBe('LL-2027-000001');
    expect(() => formatInvoiceNumber(2026, 0)).toThrow();
  });

  it('allows only the documented status transitions', () => {
    expect(() => assertInvoiceTransition('draft', 'open')).not.toThrow();
    expect(() => assertInvoiceTransition('open', 'paid')).not.toThrow();
    expect(() => assertInvoiceTransition('open', 'void')).not.toThrow();
    expect(() => assertInvoiceTransition('open', 'uncollectible')).not.toThrow();
    // A payment that lands after the write-off still settles the invoice.
    expect(() => assertInvoiceTransition('uncollectible', 'paid')).not.toThrow();
    expect(() => assertInvoiceTransition('draft', 'paid')).toThrow(/draft -> paid/);
    expect(() => assertInvoiceTransition('paid', 'open')).toThrow();
    expect(() => assertInvoiceTransition('void', 'paid')).toThrow();
  });

  it('applies customer credit up to the total and never below zero', () => {
    const lines = cycleLines({
      plan: { id: 'plan_team', name: 'Team', interval: 'month' },
      price: 299_000,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-02-01T00:00:00Z'),
    });
    expect(invoiceAmounts(lines, 0)).toEqual({ total: 299_000, creditApplied: 0, amountDue: 299_000 });
    expect(invoiceAmounts(lines, 50_000)).toEqual({ total: 299_000, creditApplied: 50_000, amountDue: 249_000 });
    expect(invoiceAmounts(lines, 400_000)).toEqual({ total: 299_000, creditApplied: 299_000, amountDue: 0 });
  });

  it('refuses an invoice with a negative total', () => {
    expect(() =>
      invoiceAmounts(
        [
          {
            kind: 'proration_credit',
            description: 'Unused time on Team',
            amount: -10,
            planId: 'plan_team',
            periodStart: new Date(0),
            periodEnd: new Date(1000),
          },
        ],
        0,
      ),
    ).toThrow(/negative/);
  });
});
