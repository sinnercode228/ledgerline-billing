import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invoiceAmounts } from '../src/invoice.js';
import { prorationAmount, quotePlanChange } from '../src/proration.js';
import { sumMinor } from '../src/money.js';

const periodStart = new Date('2026-03-01T00:00:00Z');
const periodEnd = new Date('2026-04-01T00:00:00Z');
const PERIOD_SECONDS = 31 * 24 * 3600;

const starter = { planId: 'plan_starter', name: 'Starter', price: 99_000 };
const team = { planId: 'plan_team', name: 'Team', price: 299_000 };

describe('proration', () => {
  it('rounds both amounts down from the exact rational value', () => {
    // 10 days left of 31: 99_000 × 10/31 = 31_935.48..., 299_000 × 10/31 = 96_451.61...
    const quote = quotePlanChange({ periodStart, periodEnd, changeAt: new Date('2026-03-22T00:00:00Z'), from: starter, to: team });
    expect(quote.remainingSeconds).toBe(10 * 24 * 3600);
    expect(quote.periodSeconds).toBe(PERIOD_SECONDS);
    expect(quote.credit).toBe(31_935);
    expect(quote.charge).toBe(96_451);
    expect(quote.net).toBe(64_516);
    expect(quote.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['proration_credit', -31_935],
      ['proration_charge', 96_451],
    ]);
    expect(quote.lines.every((l) => l.periodStart.getTime() === quote.changeAt.getTime())).toBe(true);
  });

  it('counts exact seconds and ignores sub-second noise in the change instant', () => {
    const quote = quotePlanChange({ periodStart, periodEnd, changeAt: new Date('2026-03-31T23:59:59.900Z'), from: starter, to: team });
    expect(quote.remainingSeconds).toBe(1);
    expect(quote.credit).toBe(Math.floor((99_000 * 1) / PERIOD_SECONDS));
  });

  it('turns a downgrade into a negative net amount', () => {
    const quote = quotePlanChange({ periodStart, periodEnd, changeAt: new Date('2026-03-16T12:00:00Z'), from: team, to: starter });
    expect(quote.net).toBeLessThan(0);
    expect(quote.net).toBe(quote.charge - quote.credit);
  });

  it('rejects a change outside the current period', () => {
    expect(() => quotePlanChange({ periodStart, periodEnd, changeAt: periodEnd, from: starter, to: team })).toThrow(/inside the current period/);
    expect(() =>
      quotePlanChange({ periodStart, periodEnd, changeAt: new Date('2026-02-28T00:00:00Z'), from: starter, to: team }),
    ).toThrow(/inside the current period/);
  });

  const price = fc.integer({ min: 0, max: 50_000_000_000 });
  const periodSeconds = fc.integer({ min: 28 * 86_400, max: 366 * 86_400 });

  it('prorates a full period to exactly the full price', () => {
    fc.assert(
      fc.property(price, price, periodSeconds, (oldPrice, newPrice, seconds) => {
        const start = new Date('2027-01-01T00:00:00Z');
        const end = new Date(start.getTime() + seconds * 1000);
        const quote = quotePlanChange({
          periodStart: start,
          periodEnd: end,
          changeAt: start,
          from: { ...starter, price: oldPrice },
          to: { ...team, price: newPrice },
        });
        expect(quote.credit).toBe(oldPrice);
        expect(quote.charge).toBe(newPrice);
      }),
    );
  });

  it('never credits more than the price and shrinks the credit as the period runs out', () => {
    fc.assert(
      fc.property(price, periodSeconds, fc.nat(), fc.nat(), (p, seconds, a, b) => {
        const early = Math.min(a, b) % (seconds + 1);
        const late = Math.max(a, b) % (seconds + 1);
        const remainingEarly = seconds - Math.min(early, late);
        const remainingLate = seconds - Math.max(early, late);
        const creditEarly = prorationAmount(p, remainingEarly, seconds);
        const creditLate = prorationAmount(p, remainingLate, seconds);
        expect(creditEarly).toBeLessThanOrEqual(p);
        expect(creditLate).toBeLessThanOrEqual(creditEarly);
        expect(creditLate).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('never credits more than was paid for the period, across any sequence of plan changes', () => {
    fc.assert(
      fc.property(
        periodSeconds,
        fc.array(price, { minLength: 2, maxLength: 8 }),
        fc.array(fc.nat(), { minLength: 7, maxLength: 7 }),
        (seconds, prices, rawOffsets) => {
          const start = new Date('2027-05-31T08:00:00Z');
          const end = new Date(start.getTime() + seconds * 1000);
          const offsets = rawOffsets
            .slice(0, prices.length - 1)
            .map((o) => o % seconds)
            .sort((x, y) => x - y);

          let paidForPeriod = prices[0]!;
          for (let i = 1; i < prices.length; i++) {
            const quote = quotePlanChange({
              periodStart: start,
              periodEnd: end,
              changeAt: new Date(start.getTime() + offsets[i - 1]! * 1000),
              from: { ...starter, price: prices[i - 1]! },
              to: { ...team, price: prices[i]! },
            });
            expect(quote.credit).toBeLessThanOrEqual(paidForPeriod);
            paidForPeriod += quote.net;
            expect(paidForPeriod).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it('builds invoices whose lines always sum to the total', () => {
    fc.assert(
      fc.property(price, price, periodSeconds, fc.nat(), fc.integer({ min: 0, max: 50_000_000_000 }), (from, to, seconds, offset, credit) => {
        const start = new Date('2027-01-31T00:00:00Z');
        const end = new Date(start.getTime() + seconds * 1000);
        const quote = quotePlanChange({
          periodStart: start,
          periodEnd: end,
          changeAt: new Date(start.getTime() + (offset % seconds) * 1000),
          from: { ...starter, price: from },
          to: { ...team, price: to },
        });
        fc.pre(quote.net > 0);
        const amounts = invoiceAmounts(quote.lines, credit);
        expect(amounts.total).toBe(sumMinor(quote.lines.map((l) => l.amount)));
        expect(amounts.total).toBe(quote.net);
        expect(amounts.creditApplied).toBe(Math.min(credit, amounts.total));
        expect(amounts.amountDue).toBe(amounts.total - amounts.creditApplied);
        expect(amounts.amountDue).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
