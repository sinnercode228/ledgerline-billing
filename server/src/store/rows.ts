import {
  isCurrency,
  type AccountKind,
  type Currency,
  type Customer,
  type Invoice,
  type InvoiceKind,
  type InvoiceLine,
  type InvoiceLineKind,
  type InvoiceStatus,
  type JournalTransaction,
  type LedgerAccount,
  type Payment,
  type PaymentStatus,
  type PaymentTrigger,
  type PaymentMethod,
  type PostingKind,
  type Subscription,
  type SubscriptionStatus,
  type WebhookEventRecord,
  type WebhookOutcome,
} from '@ledgerline/core';

/** pg returns bigint and numeric as strings; amounts must stay exact, so anything past 2^53 is an error, not a rounding. */
export function toSafeInteger(value: string | number, column: string): number {
  const number = typeof value === 'number' ? value : /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${column} value ${value} is not a safe integer`);
  }
  return number;
}

export function toCurrency(value: string): Currency {
  if (!isCurrency(value)) throw new Error(`unexpected currency ${value}`);
  return value;
}

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  currency: string;
  default_payment_method_id: string | null;
  created_at: Date;
}

export const toCustomer = (row: CustomerRow): Customer => ({
  id: row.id,
  name: row.name,
  email: row.email,
  currency: toCurrency(row.currency),
  defaultPaymentMethodId: row.default_payment_method_id,
  createdAt: row.created_at,
});

export interface PaymentMethodRow {
  id: string;
  customer_id: string;
  provider_token: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  created_at: Date;
}

export const toPaymentMethod = (row: PaymentMethodRow): PaymentMethod => ({
  id: row.id,
  customerId: row.customer_id,
  providerToken: row.provider_token,
  brand: row.brand,
  last4: row.last4,
  expMonth: row.exp_month,
  expYear: row.exp_year,
  createdAt: row.created_at,
});

export interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan_id: string;
  currency: string;
  status: SubscriptionStatus;
  billing_anchor: Date;
  paid_cycles: number;
  current_period_start: Date;
  current_period_end: Date;
  trial_end: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const toSubscription = (row: SubscriptionRow): Subscription => ({
  id: row.id,
  customerId: row.customer_id,
  planId: row.plan_id,
  currency: toCurrency(row.currency),
  status: row.status,
  billingAnchor: row.billing_anchor,
  paidCycles: row.paid_cycles,
  currentPeriodStart: row.current_period_start,
  currentPeriodEnd: row.current_period_end,
  trialEnd: row.trial_end,
  cancelAtPeriodEnd: row.cancel_at_period_end,
  canceledAt: row.canceled_at,
  endedAt: row.ended_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface InvoiceLineJson {
  kind: InvoiceLineKind;
  description: string;
  amount: string;
  plan_id: string;
  period_start: string;
  period_end: string;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  customer_id: string;
  subscription_id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  currency: string;
  period_start: Date;
  period_end: Date;
  total: string;
  credit_applied: string;
  amount_due: string;
  amount_paid: string;
  amount_refunded: string;
  attempt_count: number;
  first_failed_at: Date | null;
  next_retry_at: Date | null;
  scheduled_retries: number;
  created_at: Date;
  finalized_at: Date | null;
  paid_at: Date | null;
  voided_at: Date | null;
  uncollectible_at: Date | null;
  lines: InvoiceLineJson[];
}

const toLine = (line: InvoiceLineJson): InvoiceLine => ({
  kind: line.kind,
  description: line.description,
  amount: toSafeInteger(line.amount, 'invoice_lines.amount'),
  planId: line.plan_id,
  periodStart: new Date(line.period_start),
  periodEnd: new Date(line.period_end),
});

export const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  number: row.number,
  customerId: row.customer_id,
  subscriptionId: row.subscription_id,
  kind: row.kind,
  status: row.status,
  currency: toCurrency(row.currency),
  periodStart: row.period_start,
  periodEnd: row.period_end,
  lines: row.lines.map(toLine),
  total: toSafeInteger(row.total, 'invoices.total'),
  creditApplied: toSafeInteger(row.credit_applied, 'invoices.credit_applied'),
  amountDue: toSafeInteger(row.amount_due, 'invoices.amount_due'),
  amountPaid: toSafeInteger(row.amount_paid, 'invoices.amount_paid'),
  amountRefunded: toSafeInteger(row.amount_refunded, 'invoices.amount_refunded'),
  attemptCount: row.attempt_count,
  firstFailedAt: row.first_failed_at,
  nextRetryAt: row.next_retry_at,
  scheduledRetries: row.scheduled_retries,
  createdAt: row.created_at,
  finalizedAt: row.finalized_at,
  paidAt: row.paid_at,
  voidedAt: row.voided_at,
  uncollectibleAt: row.uncollectible_at,
});

export interface PaymentRow {
  id: string;
  invoice_id: string;
  customer_id: string;
  subscription_id: string;
  attempt: number;
  trigger: PaymentTrigger;
  idempotency_key: string;
  payment_method_id: string | null;
  provider_payment_id: string | null;
  amount: string;
  currency: string;
  status: PaymentStatus;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
  last_attempt_at: Date;
}

export const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  invoiceId: row.invoice_id,
  customerId: row.customer_id,
  subscriptionId: row.subscription_id,
  attempt: row.attempt,
  trigger: row.trigger,
  idempotencyKey: row.idempotency_key,
  paymentMethodId: row.payment_method_id,
  providerPaymentId: row.provider_payment_id,
  amount: toSafeInteger(row.amount, 'payments.amount'),
  currency: toCurrency(row.currency),
  status: row.status,
  failureCode: row.failure_code,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastAttemptAt: row.last_attempt_at,
});

export interface AccountRow {
  id: string;
  kind: AccountKind;
  currency: string;
  customer_id: string | null;
  name: string;
}

export const toAccount = (row: AccountRow): LedgerAccount => ({
  id: row.id,
  kind: row.kind,
  currency: toCurrency(row.currency),
  customerId: row.customer_id,
  name: row.name,
});

export interface JournalRow {
  id: string;
  kind: PostingKind;
  currency: string;
  memo: string;
  customer_id: string | null;
  subscription_id: string | null;
  invoice_id: string | null;
  payment_id: string | null;
  reverses_id: string | null;
  posted_at: Date;
  entries: Array<{ account_id: string; amount: string }>;
}

export const toJournalTransaction = (row: JournalRow): JournalTransaction => ({
  id: row.id,
  kind: row.kind,
  currency: toCurrency(row.currency),
  memo: row.memo,
  refs: {
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    invoiceId: row.invoice_id,
    paymentId: row.payment_id,
    reversesId: row.reverses_id,
  },
  postedAt: row.posted_at,
  entries: row.entries.map((entry) => ({ accountId: entry.account_id, amount: toSafeInteger(entry.amount, 'journal_entries.amount') })),
});

export interface WebhookEventRow {
  id: string;
  provider_event_id: string;
  type: string;
  payload: unknown;
  received_at: Date;
  processed_at: Date | null;
  outcome: WebhookOutcome | null;
  note: string | null;
}

export const toWebhookEvent = (row: WebhookEventRow): WebhookEventRecord => ({
  id: row.id,
  providerEventId: row.provider_event_id,
  type: row.type,
  payload: row.payload,
  receivedAt: row.received_at,
  processedAt: row.processed_at,
  outcome: row.outcome,
  note: row.note,
});
