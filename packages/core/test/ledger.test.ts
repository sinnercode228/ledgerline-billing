import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  balancesFromEntries,
  postings,
  receivableAccount,
  revenueAccount,
  reversePosting,
  toJournalTransaction,
  trialBalance,
  type Posting,
} from '../src/ledger.js';

const customerId = 'cus_borealis';
const base = { customerId, currency: 'RUB' as const, subscriptionId: 'sub_1', invoiceId: 'in_1' };
const euroCustomer = { customerId: 'cus_kettle', currency: 'EUR' as const, subscriptionId: 'sub_2', invoiceId: 'in_2' };

function signedByAccount(posting: Posting): Record<string, number> {
  return Object.fromEntries(posting.lines.map((l) => [l.account.id, l.amount]));
}

describe('ledger postings', () => {
  it('debits receivable and credits revenue when an invoice is finalized', () => {
    const posting = postings.invoiceFinalized({ ...base, amount: 299_000, invoiceNumber: 'LL-2026-000001' });
    expect(signedByAccount(posting)).toEqual({ 'receivable:cus_borealis': 299_000, 'revenue:RUB': -299_000 });
    expect(posting.memo).toContain('LL-2026-000001');
  });

  it('builds every posting from the chart of accounts with debit positive, credit negative', () => {
    expect(signedByAccount(postings.paymentSucceeded({ ...base, amount: 100, paymentId: 'pay_1' }))).toEqual({
      'provider_clearing:RUB': 100,
      'receivable:cus_borealis': -100,
    });
    expect(signedByAccount(postings.downgradeCredit({ customerId, currency: 'RUB', subscriptionId: 'sub_1', amount: 70 }))).toEqual({
      'revenue:RUB': 70,
      'customer_credit:cus_borealis': -70,
    });
    expect(signedByAccount(postings.creditApplied({ ...base, amount: 70 }))).toEqual({
      'customer_credit:cus_borealis': 70,
      'receivable:cus_borealis': -70,
    });
    expect(signedByAccount(postings.writeOff({ ...base, amount: 30 }))).toEqual({
      'bad_debt:RUB': 30,
      'receivable:cus_borealis': -30,
    });
    expect(signedByAccount(postings.refund({ ...base, amount: 100, paymentId: 'pay_1' }))).toEqual({
      'revenue:RUB': 100,
      'provider_clearing:RUB': -100,
    });
    expect(signedByAccount(postings.overpaymentCredit({ ...base, amount: 5, paymentId: 'pay_2' }))).toEqual({
      'receivable:cus_borealis': 5,
      'customer_credit:cus_borealis': -5,
    });
  });

  it('rejects unbalanced, one-sided and zero-amount postings', () => {
    const posting = postings.invoiceFinalized({ ...base, amount: 100, invoiceNumber: 'LL-2026-000002' });
    expect(() => assertBalanced({ ...posting, lines: [posting.lines[0]!, { ...posting.lines[1]!, amount: -99 }] })).toThrow(/does not balance/);
    expect(() => assertBalanced({ ...posting, lines: [posting.lines[0]!] })).toThrow(/at least two/);
    expect(() =>
      assertBalanced({
        ...posting,
        lines: [
          { account: receivableAccount(customerId, 'RUB'), amount: 0 },
          { account: revenueAccount('RUB'), amount: 0 },
        ],
      }),
    ).toThrow(/zero/);
  });

  it('rejects mixing currencies in one journal transaction', () => {
    const posting = postings.invoiceFinalized({ ...base, amount: 100, invoiceNumber: 'LL-2026-000003' });
    expect(() =>
      assertBalanced({ ...posting, lines: [posting.lines[0]!, { account: revenueAccount('EUR'), amount: -100 }] }),
    ).toThrow(expect.objectContaining({ code: 'currency_mismatch' }));
    expect(() => postings.paymentSucceeded({ ...base, amount: -5, paymentId: 'pay_1' })).toThrow(/must be positive/);
  });

  it('reverses a posting line by line', () => {
    const writeOff = postings.writeOff({ ...base, amount: 30 });
    const reversal = reversePosting(writeOff, 'jt_writeoff', 'Late payment after write-off');
    expect(signedByAccount(reversal)).toEqual({ 'bad_debt:RUB': -30, 'receivable:cus_borealis': 30 });
    expect(reversal.refs.reversesId).toBe('jt_writeoff');
    expect(reversal.kind).toBe('reversal');
  });

  it('keeps the trial balance at zero for any sequence of postings', () => {
    const builders = [
      (amount: number) => postings.invoiceFinalized({ ...base, amount, invoiceNumber: 'LL-2026-000004' }),
      (amount: number) => postings.paymentSucceeded({ ...base, amount, paymentId: 'pay_1' }),
      (amount: number) => postings.downgradeCredit({ customerId, currency: 'RUB', subscriptionId: 'sub_1', amount }),
      (amount: number) => postings.creditApplied({ ...base, amount }),
      (amount: number) => postings.writeOff({ ...euroCustomer, amount }),
      (amount: number) => postings.refund({ ...euroCustomer, amount, paymentId: 'pay_2' }),
    ];
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat({ max: builders.length - 1 }), fc.integer({ min: 1, max: 10_000_000_000 })), { maxLength: 60 }), (ops) => {
        const transactions = ops.map(([kind, amount], i) => toJournalTransaction(builders[kind]!(amount), `jt_${i}`, new Date(0)));
        const accounts = new Map(ops.flatMap(([kind, amount]) => builders[kind]!(amount).lines.map((l) => [l.account.id, l.account] as const)));
        const result = trialBalance(balancesFromEntries([...accounts.values()], transactions.flatMap((t) => t.entries)));
        expect(result.balanced).toBe(true);
        for (const row of result.currencies) {
          expect(row.debits).toBe(row.credits);
        }
      }),
    );
  });

  it('reports an imbalance instead of hiding it', () => {
    const posting = postings.invoiceFinalized({ ...base, amount: 100, invoiceNumber: 'LL-2026-000005' });
    const balances = balancesFromEntries(
      posting.lines.map((l) => l.account),
      [{ accountId: 'receivable:cus_borealis', amount: 100 }],
    );
    expect(trialBalance(balances)).toMatchObject({ balanced: false, currencies: [{ currency: 'RUB', debits: 100, credits: 0, net: 100 }] });
  });
});
