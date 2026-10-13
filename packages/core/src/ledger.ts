import { BillingError } from './errors.js';
import { assertMinorUnits, CURRENCIES, negate, sumMinor, type Currency } from './money.js';

export type AccountKind = 'accounts_receivable' | 'customer_credit' | 'revenue' | 'provider_clearing' | 'bad_debt';

export interface LedgerAccount {
  id: string;
  kind: AccountKind;
  currency: Currency;
  customerId: string | null;
  name: string;
}

export function receivableAccount(customerId: string, currency: Currency): LedgerAccount {
  return { id: `receivable:${customerId}`, kind: 'accounts_receivable', currency, customerId, name: 'Accounts receivable' };
}

export function customerCreditAccount(customerId: string, currency: Currency): LedgerAccount {
  return { id: `customer_credit:${customerId}`, kind: 'customer_credit', currency, customerId, name: 'Customer credit' };
}

export function revenueAccount(currency: Currency): LedgerAccount {
  return { id: `revenue:${currency}`, kind: 'revenue', currency, customerId: null, name: `Subscription revenue (${currency})` };
}

export function clearingAccount(currency: Currency): LedgerAccount {
  return { id: `provider_clearing:${currency}`, kind: 'provider_clearing', currency, customerId: null, name: `Payrail clearing (${currency})` };
}

export function badDebtAccount(currency: Currency): LedgerAccount {
  return { id: `bad_debt:${currency}`, kind: 'bad_debt', currency, customerId: null, name: `Bad debt expense (${currency})` };
}

export type PostingKind =
  | 'invoice_finalized'
  | 'payment_succeeded'
  | 'downgrade_credit'
  | 'credit_applied'
  | 'write_off'
  | 'refund'
  | 'overpayment_credit'
  | 'reversal';

export interface PostingRefs {
  customerId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  reversesId: string | null;
}

/** Signed amounts: a debit is positive, a credit is negative. */
export interface PostingLine {
  account: LedgerAccount;
  amount: number;
}

export interface Posting {
  kind: PostingKind;
  currency: Currency;
  memo: string;
  refs: PostingRefs;
  lines: PostingLine[];
}

export interface JournalEntry {
  accountId: string;
  amount: number;
}

export interface JournalTransaction {
  id: string;
  kind: PostingKind;
  currency: Currency;
  memo: string;
  refs: PostingRefs;
  postedAt: Date;
  entries: JournalEntry[];
}

export function assertBalanced(posting: Posting): Posting {
  if (posting.lines.length < 2) {
    throw new BillingError('unbalanced_transaction', 'a journal transaction needs at least two entries');
  }
  for (const line of posting.lines) {
    assertMinorUnits(line.amount, `entry on ${line.account.id}`);
    if (line.amount === 0) {
      throw new BillingError('invalid_amount', `entry on ${line.account.id} is zero`);
    }
    if (line.account.currency !== posting.currency) {
      throw new BillingError(
        'currency_mismatch',
        `account ${line.account.id} is in ${line.account.currency}, transaction is in ${posting.currency}`,
      );
    }
  }
  const imbalance = sumMinor(posting.lines.map((line) => line.amount));
  if (imbalance !== 0) {
    throw new BillingError('unbalanced_transaction', `journal transaction does not balance: off by ${imbalance}`);
  }
  return posting;
}

interface PostingInput {
  customerId: string;
  currency: Currency;
  amount: number;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
}

function transfer(
  kind: PostingKind,
  input: PostingInput,
  debit: LedgerAccount,
  credit: LedgerAccount,
  memo: string,
): Posting {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new BillingError('invalid_amount', `${kind} amount must be positive, got ${input.amount}`);
  }
  return assertBalanced({
    kind,
    currency: input.currency,
    memo,
    refs: {
      customerId: input.customerId,
      subscriptionId: input.subscriptionId ?? null,
      invoiceId: input.invoiceId ?? null,
      paymentId: input.paymentId ?? null,
      reversesId: null,
    },
    lines: [
      { account: debit, amount: input.amount },
      { account: credit, amount: -input.amount },
    ],
  });
}

export const postings = {
  invoiceFinalized: (input: PostingInput & { invoiceNumber: string }) =>
    transfer(
      'invoice_finalized',
      input,
      receivableAccount(input.customerId, input.currency),
      revenueAccount(input.currency),
      `Invoice ${input.invoiceNumber} finalized`,
    ),
  paymentSucceeded: (input: PostingInput) =>
    transfer(
      'payment_succeeded',
      input,
      clearingAccount(input.currency),
      receivableAccount(input.customerId, input.currency),
      'Payment received through Payrail',
    ),
  downgradeCredit: (input: PostingInput) =>
    transfer(
      'downgrade_credit',
      input,
      revenueAccount(input.currency),
      customerCreditAccount(input.customerId, input.currency),
      'Credit for unused time after a downgrade',
    ),
  creditApplied: (input: PostingInput) =>
    transfer(
      'credit_applied',
      input,
      customerCreditAccount(input.customerId, input.currency),
      receivableAccount(input.customerId, input.currency),
      'Customer credit applied to invoice',
    ),
  writeOff: (input: PostingInput) =>
    transfer(
      'write_off',
      input,
      badDebtAccount(input.currency),
      receivableAccount(input.customerId, input.currency),
      'Uncollectible invoice written off',
    ),
  refund: (input: PostingInput) =>
    transfer('refund', input, revenueAccount(input.currency), clearingAccount(input.currency), 'Payment refunded'),
  overpaymentCredit: (input: PostingInput) =>
    transfer(
      'overpayment_credit',
      input,
      receivableAccount(input.customerId, input.currency),
      customerCreditAccount(input.customerId, input.currency),
      'Payment for an already settled invoice kept as customer credit',
    ),
};

/** Corrections never edit entries: they post the mirror image of the original. */
export function reversePosting(original: Posting, originalId: string, memo: string): Posting {
  return assertBalanced({
    kind: 'reversal',
    currency: original.currency,
    memo,
    refs: { ...original.refs, reversesId: originalId },
    lines: original.lines.map((line) => ({ account: line.account, amount: negate(line.amount) })),
  });
}

export function toJournalTransaction(posting: Posting, id: string, postedAt: Date): JournalTransaction {
  assertBalanced(posting);
  return {
    id,
    kind: posting.kind,
    currency: posting.currency,
    memo: posting.memo,
    refs: posting.refs,
    postedAt,
    entries: posting.lines.map((line) => ({ accountId: line.account.id, amount: line.amount })),
  };
}

export interface AccountBalance {
  account: LedgerAccount;
  /** Sum of debit entries, as a positive number. */
  debits: number;
  /** Sum of credit entries, as a positive number. */
  credits: number;
  /** debits - credits. */
  balance: number;
}

export function balancesFromEntries(accounts: readonly LedgerAccount[], entries: readonly JournalEntry[]): AccountBalance[] {
  const byId = new Map(accounts.map((account) => [account.id, { account, debits: 0, credits: 0, balance: 0 }]));
  for (const entry of entries) {
    const row = byId.get(entry.accountId);
    if (!row) {
      throw new BillingError('not_found', `entry references unknown account ${entry.accountId}`);
    }
    if (entry.amount > 0) row.debits += entry.amount;
    else row.credits -= entry.amount;
    row.balance += entry.amount;
  }
  return [...byId.values()];
}

export interface TrialBalanceRow {
  currency: Currency;
  debits: number;
  credits: number;
  net: number;
}

export interface TrialBalance {
  balanced: boolean;
  currencies: TrialBalanceRow[];
}

export function trialBalance(balances: readonly AccountBalance[]): TrialBalance {
  const currencies = CURRENCIES.map((currency) => {
    const rows = balances.filter((b) => b.account.currency === currency);
    const debits = sumMinor(rows.map((r) => r.debits));
    const credits = sumMinor(rows.map((r) => r.credits));
    return { currency, debits, credits, net: debits - credits };
  }).filter((row) => row.debits !== 0 || row.credits !== 0);
  return { balanced: currencies.every((row) => row.net === 0), currencies };
}
