import type { BillingInterval } from './calendar.js';
import { BillingError } from './errors.js';
import { assertNonNegativeMinorUnits, sumMinor, type Currency } from './money.js';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
export type InvoiceKind = 'cycle' | 'proration';
export type InvoiceLineKind = 'plan' | 'proration_credit' | 'proration_charge';

export interface InvoiceLine {
  kind: InvoiceLineKind;
  description: string;
  /** Signed minor units: credits are negative. */
  amount: number;
  planId: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface Invoice {
  id: string;
  /** Assigned at finalization from the per-year counter; null while draft. */
  number: string | null;
  customerId: string;
  subscriptionId: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  currency: Currency;
  /** Together with subscriptionId and kind this is unique: a period is never billed twice. */
  periodStart: Date;
  periodEnd: Date;
  lines: InvoiceLine[];
  total: number;
  creditApplied: number;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  attemptCount: number;
  firstFailedAt: Date | null;
  nextRetryAt: Date | null;
  /** How many retries from the dunning schedule have been started. */
  scheduledRetries: number;
  createdAt: Date;
  finalizedAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  uncollectibleAt: Date | null;
}

const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['open'],
  open: ['paid', 'void', 'uncollectible'],
  paid: [],
  void: [],
  // A payment that succeeds after the write-off still settles the invoice.
  uncollectible: ['paid'],
};

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BillingError('invalid_transition', `invoice cannot move ${from} -> ${to}`, { from, to });
  }
}

export function formatInvoiceNumber(year: number, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new BillingError('invalid_argument', `invoice sequence must be a positive integer, got ${sequence}`);
  }
  return `LL-${year}-${String(sequence).padStart(6, '0')}`;
}

export interface InvoiceAmounts {
  total: number;
  creditApplied: number;
  amountDue: number;
}

/** Total is the sum of the lines; available customer credit reduces what is due, never below zero. */
export function invoiceAmounts(lines: readonly InvoiceLine[], availableCredit: number): InvoiceAmounts {
  const total = sumMinor(lines.map((line) => line.amount));
  if (total < 0) {
    throw new BillingError('invalid_amount', `invoice total must not be negative, got ${total}`);
  }
  assertNonNegativeMinorUnits(availableCredit, 'available credit');
  const creditApplied = Math.min(total, availableCredit);
  return { total, creditApplied, amountDue: total - creditApplied };
}

export function cycleLines(input: {
  plan: { id: string; name: string; interval: BillingInterval };
  price: number;
  periodStart: Date;
  periodEnd: Date;
}): InvoiceLine[] {
  return [
    {
      kind: 'plan',
      description: `${input.plan.name}, billed ${input.plan.interval === 'month' ? 'monthly' : 'yearly'}`,
      amount: assertNonNegativeMinorUnits(input.price, 'price'),
      planId: input.plan.id,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
  ];
}
