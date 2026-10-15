import type { Customer } from '../customer.js';
import type { IdGenerator } from '../ids.js';
import {
  assertInvoiceTransition,
  formatInvoiceNumber,
  invoiceAmounts,
  type Invoice,
  type InvoiceKind,
  type InvoiceLine,
} from '../invoice.js';
import { postings } from '../ledger.js';
import { sumMinor } from '../money.js';
import type { StoreTx } from '../ports/store.js';
import type { Subscription } from '../subscription.js';
import { availableCredit, post } from './ledger-ops.js';

export function draftInvoice(input: {
  id: string;
  subscription: Subscription;
  kind: InvoiceKind;
  periodStart: Date;
  periodEnd: Date;
  lines: InvoiceLine[];
  now: Date;
}): Invoice {
  const total = sumMinor(input.lines.map((line) => line.amount));
  return {
    id: input.id,
    number: null,
    customerId: input.subscription.customerId,
    subscriptionId: input.subscription.id,
    kind: input.kind,
    status: 'draft',
    currency: input.subscription.currency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    lines: input.lines,
    total,
    creditApplied: 0,
    amountDue: total,
    amountPaid: 0,
    amountRefunded: 0,
    attemptCount: 0,
    firstFailedAt: null,
    nextRetryAt: null,
    scheduledRetries: 0,
    createdAt: input.now,
    finalizedAt: null,
    paidAt: null,
    voidedAt: null,
    uncollectibleAt: null,
  };
}

/**
 * Numbers the invoice from the per-year counter, books it and spends any
 * customer credit, all inside the caller's transaction. The caller must hold
 * the customer lock so two invoices cannot spend the same credit.
 */
export async function finalizeInvoice(tx: StoreTx, invoice: Invoice, customer: Customer, now: Date, ids: IdGenerator): Promise<Invoice> {
  assertInvoiceTransition(invoice.status, 'open');
  const year = now.getUTCFullYear();
  const number = formatInvoiceNumber(year, await tx.nextInvoiceSequence(year));
  const amounts = invoiceAmounts(invoice.lines, await availableCredit(tx, customer));
  const refs = { customerId: customer.id, currency: invoice.currency, subscriptionId: invoice.subscriptionId, invoiceId: invoice.id };

  if (amounts.total > 0) {
    await post(tx, postings.invoiceFinalized({ ...refs, amount: amounts.total, invoiceNumber: number }), now, ids);
  }
  if (amounts.creditApplied > 0) {
    await post(tx, postings.creditApplied({ ...refs, amount: amounts.creditApplied }), now, ids);
  }

  const open: Invoice = { ...invoice, ...amounts, number, status: 'open', finalizedAt: now };
  await tx.updateInvoice(open);
  if (amounts.amountDue > 0) return open;
  // Credit covers all of it. Both stores let an invoice become paid only from open, so it is saved open first.
  const paid: Invoice = { ...open, status: 'paid', paidAt: now };
  await tx.updateInvoice(paid);
  return paid;
}

export async function issueInvoice(
  tx: StoreTx,
  customer: Customer,
  ids: IdGenerator,
  input: Omit<Parameters<typeof draftInvoice>[0], 'id'>,
): Promise<Invoice> {
  const draft = draftInvoice({ ...input, id: ids('in') });
  await tx.insertInvoice(draft);
  return finalizeInvoice(tx, draft, customer, input.now, ids);
}

export function outstanding(invoice: Invoice): number {
  return invoice.amountDue - invoice.amountPaid;
}
