import type { Customer } from './customer.js';
import type { Invoice } from './invoice.js';
import { trialBalance, type AccountBalance, type JournalTransaction } from './ledger.js';
import { CURRENCIES, sumMinor, type Currency } from './money.js';
import type { Payment } from './payments.js';
import type { Store, StoreTx } from './ports/store.js';
import type { Subscription } from './subscription.js';

export type ReconcileRule =
  | 'trial_balance'
  | 'invoice_amounts'
  | 'invoice_status'
  | 'invoice_payments'
  | 'receivable'
  | 'customer_credit'
  | 'provider_clearing'
  | 'revenue'
  | 'bad_debt'
  | 'subscription_status'
  | 'subscription_periods';

export interface Violation {
  rule: ReconcileRule;
  message: string;
}

/** The documents and the books, as one snapshot shows them. */
export interface Books {
  customers: Customer[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  payments: Payment[];
  balances: AccountBalance[];
  /** Of the journal, only the two kinds of transaction the rules add up. */
  refunds: JournalTransaction[];
  downgradeCredits: JournalTransaction[];
}

export interface ReconcileReport {
  checked: { customers: number; subscriptions: number; invoices: number; payments: number; accounts: number };
  violations: Violation[];
}

/** Seven reads; account balances are summed by the store, so the journal itself is not loaded. */
export async function readBooks(tx: StoreTx): Promise<Books> {
  return {
    customers: await tx.listCustomers({}),
    subscriptions: await tx.listSubscriptions({}),
    invoices: await tx.listInvoices({}),
    payments: await tx.listPayments({}),
    balances: await tx.listAccountBalances({}),
    refunds: await tx.listJournal({ kind: 'refund' }),
    downgradeCredits: await tx.listJournal({ kind: 'downgrade_credit' }),
  };
}

/** Reads the books in one read-only snapshot and compares them with the documents. */
export async function reconcile(store: Store): Promise<ReconcileReport> {
  const books = await store.run(readBooks, { readOnly: true });
  return {
    checked: {
      customers: books.customers.length,
      subscriptions: books.subscriptions.length,
      invoices: books.invoices.length,
      payments: books.payments.length,
      accounts: books.balances.length,
    },
    violations: checkBooks(books),
  };
}

const outstanding = (invoice: Invoice) => invoice.amountDue - invoice.amountPaid;

function groupBy<T>(rows: readonly T[], key: (row: T) => string): (id: string) => T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return (id) => groups.get(id) ?? [];
}

const postedAmount = (transactions: readonly JournalTransaction[], currency: Currency) =>
  sumMinor(transactions.filter((t) => t.currency === currency).map((t) => Math.abs(t.entries[0]!.amount)));

/**
 * Everything that must hold between the documents (invoices, payments) and
 * the books at any moment, whatever happened before. A trial balance of zero
 * only proves that every posting balances; these rules check that each
 * posting should exist. Returns one violation per broken rule, so a report
 * names every problem at once.
 */
export function checkBooks(books: Books): Violation[] {
  const { customers, subscriptions, invoices, payments, balances } = books;
  const violations: Violation[] = [];
  const report = (rule: ReconcileRule, message: string) => violations.push({ rule, message });
  const balanceById = new Map(balances.map((row) => [row.account.id, row.balance]));
  const balanceOf = (id: string) => balanceById.get(id) ?? 0;
  const paymentsOf = groupBy(payments, (p) => p.invoiceId);
  const invoicesOfCustomer = groupBy(invoices, (i) => i.customerId);
  const invoicesOfSubscription = groupBy(invoices, (i) => i.subscriptionId);

  const trial = trialBalance(balances);
  if (!trial.balanced) report('trial_balance', `trial balance is off: ${JSON.stringify(trial.currencies)}`);

  for (const invoice of invoices) {
    const label = `invoice ${invoice.number ?? invoice.id}`;
    const lines = sumMinor(invoice.lines.map((line) => line.amount));
    if (lines !== invoice.total) report('invoice_amounts', `${label}: lines sum to ${lines}, total is ${invoice.total}`);
    if (invoice.amountDue !== invoice.total - invoice.creditApplied) report('invoice_amounts', `${label}: amount due is not total minus credit`);
    if (invoice.creditApplied < 0 || invoice.creditApplied > invoice.total) report('invoice_amounts', `${label}: credit applied ${invoice.creditApplied}`);
    if (invoice.amountPaid < 0 || invoice.amountPaid > invoice.amountDue) report('invoice_amounts', `${label}: amount paid ${invoice.amountPaid}`);
    if (invoice.amountRefunded < 0 || invoice.amountRefunded > invoice.amountPaid) report('invoice_amounts', `${label}: refunded ${invoice.amountRefunded}`);
    if (invoice.status === 'paid' && outstanding(invoice) !== 0) report('invoice_status', `${label}: paid with ${outstanding(invoice)} outstanding`);
    if (invoice.status === 'open' && outstanding(invoice) <= 0) report('invoice_status', `${label}: open with nothing outstanding`);
    const own = paymentsOf(invoice.id);
    if (own.filter((p) => p.status === 'pending').length > 1) report('invoice_payments', `${label}: more than one payment in flight`);
    if (own.length !== invoice.attemptCount) report('invoice_payments', `${label}: ${own.length} payments for ${invoice.attemptCount} attempts`);
  }

  for (const customer of customers) {
    const open = invoicesOfCustomer(customer.id).filter((i) => i.status === 'open');
    const owed = sumMinor(open.map(outstanding));
    const receivable = balanceOf(`receivable:${customer.id}`);
    if (receivable !== owed) report('receivable', `customer ${customer.name}: receivable ${receivable}, open invoices owe ${owed}`);
    const credit = balanceOf(`customer_credit:${customer.id}`);
    if (credit > 0) report('customer_credit', `customer ${customer.name}: credit account has a debit balance of ${credit}`);
  }

  for (const currency of CURRENCIES) {
    const collected = sumMinor(payments.filter((p) => p.currency === currency && p.status === 'succeeded').map((p) => p.amount));
    const refunded = postedAmount(books.refunds, currency);
    const clearing = balanceOf(`provider_clearing:${currency}`);
    if (clearing !== collected - refunded) report('provider_clearing', `${currency} clearing ${clearing}, payments ${collected} less refunds ${refunded}`);
    const billed = sumMinor(invoices.filter((i) => i.currency === currency && i.status !== 'draft').map((i) => i.total));
    const credited = postedAmount(books.downgradeCredits, currency);
    const revenue = -balanceOf(`revenue:${currency}`);
    if (revenue !== billed - credited - refunded) {
      report('revenue', `${currency} revenue ${revenue}, billed ${billed} less credits ${credited} and refunds ${refunded}`);
    }
    const writtenOff = sumMinor(invoices.filter((i) => i.currency === currency && i.status === 'uncollectible').map(outstanding));
    const badDebt = balanceOf(`bad_debt:${currency}`);
    if (badDebt !== writtenOff) report('bad_debt', `${currency} bad debt ${badDebt}, uncollectible invoices owe ${writtenOff}`);
  }

  for (const subscription of subscriptions) {
    const label = `subscription ${subscription.id} (${subscription.status})`;
    const own = invoicesOfSubscription(subscription.id);
    const failing = own.filter((i) => i.status === 'open' && i.firstFailedAt !== null);
    if (subscription.status === 'past_due' && failing.length === 0) report('subscription_status', `${label}: past due without a failing invoice`);
    if ((subscription.status === 'active' || subscription.status === 'trialing') && failing.length > 0) {
      report('subscription_status', `${label}: has a failing invoice`);
    }
    if (subscription.status === 'canceled') {
      for (const invoice of own.filter((i) => i.status === 'open')) {
        const inFlight = paymentsOf(invoice.id).some((p) => p.status === 'pending');
        if (!inFlight) report('subscription_status', `${label}: invoice ${invoice.number} is left open with nothing to settle it`);
      }
    }
    const cycles = own.filter((i) => i.kind === 'cycle').sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
    for (let i = 1; i < cycles.length; i++) {
      if (cycles[i]!.periodStart.getTime() !== cycles[i - 1]!.periodEnd.getTime()) {
        report('subscription_periods', `${label}: cycle invoices ${cycles[i - 1]!.number} and ${cycles[i]!.number} do not meet`);
      }
    }
  }
  return violations;
}
