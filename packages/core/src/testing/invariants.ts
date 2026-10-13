import { trialBalance } from '../ledger.js';
import type { Invoice } from '../invoice.js';
import { CURRENCIES, sumMinor } from '../money.js';
import type { Payment } from '../payments.js';
import type { BillingWorld } from './world.js';

const outstanding = (invoice: Invoice) => invoice.amountDue - invoice.amountPaid;

/**
 * Everything that must hold between the documents (invoices, payments) and
 * the books at any moment, whatever happened before. Returns one line per
 * broken rule so a failing walk names every problem at once.
 */
export async function findInvariantViolations(
  world: BillingWorld,
  options: { capturedLater?: ReadonlySet<string> } = {},
): Promise<string[]> {
  const problems: string[] = [];
  // One read transaction, so the documents and the books are seen at the same moment.
  const { balances, invoices, subscriptions, customers, payments, journal } = await world.store.run(async (tx) => {
    const invoices = await tx.listInvoices({});
    const payments: Payment[] = [];
    for (const invoice of invoices) payments.push(...(await tx.listPaymentsForInvoice(invoice.id)));
    return {
      balances: await tx.listAccountBalances({}),
      invoices,
      subscriptions: await tx.listSubscriptions({}),
      customers: await tx.listCustomers({}),
      payments,
      journal: await tx.listJournal({}),
    };
  });
  const balanceOf = (id: string) => balances.find((row) => row.account.id === id)?.balance ?? 0;

  const trial = trialBalance(balances);
  if (!trial.balanced) problems.push(`trial balance is off: ${JSON.stringify(trial.currencies)}`);

  for (const invoice of invoices) {
    const label = `invoice ${invoice.number ?? invoice.id}`;
    const lines = sumMinor(invoice.lines.map((line) => line.amount));
    if (lines !== invoice.total) problems.push(`${label}: lines sum to ${lines}, total is ${invoice.total}`);
    if (invoice.amountDue !== invoice.total - invoice.creditApplied) problems.push(`${label}: amount due is not total minus credit`);
    if (invoice.creditApplied < 0 || invoice.creditApplied > invoice.total) problems.push(`${label}: credit applied ${invoice.creditApplied}`);
    if (invoice.amountPaid < 0 || invoice.amountPaid > invoice.amountDue) problems.push(`${label}: amount paid ${invoice.amountPaid}`);
    if (invoice.amountRefunded < 0 || invoice.amountRefunded > invoice.amountPaid) problems.push(`${label}: refunded ${invoice.amountRefunded}`);
    if (invoice.status === 'paid' && outstanding(invoice) !== 0) problems.push(`${label}: paid with ${outstanding(invoice)} outstanding`);
    if (invoice.status === 'open' && outstanding(invoice) <= 0) problems.push(`${label}: open with nothing outstanding`);
    const own = payments.filter((p) => p.invoiceId === invoice.id);
    if (own.filter((p) => p.status === 'pending').length > 1) problems.push(`${label}: more than one payment in flight`);
    if (own.length !== invoice.attemptCount) problems.push(`${label}: ${own.length} payments for ${invoice.attemptCount} attempts`);
  }

  for (const customer of customers) {
    const open = invoices.filter((i) => i.customerId === customer.id && i.status === 'open');
    const owed = sumMinor(open.map(outstanding));
    const receivable = balanceOf(`receivable:${customer.id}`);
    if (receivable !== owed) problems.push(`customer ${customer.name}: receivable ${receivable}, open invoices owe ${owed}`);
    const credit = balanceOf(`customer_credit:${customer.id}`);
    if (credit > 0) problems.push(`customer ${customer.name}: credit account has a debit balance of ${credit}`);
  }

  for (const currency of CURRENCIES) {
    const collected = sumMinor(payments.filter((p) => p.currency === currency && p.status === 'succeeded').map((p) => p.amount));
    const refunded = sumMinor(journal.filter((t) => t.kind === 'refund' && t.currency === currency).map((t) => Math.abs(t.entries[0]!.amount)));
    const clearing = balanceOf(`provider_clearing:${currency}`);
    if (clearing !== collected - refunded) problems.push(`${currency} clearing ${clearing}, payments ${collected} less refunds ${refunded}`);
    const billed = sumMinor(invoices.filter((i) => i.currency === currency && i.status !== 'draft').map((i) => i.total));
    const credited = sumMinor(journal.filter((t) => t.kind === 'downgrade_credit' && t.currency === currency).map((t) => Math.abs(t.entries[0]!.amount)));
    const revenue = -balanceOf(`revenue:${currency}`);
    if (revenue !== billed - credited - refunded) problems.push(`${currency} revenue ${revenue}, billed ${billed} less credits ${credited} and refunds ${refunded}`);
    const writtenOff = sumMinor(invoices.filter((i) => i.currency === currency && i.status === 'uncollectible').map(outstanding));
    const badDebt = balanceOf(`bad_debt:${currency}`);
    if (badDebt !== writtenOff) problems.push(`${currency} bad debt ${badDebt}, uncollectible invoices owe ${writtenOff}`);
  }

  const charged = world.provider.succeededCharges();
  for (const payment of payments.filter((p) => p.status === 'succeeded')) {
    const captured = charged.some((charge) => charge.id === payment.providerPaymentId) || options.capturedLater?.has(payment.providerPaymentId ?? '');
    if (!captured) problems.push(`payment ${payment.id} succeeded without a charge`);
  }
  for (const charge of charged) {
    const local =
      payments.find((p) => p.providerPaymentId === charge.id) ??
      payments.find((p) => p.invoiceId === charge.invoiceId && p.status === 'pending' && p.providerPaymentId === null);
    if (local?.status !== 'succeeded' && local?.status !== 'pending') problems.push(`charge ${charge.id} for ${charge.invoiceId} is not recorded as paid`);
  }

  for (const subscription of subscriptions) {
    const label = `subscription ${subscription.id} (${subscription.status})`;
    const own = invoices.filter((i) => i.subscriptionId === subscription.id);
    const failing = own.filter((i) => i.status === 'open' && i.firstFailedAt !== null);
    if (subscription.status === 'past_due' && failing.length === 0) problems.push(`${label}: past due without a failing invoice`);
    if ((subscription.status === 'active' || subscription.status === 'trialing') && failing.length > 0) {
      problems.push(`${label}: has a failing invoice`);
    }
    if (subscription.status === 'canceled') {
      for (const invoice of own.filter((i) => i.status === 'open')) {
        const inFlight = payments.some((p) => p.invoiceId === invoice.id && p.status === 'pending');
        if (!inFlight) problems.push(`${label}: invoice ${invoice.number} is left open with nothing to settle it`);
      }
    }
    const cycles = own.filter((i) => i.kind === 'cycle').sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
    for (let i = 1; i < cycles.length; i++) {
      if (cycles[i]!.periodStart.getTime() !== cycles[i - 1]!.periodEnd.getTime()) {
        problems.push(`${label}: cycle invoices ${cycles[i - 1]!.number} and ${cycles[i]!.number} do not meet`);
      }
    }
  }
  return problems;
}
