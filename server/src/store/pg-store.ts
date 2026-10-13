import {
  BillingError,
  type AccountBalance,
  type Customer,
  type DailyRevenue,
  type IdempotencyRecord,
  type Invoice,
  type InvoiceFilter,
  type JournalFilter,
  type JournalTransaction,
  type LedgerAccount,
  type Lock,
  type Page,
  type Payment,
  type PaymentMethod,
  type Plan,
  type Store,
  type StoreTx,
  type Subscription,
  type SubscriptionFilter,
  type WebhookEventRecord,
} from '@ledgerline/core';
import type pg from 'pg';
import { isRetryableTransactionError, translateDatabaseError } from '../db/errors.js';
import {
  toAccount,
  toCurrency,
  toCustomer,
  toInvoice,
  toJournalTransaction,
  toPayment,
  toPaymentMethod,
  toSafeInteger,
  toSubscription,
  toWebhookEvent,
  type AccountRow,
  type CustomerRow,
  type InvoiceRow,
  type JournalRow,
  type PaymentMethodRow,
  type PaymentRow,
  type SubscriptionRow,
  type WebhookEventRow,
} from './rows.js';

/*
 * Plain SQL through pg rather than a query builder: the queries that matter
 * here (SKIP LOCKED claims, the ON CONFLICT invoice counter, advisory locks,
 * deferred constraint triggers) read most clearly as the SQL they are, and
 * every row goes through a typed mapper that converts bigint safely.
 */

const MAX_ATTEMPTS = 3;

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  async run<T>(work: (tx: StoreTx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.runOnce(work);
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isRetryableTransactionError(error)) continue;
        throw translateDatabaseError(error);
      }
    }
  }

  private async runOnce<T>(work: (tx: StoreTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      const result = await work(new PgTx(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError: unknown) => {
        broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      });
      throw error;
    } finally {
      client.release(broken);
    }
  }
}

const INVOICE_COLUMNS = `
  i.*,
  coalesce((
    SELECT json_agg(json_build_object(
      'kind', l.kind, 'description', l.description, 'amount', l.amount::text, 'plan_id', l.plan_id,
      'period_start', l.period_start, 'period_end', l.period_end) ORDER BY l.position)
    FROM invoice_lines l WHERE l.invoice_id = i.id
  ), '[]') AS lines`;

const JOURNAL_COLUMNS = `
  t.*,
  (SELECT json_agg(json_build_object('account_id', e.account_id, 'amount', e.amount::text) ORDER BY e.id)
   FROM journal_entries e WHERE e.transaction_id = t.id) AS entries`;

const lockClause = (lock?: Lock) => (lock === 'for_update' ? 'FOR UPDATE' : '');

class PgTx implements StoreTx {
  constructor(private readonly client: pg.PoolClient) {}

  private async rows<R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
    return (await this.client.query<R>(sql, params)).rows;
  }

  private async one<R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R | null> {
    return (await this.rows<R>(sql, params))[0] ?? null;
  }

  async insertCustomer(c: Customer) {
    await this.client.query(
      `INSERT INTO customers (id, name, email, currency, default_payment_method_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [c.id, c.name, c.email, c.currency, c.defaultPaymentMethodId, c.createdAt],
    );
  }
  async getCustomer(id: string, lock?: Lock) {
    const row = await this.one<CustomerRow>(`SELECT * FROM customers WHERE id = $1 ${lockClause(lock)}`, [id]);
    return row && toCustomer(row);
  }
  async updateCustomer(c: Customer) {
    await this.client.query(`UPDATE customers SET name = $2, email = $3, default_payment_method_id = $4 WHERE id = $1`, [
      c.id,
      c.name,
      c.email,
      c.defaultPaymentMethodId,
    ]);
  }
  async listCustomers(page: Page) {
    const rows = await this.rows<CustomerRow>(`SELECT * FROM customers ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT $1 OFFSET $2`, [
      page.limit ?? null,
      page.offset ?? 0,
    ]);
    return rows.map(toCustomer);
  }

  async insertPaymentMethod(m: PaymentMethod) {
    await this.client.query(
      `INSERT INTO payment_methods (id, customer_id, provider_token, brand, last4, exp_month, exp_year, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [m.id, m.customerId, m.providerToken, m.brand, m.last4, m.expMonth, m.expYear, m.createdAt],
    );
  }
  async getPaymentMethod(id: string) {
    const row = await this.one<PaymentMethodRow>(`SELECT * FROM payment_methods WHERE id = $1`, [id]);
    return row && toPaymentMethod(row);
  }
  async listPaymentMethods(customerId: string) {
    const rows = await this.rows<PaymentMethodRow>(
      `SELECT * FROM payment_methods WHERE customer_id = $1 ORDER BY created_at DESC, id COLLATE "C" DESC`,
      [customerId],
    );
    return rows.map(toPaymentMethod);
  }

  async upsertPlan(plan: Plan) {
    await this.client.query(
      `INSERT INTO plans (id, name, interval, trial_days) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, interval = EXCLUDED.interval, trial_days = EXCLUDED.trial_days`,
      [plan.id, plan.name, plan.interval, plan.trialDays],
    );
    const prices = Object.entries(plan.prices);
    await this.client.query(`DELETE FROM plan_prices WHERE plan_id = $1 AND NOT (currency = ANY($2::text[]))`, [
      plan.id,
      prices.map(([currency]) => currency),
    ]);
    for (const [currency, amount] of prices) {
      await this.client.query(
        `INSERT INTO plan_prices (plan_id, currency, amount) VALUES ($1, $2, $3)
         ON CONFLICT (plan_id, currency) DO UPDATE SET amount = EXCLUDED.amount`,
        [plan.id, currency, amount],
      );
    }
  }
  async getPlan(id: string) {
    return (await this.plans(id))[0] ?? null;
  }
  async listPlans() {
    return this.plans(null);
  }
  private async plans(id: string | null): Promise<Plan[]> {
    const rows = await this.rows<{ id: string; name: string; interval: Plan['interval']; trial_days: number; prices: Record<string, string> }>(
      `SELECT p.id, p.name, p.interval, p.trial_days,
              coalesce(json_object_agg(pp.currency, pp.amount::text) FILTER (WHERE pp.currency IS NOT NULL), '{}') AS prices
       FROM plans p LEFT JOIN plan_prices pp ON pp.plan_id = p.id
       WHERE $1::text IS NULL OR p.id = $1
       GROUP BY p.id ORDER BY p.id COLLATE "C"`,
      [id],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      interval: row.interval,
      trialDays: row.trial_days,
      prices: Object.fromEntries(Object.entries(row.prices).map(([currency, amount]) => [currency, toSafeInteger(amount, 'plan_prices.amount')])),
    }));
  }

  async insertSubscription(s: Subscription) {
    await this.client.query(
      `INSERT INTO subscriptions (id, customer_id, plan_id, currency, status, billing_anchor, paid_cycles, current_period_start,
         current_period_end, trial_end, cancel_at_period_end, canceled_at, ended_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        s.id,
        s.customerId,
        s.planId,
        s.currency,
        s.status,
        s.billingAnchor,
        s.paidCycles,
        s.currentPeriodStart,
        s.currentPeriodEnd,
        s.trialEnd,
        s.cancelAtPeriodEnd,
        s.canceledAt,
        s.endedAt,
        s.createdAt,
        s.updatedAt,
      ],
    );
  }
  async getSubscription(id: string, lock?: Lock) {
    const row = await this.one<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1 ${lockClause(lock)}`, [id]);
    return row && toSubscription(row);
  }
  async updateSubscription(s: Subscription) {
    await this.client.query(
      `UPDATE subscriptions SET plan_id = $2, status = $3, paid_cycles = $4, current_period_start = $5, current_period_end = $6,
         cancel_at_period_end = $7, canceled_at = $8, ended_at = $9, updated_at = $10
       WHERE id = $1`,
      [s.id, s.planId, s.status, s.paidCycles, s.currentPeriodStart, s.currentPeriodEnd, s.cancelAtPeriodEnd, s.canceledAt, s.endedAt, s.updatedAt],
    );
  }
  async listSubscriptions(filter: SubscriptionFilter) {
    const rows = await this.rows<SubscriptionRow>(
      `SELECT * FROM subscriptions
       WHERE ($1::text IS NULL OR customer_id = $1) AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT $3 OFFSET $4`,
      [filter.customerId ?? null, filter.status ?? null, filter.limit ?? null, filter.offset ?? 0],
    );
    return rows.map(toSubscription);
  }
  async claimDueSubscription(now: Date, skip: readonly string[]) {
    const row = await this.one<SubscriptionRow>(
      `SELECT s.* FROM subscriptions s
       WHERE NOT (s.id = ANY($2::text[]))
         AND ((s.status IN ('trialing', 'active') AND s.current_period_end <= $1)
           OR (s.status = 'past_due' AND EXISTS (
                SELECT 1 FROM invoices i
                WHERE i.subscription_id = s.id AND i.status = 'open' AND i.next_retry_at <= $1)))
       ORDER BY s.current_period_end, s.id COLLATE "C"
       LIMIT 1
       FOR UPDATE OF s SKIP LOCKED`,
      [now, skip],
    );
    return row && toSubscription(row);
  }

  async insertInvoice(i: Invoice) {
    await this.client.query(
      `INSERT INTO invoices (id, number, customer_id, subscription_id, kind, status, currency, period_start, period_end, total,
         credit_applied, amount_due, amount_paid, amount_refunded, attempt_count, first_failed_at, next_retry_at, scheduled_retries,
         created_at, finalized_at, paid_at, voided_at, uncollectible_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [
        i.id,
        i.number,
        i.customerId,
        i.subscriptionId,
        i.kind,
        i.status,
        i.currency,
        i.periodStart,
        i.periodEnd,
        i.total,
        i.creditApplied,
        i.amountDue,
        i.amountPaid,
        i.amountRefunded,
        i.attemptCount,
        i.firstFailedAt,
        i.nextRetryAt,
        i.scheduledRetries,
        i.createdAt,
        i.finalizedAt,
        i.paidAt,
        i.voidedAt,
        i.uncollectibleAt,
      ],
    );
    for (const [position, line] of i.lines.entries()) {
      await this.client.query(
        `INSERT INTO invoice_lines (invoice_id, position, kind, description, amount, plan_id, period_start, period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [i.id, position, line.kind, line.description, line.amount, line.planId, line.periodStart, line.periodEnd],
      );
    }
  }
  async getInvoice(id: string, lock?: Lock) {
    const row = await this.one<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.id = $1 ${lock ? 'FOR UPDATE OF i' : ''}`, [id]);
    return row && toInvoice(row);
  }
  async updateInvoice(i: Invoice) {
    await this.client.query(
      `UPDATE invoices SET number = $2, status = $3, total = $4, credit_applied = $5, amount_due = $6, amount_paid = $7,
         amount_refunded = $8, attempt_count = $9, first_failed_at = $10, next_retry_at = $11, scheduled_retries = $12,
         finalized_at = $13, paid_at = $14, voided_at = $15, uncollectible_at = $16
       WHERE id = $1`,
      [
        i.id,
        i.number,
        i.status,
        i.total,
        i.creditApplied,
        i.amountDue,
        i.amountPaid,
        i.amountRefunded,
        i.attemptCount,
        i.firstFailedAt,
        i.nextRetryAt,
        i.scheduledRetries,
        i.finalizedAt,
        i.paidAt,
        i.voidedAt,
        i.uncollectibleAt,
      ],
    );
  }
  async listInvoices(filter: InvoiceFilter) {
    const rows = await this.rows<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices i
       WHERE ($1::text IS NULL OR i.customer_id = $1) AND ($2::text IS NULL OR i.subscription_id = $2) AND ($3::text IS NULL OR i.status = $3)
       ORDER BY i.created_at DESC, i.id COLLATE "C" DESC LIMIT $4 OFFSET $5`,
      [filter.customerId ?? null, filter.subscriptionId ?? null, filter.status ?? null, filter.limit ?? null, filter.offset ?? 0],
    );
    return rows.map(toInvoice);
  }
  async nextInvoiceSequence(year: number) {
    // The upsert locks the year's counter row until commit: a concurrent
    // finalization waits, and a rollback gives the number back. No gaps.
    const row = await this.one<{ last_number: number }>(
      `INSERT INTO invoice_counters (year, last_number) VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last_number = invoice_counters.last_number + 1
       RETURNING last_number`,
      [year],
    );
    if (!row) throw new Error('invoice counter upsert returned no row');
    return row.last_number;
  }

  async insertPayment(p: Payment) {
    await this.client.query(
      `INSERT INTO payments (id, invoice_id, customer_id, subscription_id, attempt, trigger, idempotency_key, payment_method_id,
         provider_payment_id, amount, currency, status, failure_code, created_at, updated_at, last_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        p.id,
        p.invoiceId,
        p.customerId,
        p.subscriptionId,
        p.attempt,
        p.trigger,
        p.idempotencyKey,
        p.paymentMethodId,
        p.providerPaymentId,
        p.amount,
        p.currency,
        p.status,
        p.failureCode,
        p.createdAt,
        p.updatedAt,
        p.lastAttemptAt,
      ],
    );
  }
  async getPayment(id: string, lock?: Lock) {
    const row = await this.one<PaymentRow>(`SELECT * FROM payments WHERE id = $1 ${lockClause(lock)}`, [id]);
    return row && toPayment(row);
  }
  async findPaymentByProviderId(providerPaymentId: string) {
    const row = await this.one<PaymentRow>(`SELECT * FROM payments WHERE provider_payment_id = $1`, [providerPaymentId]);
    return row && toPayment(row);
  }
  async findPaymentByAttempt(invoiceId: string, attempt: number) {
    const row = await this.one<PaymentRow>(`SELECT * FROM payments WHERE invoice_id = $1 AND attempt = $2`, [invoiceId, attempt]);
    return row && toPayment(row);
  }
  async listPaymentsForInvoice(invoiceId: string) {
    const rows = await this.rows<PaymentRow>(`SELECT * FROM payments WHERE invoice_id = $1 ORDER BY attempt`, [invoiceId]);
    return rows.map(toPayment);
  }
  async updatePayment(p: Payment) {
    await this.client.query(
      `UPDATE payments SET provider_payment_id = $2, status = $3, failure_code = $4, updated_at = $5, last_attempt_at = $6 WHERE id = $1`,
      [p.id, p.providerPaymentId, p.status, p.failureCode, p.updatedAt, p.lastAttemptAt],
    );
  }
  async claimStalePendingPayment(cutoff: Date, skip: readonly string[]) {
    const row = await this.one<PaymentRow>(
      `SELECT * FROM payments
       WHERE status = 'pending' AND last_attempt_at <= $1 AND NOT (id = ANY($2::text[]))
       ORDER BY last_attempt_at LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [cutoff, skip],
    );
    return row && toPayment(row);
  }

  async ensureLedgerAccounts(accounts: readonly LedgerAccount[]) {
    for (const a of accounts) {
      const inserted = await this.one<{ id: string }>(
        `INSERT INTO ledger_accounts (id, kind, currency, customer_id, name) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [a.id, a.kind, a.currency, a.customerId, a.name],
      );
      if (!inserted) {
        const existing = await this.one<AccountRow>(`SELECT * FROM ledger_accounts WHERE id = $1`, [a.id]);
        if (existing && existing.currency !== a.currency) {
          throw new BillingError('currency_mismatch', `account ${a.id} is in ${existing.currency}`);
        }
      }
    }
  }
  async insertJournalTransaction(t: JournalTransaction) {
    await this.client.query(
      `INSERT INTO journal_transactions (id, kind, currency, memo, customer_id, subscription_id, invoice_id, payment_id, reverses_id, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        t.id,
        t.kind,
        t.currency,
        t.memo,
        t.refs.customerId,
        t.refs.subscriptionId,
        t.refs.invoiceId,
        t.refs.paymentId,
        t.refs.reversesId,
        t.postedAt,
      ],
    );
    for (const entry of t.entries) {
      await this.client.query(`INSERT INTO journal_entries (transaction_id, account_id, currency, amount) VALUES ($1, $2, $3, $4)`, [
        t.id,
        entry.accountId,
        t.currency,
        entry.amount,
      ]);
    }
  }
  async getAccountBalance(accountId: string) {
    const row = await this.one<{ balance: string }>(`SELECT coalesce(sum(amount), 0) AS balance FROM journal_entries WHERE account_id = $1`, [
      accountId,
    ]);
    return toSafeInteger(row?.balance ?? '0', 'balance');
  }
  async listAccountBalances(filter: { customerId?: string }): Promise<AccountBalance[]> {
    const rows = await this.rows<AccountRow & { debits: string; credits: string }>(
      `SELECT a.*,
              coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0) AS debits,
              coalesce(-sum(e.amount) FILTER (WHERE e.amount < 0), 0) AS credits
       FROM ledger_accounts a LEFT JOIN journal_entries e ON e.account_id = a.id
       WHERE $1::text IS NULL OR a.customer_id = $1
       GROUP BY a.id ORDER BY a.id COLLATE "C"`,
      [filter.customerId ?? null],
    );
    return rows.map((row) => {
      const debits = toSafeInteger(row.debits, 'debits');
      const credits = toSafeInteger(row.credits, 'credits');
      return { account: toAccount(row), debits, credits, balance: debits - credits };
    });
  }
  async listJournal(filter: JournalFilter) {
    const rows = await this.rows<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM journal_transactions t
       WHERE ($1::text IS NULL OR t.kind = $1) AND ($2::text IS NULL OR t.invoice_id = $2)
         AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM journal_entries e WHERE e.transaction_id = t.id AND e.account_id = $3))
       ORDER BY t.posted_at DESC, t.seq DESC LIMIT $4 OFFSET $5`,
      [filter.kind ?? null, filter.invoiceId ?? null, filter.accountId ?? null, filter.limit ?? null, filter.offset ?? 0],
    );
    return rows.map(toJournalTransaction);
  }
  async dailyRevenue(range: { from: Date; to: Date }): Promise<DailyRevenue[]> {
    const rows = await this.rows<{ day: string; currency: string; amount: string }>(
      `SELECT to_char(t.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, t.currency, -sum(e.amount) AS amount
       FROM journal_entries e
       JOIN journal_transactions t ON t.id = e.transaction_id
       JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.kind = 'revenue' AND t.posted_at >= $1 AND t.posted_at < $2
       GROUP BY 1, t.currency ORDER BY 1, t.currency COLLATE "C"`,
      [range.from, range.to],
    );
    return rows.map((row) => ({ day: row.day, currency: toCurrency(row.currency), amount: toSafeInteger(row.amount, 'revenue') }));
  }

  async insertWebhookEvent(e: WebhookEventRecord) {
    const result = await this.client.query(
      `INSERT INTO webhook_events (id, provider_event_id, type, payload, received_at, processed_at, outcome, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider_event_id) DO NOTHING`,
      [e.id, e.providerEventId, e.type, JSON.stringify(e.payload), e.receivedAt, e.processedAt, e.outcome, e.note],
    );
    return result.rowCount === 1;
  }
  async updateWebhookEvent(e: WebhookEventRecord) {
    await this.client.query(`UPDATE webhook_events SET processed_at = $2, outcome = $3, note = $4 WHERE provider_event_id = $1`, [
      e.providerEventId,
      e.processedAt,
      e.outcome,
      e.note,
    ]);
  }
  async listWebhookEvents(page: Page) {
    const rows = await this.rows<WebhookEventRow>(
      `SELECT * FROM webhook_events ORDER BY received_at DESC, id COLLATE "C" DESC LIMIT $1 OFFSET $2`,
      [page.limit ?? null, page.offset ?? 0],
    );
    return rows.map(toWebhookEvent);
  }

  async lockIdempotencyKey(scope: string, key: string) {
    // A transaction-scoped advisory lock covers keys that have no row yet.
    await this.client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [scope, key]);
    const row = await this.one<{ scope: string; key: string; fingerprint: string; resource_id: string; created_at: Date }>(
      `SELECT * FROM idempotency_keys WHERE scope = $1 AND key = $2`,
      [scope, key],
    );
    return row && { scope: row.scope, key: row.key, fingerprint: row.fingerprint, resourceId: row.resource_id, createdAt: row.created_at };
  }
  async saveIdempotencyKey(r: IdempotencyRecord) {
    await this.client.query(`INSERT INTO idempotency_keys (scope, key, fingerprint, resource_id, created_at) VALUES ($1, $2, $3, $4, $5)`, [
      r.scope,
      r.key,
      r.fingerprint,
      r.resourceId,
      r.createdAt,
    ]);
  }

  async getClock() {
    return (await this.one<{ now: Date }>(`SELECT now FROM test_clock`))?.now ?? null;
  }
  async setClock(now: Date) {
    await this.client.query(`INSERT INTO test_clock (singleton, now) VALUES (true, $1) ON CONFLICT (singleton) DO UPDATE SET now = EXCLUDED.now`, [
      now,
    ]);
  }
}
