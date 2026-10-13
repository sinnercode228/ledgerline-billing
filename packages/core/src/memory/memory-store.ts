import type { Customer, PaymentMethod } from '../customer.js';
import { BillingError } from '../errors.js';
import type { Invoice } from '../invoice.js';
import { balancesFromEntries, type AccountBalance, type JournalTransaction, type LedgerAccount } from '../ledger.js';
import type { Payment } from '../payments.js';
import type { Plan } from '../plans.js';
import type {
  DailyRevenue,
  IdempotencyRecord,
  InvoiceFilter,
  JournalFilter,
  Page,
  Store,
  StoreTx,
  SubscriptionFilter,
} from '../ports/store.js';
import type { Subscription } from '../subscription.js';
import { utcDay } from '../calendar.js';
import type { WebhookEventRecord } from '../webhook-events.js';

/** Every row of a MemoryStore as plain, structured-cloneable data, for saving a world and loading it later. */
export interface MemoryStoreDump {
  customers: Customer[];
  paymentMethods: PaymentMethod[];
  plans: Plan[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  invoiceCounters: Array<{ year: number; last: number }>;
  payments: Payment[];
  accounts: LedgerAccount[];
  journal: JournalTransaction[];
  webhookEvents: WebhookEventRecord[];
  idempotency: IdempotencyRecord[];
  clock: Date | null;
}

interface MemoryState {
  customers: Map<string, Customer>;
  paymentMethods: Map<string, PaymentMethod>;
  plans: Map<string, Plan>;
  subscriptions: Map<string, Subscription>;
  invoices: Map<string, Invoice>;
  invoiceCounters: Map<number, number>;
  payments: Map<string, Payment>;
  accounts: Map<string, LedgerAccount>;
  accountTotals: Map<string, { debits: number; credits: number }>;
  webhookEvents: Map<string, WebhookEventRecord>;
  idempotency: Map<string, IdempotencyRecord>;
  clock: Date | null;
}

function emptyState(): MemoryState {
  return {
    customers: new Map(),
    paymentMethods: new Map(),
    plans: new Map(),
    subscriptions: new Map(),
    invoices: new Map(),
    invoiceCounters: new Map(),
    payments: new Map(),
    accounts: new Map(),
    accountTotals: new Map(),
    webhookEvents: new Map(),
    idempotency: new Map(),
    clock: null,
  };
}

const copy = <T>(value: T): T => structuredClone(value);

const idempotencyId = (scope: string, key: string) => `${scope}\u0000${key}`;

function assertTransactionBalances(transaction: JournalTransaction): void {
  const sum = transaction.entries.reduce((total, entry) => total + entry.amount, 0);
  if (transaction.entries.length < 2 || sum !== 0) {
    throw new BillingError('unbalanced_transaction', `journal transaction ${transaction.id} does not balance: off by ${sum}`);
  }
}

function addToTotals(totals: MemoryState['accountTotals'], accountId: string, amount: number): void {
  const row = totals.get(accountId) ?? { debits: 0, credits: 0 };
  if (amount > 0) row.debits += amount;
  else row.credits -= amount;
  totals.set(accountId, row);
}

function page<T>(rows: T[], { limit, offset = 0 }: Page): T[] {
  return rows.slice(offset, limit === undefined ? undefined : offset + limit);
}

function newestFirst<T extends { createdAt: Date; id: string }>(a: T, b: T): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * Store for tests and the in-browser demo. Transactions run one at a time
 * against a copy of the state that replaces the original only on commit, so
 * a throwing transaction leaves nothing behind. It enforces the same
 * constraints as the PostgreSQL schema, checked at the same moments.
 */
export class MemoryStore implements Store {
  private state = emptyState();
  /** Append-only, so it is shared rather than copied per transaction. */
  private readonly journal: JournalTransaction[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  /** A store holding exactly the rows of a dump. Refuses a journal that does not balance. */
  static restore(dump: MemoryStoreDump): MemoryStore {
    const store = new MemoryStore();
    const s = store.state;
    const byId = <T extends { id: string }>(rows: readonly T[]) => new Map(rows.map((row) => [row.id, copy(row)]));
    s.customers = byId(dump.customers);
    s.paymentMethods = byId(dump.paymentMethods);
    s.plans = byId(dump.plans);
    s.subscriptions = byId(dump.subscriptions);
    s.invoices = byId(dump.invoices);
    s.payments = byId(dump.payments);
    s.accounts = byId(dump.accounts);
    s.invoiceCounters = new Map(dump.invoiceCounters.map(({ year, last }) => [year, last]));
    s.webhookEvents = new Map(dump.webhookEvents.map((event) => [event.providerEventId, copy(event)]));
    s.idempotency = new Map(dump.idempotency.map((record) => [idempotencyId(record.scope, record.key), copy(record)]));
    s.clock = copy(dump.clock);
    for (const transaction of dump.journal) {
      assertTransactionBalances(transaction);
      for (const entry of transaction.entries) addToTotals(s.accountTotals, entry.accountId, entry.amount);
      store.journal.push(copy(transaction));
    }
    return store;
  }

  run<T>(work: (tx: StoreTx) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => this.execute(work));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Every row as plain data, taken after the transactions already queued have finished. */
  dump(): Promise<MemoryStoreDump> {
    const result = this.queue.then(
      (): MemoryStoreDump =>
        copy({
          customers: [...this.state.customers.values()],
          paymentMethods: [...this.state.paymentMethods.values()],
          plans: [...this.state.plans.values()],
          subscriptions: [...this.state.subscriptions.values()],
          invoices: [...this.state.invoices.values()],
          invoiceCounters: [...this.state.invoiceCounters].map(([year, last]) => ({ year, last })),
          payments: [...this.state.payments.values()],
          accounts: [...this.state.accounts.values()],
          journal: this.journal,
          webhookEvents: [...this.state.webhookEvents.values()],
          idempotency: [...this.state.idempotency.values()],
          clock: this.state.clock,
        }),
    );
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(work: (tx: StoreTx) => Promise<T>): Promise<T> {
    const draft = copy(this.state);
    const tx = new MemoryTx(draft, this.journal);
    const result = await work(tx);
    tx.checkDeferredConstraints();
    this.state = draft;
    this.journal.push(...tx.appended);
    return result;
  }
}

class MemoryTx implements StoreTx {
  readonly appended: JournalTransaction[] = [];

  constructor(
    private readonly s: MemoryState,
    private readonly committedJournal: readonly JournalTransaction[],
  ) {}

  private get journal(): JournalTransaction[] {
    return [...this.committedJournal, ...this.appended];
  }

  checkDeferredConstraints(): void {
    for (const transaction of this.appended) assertTransactionBalances(transaction);
  }

  async insertCustomer(customer: Customer) {
    if (this.s.customers.has(customer.id)) throw new BillingError('duplicate_key', `customer ${customer.id} exists`);
    this.s.customers.set(customer.id, copy(customer));
  }
  async getCustomer(id: string) {
    return copy(this.s.customers.get(id) ?? null);
  }
  async updateCustomer(customer: Customer) {
    this.requireRow(this.s.customers, customer.id);
    if (customer.defaultPaymentMethodId !== null) {
      const method = this.s.paymentMethods.get(customer.defaultPaymentMethodId);
      if (method?.customerId !== customer.id) {
        throw new BillingError('not_found', `payment method ${customer.defaultPaymentMethodId} does not belong to ${customer.id}`);
      }
    }
    this.s.customers.set(customer.id, copy(customer));
  }
  async listCustomers(p: Page) {
    return copy(page([...this.s.customers.values()].sort(newestFirst), p));
  }

  async insertPaymentMethod(method: PaymentMethod) {
    this.requireRow(this.s.customers, method.customerId);
    if ([...this.s.paymentMethods.values()].some((m) => m.providerToken === method.providerToken)) {
      throw new BillingError('duplicate_key', 'payment method token already attached');
    }
    this.s.paymentMethods.set(method.id, copy(method));
  }
  async getPaymentMethod(id: string) {
    return copy(this.s.paymentMethods.get(id) ?? null);
  }
  async listPaymentMethods(customerId: string) {
    return copy([...this.s.paymentMethods.values()].filter((m) => m.customerId === customerId).sort(newestFirst));
  }

  async upsertPlan(plan: Plan) {
    this.s.plans.set(plan.id, copy(plan));
  }
  async getPlan(id: string) {
    return copy(this.s.plans.get(id) ?? null);
  }
  async listPlans() {
    return copy([...this.s.plans.values()].sort((a, b) => (a.id < b.id ? -1 : 1)));
  }

  async insertSubscription(subscription: Subscription) {
    this.requireRow(this.s.customers, subscription.customerId);
    this.requireRow(this.s.plans, subscription.planId);
    this.s.subscriptions.set(subscription.id, copy(subscription));
  }
  async getSubscription(id: string) {
    return copy(this.s.subscriptions.get(id) ?? null);
  }
  async updateSubscription(subscription: Subscription) {
    this.requireRow(this.s.subscriptions, subscription.id);
    this.requireRow(this.s.plans, subscription.planId);
    this.s.subscriptions.set(subscription.id, copy(subscription));
  }
  async listSubscriptions(filter: SubscriptionFilter) {
    const rows = [...this.s.subscriptions.values()].filter(
      (s) => (!filter.customerId || s.customerId === filter.customerId) && (!filter.status || s.status === filter.status),
    );
    return copy(page(rows.sort(newestFirst), filter));
  }
  async claimDueSubscription(now: Date, skip: readonly string[]) {
    const due = [...this.s.subscriptions.values()]
      .filter((s) => !skip.includes(s.id))
      .filter((s) =>
        s.status === 'past_due'
          ? [...this.s.invoices.values()].some(
              (i) => i.subscriptionId === s.id && i.status === 'open' && i.nextRetryAt !== null && i.nextRetryAt <= now,
            )
          : (s.status === 'trialing' || s.status === 'active') && s.currentPeriodEnd <= now,
      )
      .sort((a, b) => a.currentPeriodEnd.getTime() - b.currentPeriodEnd.getTime() || (a.id < b.id ? -1 : 1));
    return copy(due[0] ?? null);
  }

  async insertInvoice(invoice: Invoice) {
    this.requireRow(this.s.subscriptions, invoice.subscriptionId);
    const clash = [...this.s.invoices.values()].some(
      (i) =>
        i.subscriptionId === invoice.subscriptionId &&
        i.kind === invoice.kind &&
        i.periodStart.getTime() === invoice.periodStart.getTime(),
    );
    if (clash) {
      throw new BillingError('duplicate_invoice', `subscription ${invoice.subscriptionId} is already billed for this period`);
    }
    this.s.invoices.set(invoice.id, copy(invoice));
  }
  async getInvoice(id: string) {
    return copy(this.s.invoices.get(id) ?? null);
  }
  async updateInvoice(invoice: Invoice) {
    const current = this.requireRow(this.s.invoices, invoice.id);
    if (invoice.number !== null && [...this.s.invoices.values()].some((i) => i.id !== invoice.id && i.number === invoice.number)) {
      throw new BillingError('duplicate_key', `invoice number ${invoice.number} is taken`);
    }
    this.s.invoices.set(invoice.id, copy({ ...invoice, lines: current.lines }));
  }
  async listInvoices(filter: InvoiceFilter) {
    const rows = [...this.s.invoices.values()].filter(
      (i) =>
        (!filter.customerId || i.customerId === filter.customerId) &&
        (!filter.subscriptionId || i.subscriptionId === filter.subscriptionId) &&
        (!filter.status || i.status === filter.status),
    );
    return copy(page(rows.sort(newestFirst), filter));
  }
  async nextInvoiceSequence(year: number) {
    const next = (this.s.invoiceCounters.get(year) ?? 0) + 1;
    this.s.invoiceCounters.set(year, next);
    return next;
  }

  async insertPayment(payment: Payment) {
    this.requireRow(this.s.invoices, payment.invoiceId);
    this.checkPaymentUniqueness(payment);
    this.s.payments.set(payment.id, copy(payment));
  }
  async getPayment(id: string) {
    return copy(this.s.payments.get(id) ?? null);
  }
  async findPaymentByProviderId(providerPaymentId: string) {
    return copy([...this.s.payments.values()].find((p) => p.providerPaymentId === providerPaymentId) ?? null);
  }
  async findPaymentByAttempt(invoiceId: string, attempt: number) {
    return copy([...this.s.payments.values()].find((p) => p.invoiceId === invoiceId && p.attempt === attempt) ?? null);
  }
  async listPaymentsForInvoice(invoiceId: string) {
    return copy([...this.s.payments.values()].filter((p) => p.invoiceId === invoiceId).sort((a, b) => a.attempt - b.attempt));
  }
  async updatePayment(payment: Payment) {
    this.requireRow(this.s.payments, payment.id);
    this.checkPaymentUniqueness(payment);
    this.s.payments.set(payment.id, copy(payment));
  }
  async claimStalePendingPayment(cutoff: Date, skip: readonly string[]) {
    const stale = [...this.s.payments.values()]
      .filter((p) => p.status === 'pending' && p.lastAttemptAt <= cutoff && !skip.includes(p.id))
      .sort((a, b) => a.lastAttemptAt.getTime() - b.lastAttemptAt.getTime());
    return copy(stale[0] ?? null);
  }

  private checkPaymentUniqueness(payment: Payment) {
    for (const other of this.s.payments.values()) {
      if (other.id === payment.id) continue;
      if (other.idempotencyKey === payment.idempotencyKey) throw new BillingError('duplicate_key', 'payment idempotency key reused');
      if (other.invoiceId === payment.invoiceId && other.attempt === payment.attempt) {
        throw new BillingError('duplicate_key', 'payment attempt already recorded');
      }
      if (payment.providerPaymentId !== null && other.providerPaymentId === payment.providerPaymentId) {
        throw new BillingError('duplicate_key', 'provider payment already recorded');
      }
      if (payment.status === 'pending' && other.status === 'pending' && other.invoiceId === payment.invoiceId) {
        throw new BillingError('duplicate_key', `invoice ${payment.invoiceId} already has a payment in flight`);
      }
    }
  }

  async ensureLedgerAccounts(accounts: readonly LedgerAccount[]) {
    for (const account of accounts) {
      const existing = this.s.accounts.get(account.id);
      if (existing && existing.currency !== account.currency) {
        throw new BillingError('currency_mismatch', `account ${account.id} is in ${existing.currency}`);
      }
      if (!existing) this.s.accounts.set(account.id, copy(account));
    }
  }
  async insertJournalTransaction(transaction: JournalTransaction) {
    for (const entry of transaction.entries) {
      const account = this.requireRow(this.s.accounts, entry.accountId);
      if (account.currency !== transaction.currency) {
        throw new BillingError('currency_mismatch', `account ${account.id} is in ${account.currency}, not ${transaction.currency}`);
      }
      if (!Number.isSafeInteger(entry.amount) || entry.amount === 0) {
        throw new BillingError('invalid_amount', `entry on ${entry.accountId} must be a non-zero integer`);
      }
    }
    if (this.journal.some((t) => t.id === transaction.id)) throw new BillingError('duplicate_key', `journal transaction ${transaction.id} exists`);
    for (const entry of transaction.entries) addToTotals(this.s.accountTotals, entry.accountId, entry.amount);
    this.appended.push(copy(transaction));
  }
  async getAccountBalance(accountId: string) {
    const totals = this.s.accountTotals.get(accountId);
    return totals ? totals.debits - totals.credits : 0;
  }
  async listAccountBalances(filter: { customerId?: string | undefined }): Promise<AccountBalance[]> {
    const accounts = [...this.s.accounts.values()].filter((a) => !filter.customerId || a.customerId === filter.customerId);
    const balances = balancesFromEntries(accounts, []);
    for (const row of balances) {
      const totals = this.s.accountTotals.get(row.account.id) ?? { debits: 0, credits: 0 };
      row.debits = totals.debits;
      row.credits = totals.credits;
      row.balance = totals.debits - totals.credits;
    }
    return copy(balances.sort((a, b) => (a.account.id < b.account.id ? -1 : 1)));
  }
  async listJournal(filter: JournalFilter) {
    const rows = this.journal
      .map((transaction, index) => ({ transaction, index }))
      .filter(
        ({ transaction: t }) =>
          (!filter.kind || t.kind === filter.kind) &&
          (!filter.invoiceId || t.refs.invoiceId === filter.invoiceId) &&
          (!filter.accountId || t.entries.some((e) => e.accountId === filter.accountId)),
      )
      .sort((a, b) => b.transaction.postedAt.getTime() - a.transaction.postedAt.getTime() || b.index - a.index)
      .map(({ transaction }) => transaction);
    return copy(page(rows, filter));
  }
  async dailyRevenue(range: { from: Date; to: Date }): Promise<DailyRevenue[]> {
    const totals = new Map<string, DailyRevenue>();
    for (const transaction of this.journal) {
      if (transaction.postedAt < range.from || transaction.postedAt >= range.to) continue;
      for (const entry of transaction.entries) {
        if (this.s.accounts.get(entry.accountId)?.kind !== 'revenue') continue;
        const day = utcDay(transaction.postedAt);
        const key = `${day}|${transaction.currency}`;
        const row = totals.get(key) ?? { day, currency: transaction.currency, amount: 0 };
        row.amount -= entry.amount;
        totals.set(key, row);
      }
    }
    return [...totals.values()].sort((a, b) => (a.day === b.day ? (a.currency < b.currency ? -1 : 1) : a.day < b.day ? -1 : 1));
  }

  async insertWebhookEvent(event: WebhookEventRecord) {
    if (this.s.webhookEvents.has(event.providerEventId)) return false;
    this.s.webhookEvents.set(event.providerEventId, copy(event));
    return true;
  }
  async updateWebhookEvent(event: WebhookEventRecord) {
    this.requireRow(this.s.webhookEvents, event.providerEventId);
    this.s.webhookEvents.set(event.providerEventId, copy(event));
  }
  async listWebhookEvents(p: Page) {
    const rows = [...this.s.webhookEvents.values()].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime() || (a.id < b.id ? 1 : -1),
    );
    return copy(page(rows, p));
  }

  async lockIdempotencyKey(scope: string, key: string) {
    return copy(this.s.idempotency.get(idempotencyId(scope, key)) ?? null);
  }
  async saveIdempotencyKey(record: IdempotencyRecord) {
    const id = idempotencyId(record.scope, record.key);
    if (this.s.idempotency.has(id)) throw new BillingError('duplicate_key', 'idempotency key already used');
    this.s.idempotency.set(id, copy(record));
  }

  async getClock() {
    return copy(this.s.clock);
  }
  async setClock(now: Date) {
    this.s.clock = copy(now);
  }

  private requireRow<T>(table: Map<string, T>, id: string): T {
    const row = table.get(id);
    if (row === undefined) throw new BillingError('not_found', `row ${id} does not exist`);
    return row;
  }
}
