import type { Customer, PaymentMethod } from '../customer.js';
import type { Invoice, InvoiceStatus } from '../invoice.js';
import type { AccountBalance, JournalTransaction, LedgerAccount, PostingKind } from '../ledger.js';
import type { Currency } from '../money.js';
import type { Payment } from '../payments.js';
import type { Plan } from '../plans.js';
import type { Subscription, SubscriptionStatus } from '../subscription.js';
import type { WebhookEventRecord } from '../webhook-events.js';

// Filters treat an undefined field as "no filter", so validated query objects pass straight through.
export interface Page {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SubscriptionFilter extends Page {
  customerId?: string | undefined;
  status?: SubscriptionStatus | undefined;
}

export interface InvoiceFilter extends Page {
  customerId?: string | undefined;
  subscriptionId?: string | undefined;
  status?: InvoiceStatus | undefined;
}

export interface JournalFilter extends Page {
  accountId?: string | undefined;
  invoiceId?: string | undefined;
  kind?: PostingKind | undefined;
}

export interface DailyRevenue {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  currency: Currency;
  /** Net credit to revenue accounts that day: downgrade credits and refunds reduce it. */
  amount: number;
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  /** Canonical form of the request; a replay with a different body is a conflict. */
  fingerprint: string;
  resourceId: string;
  createdAt: Date;
}

/**
 * Rows read with `lock` are held until the transaction ends. To stay free of
 * deadlocks every caller locks in the same order:
 * subscription -> customer -> invoice -> payment (-> invoice counter).
 */
export type Lock = 'for_update';

export interface StoreTx {
  insertCustomer(customer: Customer): Promise<void>;
  getCustomer(id: string, lock?: Lock): Promise<Customer | null>;
  updateCustomer(customer: Customer): Promise<void>;
  listCustomers(page: Page): Promise<Customer[]>;

  insertPaymentMethod(method: PaymentMethod): Promise<void>;
  getPaymentMethod(id: string): Promise<PaymentMethod | null>;
  listPaymentMethods(customerId: string): Promise<PaymentMethod[]>;

  upsertPlan(plan: Plan): Promise<void>;
  getPlan(id: string): Promise<Plan | null>;
  listPlans(): Promise<Plan[]>;

  insertSubscription(subscription: Subscription): Promise<void>;
  getSubscription(id: string, lock?: Lock): Promise<Subscription | null>;
  updateSubscription(subscription: Subscription): Promise<void>;
  listSubscriptions(filter: SubscriptionFilter): Promise<Subscription[]>;
  /**
   * Locks and returns one subscription with work due at `now`, skipping rows
   * other transactions hold (FOR UPDATE SKIP LOCKED) and the ids in `skip`.
   */
  claimDueSubscription(now: Date, skip: readonly string[]): Promise<Subscription | null>;

  /** Rejects with `duplicate_invoice` when a cycle invoice already bills this subscription's period start. */
  insertInvoice(invoice: Invoice): Promise<void>;
  getInvoice(id: string, lock?: Lock): Promise<Invoice | null>;
  /** Lines are written once on insert; updates change status, amounts and dunning fields. */
  updateInvoice(invoice: Invoice): Promise<void>;
  listInvoices(filter: InvoiceFilter): Promise<Invoice[]>;
  /** Next number in the per-year counter; the counter row stays locked until commit, which keeps numbers gapless. */
  nextInvoiceSequence(year: number): Promise<number>;

  /** At most one pending payment per invoice, unique idempotency key and provider payment id. */
  insertPayment(payment: Payment): Promise<void>;
  getPayment(id: string, lock?: Lock): Promise<Payment | null>;
  findPaymentByProviderId(providerPaymentId: string): Promise<Payment | null>;
  findPaymentByAttempt(invoiceId: string, attempt: number): Promise<Payment | null>;
  listPaymentsForInvoice(invoiceId: string): Promise<Payment[]>;
  updatePayment(payment: Payment): Promise<void>;
  /** Locks one pending payment last sent to the provider at or before `cutoff`, skipping locked rows. */
  claimStalePendingPayment(cutoff: Date, skip: readonly string[]): Promise<Payment | null>;

  ensureLedgerAccounts(accounts: readonly LedgerAccount[]): Promise<void>;
  /** Append-only. The store refuses to commit a transaction whose entries do not sum to zero. */
  insertJournalTransaction(transaction: JournalTransaction): Promise<void>;
  getAccountBalance(accountId: string): Promise<number>;
  listAccountBalances(filter: { customerId?: string | undefined }): Promise<AccountBalance[]>;
  listJournal(filter: JournalFilter): Promise<JournalTransaction[]>;
  dailyRevenue(range: { from: Date; to: Date }): Promise<DailyRevenue[]>;

  /** Returns false when an event with the same provider event id is already stored. */
  insertWebhookEvent(event: WebhookEventRecord): Promise<boolean>;
  updateWebhookEvent(event: WebhookEventRecord): Promise<void>;
  listWebhookEvents(page: Page): Promise<WebhookEventRecord[]>;

  /** Locks the key (even when absent) so concurrent requests with one key run one after another. */
  lockIdempotencyKey(scope: string, key: string): Promise<IdempotencyRecord | null>;
  saveIdempotencyKey(record: IdempotencyRecord): Promise<void>;

  getClock(): Promise<Date | null>;
  setClock(now: Date): Promise<void>;
}

export interface Store {
  /** Runs `work` in one transaction: its writes commit together or not at all. Calls must not nest. */
  run<T>(work: (tx: StoreTx) => Promise<T>): Promise<T>;
}
