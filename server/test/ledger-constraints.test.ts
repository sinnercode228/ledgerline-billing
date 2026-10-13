import type pg from 'pg';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestDatabase, describeWithDatabase, type TestDatabase } from './helpers/database.js';

describeWithDatabase('ledger constraints in PostgreSQL', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = await createTestDatabase();
    await db.pool.query(`
      INSERT INTO ledger_accounts (id, kind, currency, customer_id, name) VALUES
        ('revenue:RUB', 'revenue', 'RUB', NULL, 'Revenue'),
        ('provider_clearing:RUB', 'provider_clearing', 'RUB', NULL, 'Clearing'),
        ('revenue:EUR', 'revenue', 'EUR', NULL, 'Revenue')`);
  });
  afterEach(() => db.close());

  async function inTransaction(work: (client: pg.PoolClient) => Promise<void>): Promise<void> {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const journalTransaction = (client: pg.PoolClient, id: string, currency = 'RUB') =>
    client.query(`INSERT INTO journal_transactions (id, kind, currency, memo, posted_at) VALUES ($1, 'refund', $2, 'manual', now())`, [id, currency]);
  const entry = (client: pg.PoolClient, transactionId: string, accountId: string, amount: number, currency = 'RUB') =>
    client.query(`INSERT INTO journal_entries (transaction_id, account_id, currency, amount) VALUES ($1, $2, $3, $4)`, [
      transactionId,
      accountId,
      currency,
      amount,
    ]);

  it('accepts unbalanced entries mid-transaction but rejects them at COMMIT', async () => {
    let insertedWithoutError = false;
    await expect(
      inTransaction(async (client) => {
        await journalTransaction(client, 'jt_unbalanced');
        await entry(client, 'jt_unbalanced', 'revenue:RUB', 500);
        await entry(client, 'jt_unbalanced', 'provider_clearing:RUB', -400);
        insertedWithoutError = true;
      }),
    ).rejects.toMatchObject({ constraint: 'journal_transaction_balanced', message: expect.stringMatching(/sum to 100/) });
    expect(insertedWithoutError).toBe(true);
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM journal_entries');
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('rejects a journal transaction without entries at COMMIT', async () => {
    await expect(inTransaction((client) => journalTransaction(client, 'jt_empty').then(() => undefined))).rejects.toMatchObject({
      constraint: 'journal_transaction_balanced',
    });
  });

  it('commits a balanced transaction', async () => {
    await inTransaction(async (client) => {
      await journalTransaction(client, 'jt_ok');
      await entry(client, 'jt_ok', 'revenue:RUB', 500);
      await entry(client, 'jt_ok', 'provider_clearing:RUB', -500);
    });
    const { rows } = await db.pool.query('SELECT sum(amount)::int AS total, count(*)::int AS n FROM journal_entries');
    expect(rows[0]).toEqual({ total: 0, n: 2 });
  });

  it('rejects an entry whose currency differs from its transaction or account', async () => {
    await expect(
      inTransaction(async (client) => {
        await journalTransaction(client, 'jt_mixed');
        await entry(client, 'jt_mixed', 'revenue:RUB', 500);
        await entry(client, 'jt_mixed', 'revenue:EUR', -500, 'EUR');
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      inTransaction(async (client) => {
        await journalTransaction(client, 'jt_wrong_account');
        await entry(client, 'jt_wrong_account', 'revenue:EUR', 500, 'RUB');
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('never lets entries or transactions be updated or deleted', async () => {
    await inTransaction(async (client) => {
      await journalTransaction(client, 'jt_fixed');
      await entry(client, 'jt_fixed', 'revenue:RUB', 700);
      await entry(client, 'jt_fixed', 'provider_clearing:RUB', -700);
    });
    const appendOnly = expect.objectContaining({ message: expect.stringMatching(/append-only/) });
    await expect(db.pool.query(`UPDATE journal_entries SET amount = 1 WHERE transaction_id = 'jt_fixed'`)).rejects.toEqual(appendOnly);
    await expect(db.pool.query(`DELETE FROM journal_entries WHERE transaction_id = 'jt_fixed'`)).rejects.toEqual(appendOnly);
    await expect(db.pool.query(`UPDATE journal_transactions SET memo = 'edited' WHERE id = 'jt_fixed'`)).rejects.toEqual(appendOnly);
    await expect(db.pool.query(`DELETE FROM journal_transactions WHERE id = 'jt_fixed'`)).rejects.toEqual(appendOnly);
    await expect(db.pool.query('TRUNCATE journal_entries, journal_transactions')).rejects.toEqual(appendOnly);
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM journal_entries');
    expect(rows[0]).toEqual({ n: 2 });
  });

  it('never lets a succeeded payment go back to failed', async () => {
    await db.pool.query(`
      INSERT INTO plans (id, name, interval, trial_days) VALUES ('plan_x', 'X', 'month', 0);
      INSERT INTO customers (id, name, email, currency, created_at) VALUES ('cus_x', 'X', 'x@example.com', 'RUB', now());
      INSERT INTO subscriptions (id, customer_id, plan_id, currency, status, billing_anchor, paid_cycles, current_period_start,
        current_period_end, cancel_at_period_end, created_at, updated_at)
        VALUES ('sub_x', 'cus_x', 'plan_x', 'RUB', 'active', now(), 1, now(), now() + interval '1 month', false, now(), now());
      INSERT INTO invoices (id, number, customer_id, subscription_id, kind, status, currency, period_start, period_end, total,
        credit_applied, amount_due, amount_paid, amount_refunded, created_at)
        VALUES ('in_x', 'LL-2026-000001', 'cus_x', 'sub_x', 'cycle', 'open', 'RUB', now(), now() + interval '1 month', 0, 0, 0, 0, 0, now());
      INSERT INTO payments (id, invoice_id, customer_id, subscription_id, attempt, trigger, idempotency_key, amount, currency, status,
        created_at, updated_at, last_attempt_at)
        VALUES ('pay_x', 'in_x', 'cus_x', 'sub_x', 1, 'initial', 'k1', 100, 'RUB', 'succeeded', now(), now(), now());`);
    await expect(db.pool.query(`UPDATE payments SET status = 'failed' WHERE id = 'pay_x'`)).rejects.toMatchObject({
      message: expect.stringMatching(/succeeded/),
    });
  });
});
