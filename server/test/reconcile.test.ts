import { BillingEngine, FakePayrail, seedDemo } from '@ledgerline/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { reconcileDatabase } from '../src/reconcile.js';
import { auth, createTestApp } from './helpers/app.js';
import { createTestDatabase, describeWithDatabase, type TestDatabase } from './helpers/database.js';

describeWithDatabase('reconciling a PostgreSQL database', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = await createTestDatabase();
    const provider = new FakePayrail();
    await seedDemo({ engine: new BillingEngine({ store: db.store, provider }), provider, end: new Date('2026-10-13T09:00:00Z'), days: 120 });
  });
  afterEach(() => db.close());

  async function reconcileCommand(): Promise<{ exitCode: number; lines: string[] }> {
    const lines: string[] = [];
    const exitCode = await reconcileDatabase(db.url, (line) => lines.push(line));
    return { exitCode, lines };
  }

  async function getReconcile(headers: Record<string, string> = auth) {
    const t = await createTestApp({ store: db.store });
    try {
      return await t.app.inject({ method: 'GET', url: '/v1/reconcile', headers });
    } finally {
      await t.app.close();
    }
  }

  async function count(table: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0]!.n;
  }

  it('finds nothing to report in a freshly seeded schema and exits 0', async () => {
    const checked = {
      customers: await count('customers'),
      subscriptions: await count('subscriptions'),
      invoices: await count('invoices'),
      payments: await count('payments'),
      accounts: await count('ledger_accounts'),
    };
    expect(checked.customers).toBe(13);
    expect(checked.payments).toBeGreaterThan(checked.invoices);

    expect(await reconcileCommand()).toEqual({
      exitCode: 0,
      lines: [
        `no violations in ${checked.customers} customers, ${checked.subscriptions} subscriptions, ${checked.invoices} invoices, ` +
          `${checked.payments} payments and ${checked.accounts} accounts`,
      ],
    });

    const response = await getReconcile();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ checked, violations: [] });
    expect((await getReconcile({})).statusCode).toBe(401);
  });

  it('reports the receivable and the bad debt when a write-off is inserted a second time by hand, and exits 1', async () => {
    const { rows: writeOffs } = await db.pool.query<{ id: string; currency: string; name: string; amount: string }>(
      `SELECT t.id, t.currency, c.name, e.amount
       FROM journal_transactions t
       JOIN customers c ON c.id = t.customer_id
       JOIN journal_entries e ON e.transaction_id = t.id AND e.account_id = 'bad_debt:' || t.currency
       WHERE t.kind = 'write_off'`,
    );
    expect(writeOffs).toHaveLength(1);
    const original = writeOffs[0]!;
    const amount = Number(original.amount);

    // What the retry loop once wrote: a second write-off of the same invoice, balanced on its own.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO journal_transactions (id, kind, currency, memo, customer_id, subscription_id, invoice_id, posted_at)
         SELECT 'jt_written_off_again', kind, currency, memo, customer_id, subscription_id, invoice_id, posted_at
         FROM journal_transactions WHERE id = $1`,
        [original.id],
      );
      await client.query(
        `INSERT INTO journal_entries (transaction_id, account_id, currency, amount)
         SELECT 'jt_written_off_again', account_id, currency, amount FROM journal_entries WHERE transaction_id = $1`,
        [original.id],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const violations = [
      { rule: 'receivable', message: `customer ${original.name}: receivable ${-amount}, open invoices owe 0` },
      { rule: 'bad_debt', message: `${original.currency} bad debt ${2 * amount}, uncollectible invoices owe ${amount}` },
    ];
    const { exitCode, lines } = await reconcileCommand();
    expect(lines).toEqual([
      ...violations.map((v) => `${v.rule}: ${v.message}`),
      expect.stringMatching(/^2 violations in 13 customers, \d+ subscriptions, \d+ invoices, \d+ payments and \d+ accounts$/),
    ]);
    expect(exitCode).toBe(1);

    const response = await getReconcile();
    expect(response.statusCode).toBe(200);
    expect(response.json<{ violations: unknown }>().violations).toEqual(violations);
  });

  it('reads one snapshot, so a commit in the middle of the read is not half seen', async () => {
    const seen = await db.store.run(
      async (tx) => {
        const before = (await tx.listCustomers({})).length;
        await db.pool.query(
          `INSERT INTO customers (id, name, email, currency, created_at)
           VALUES ('cus_meanwhile', 'Meanwhile Ltd', 'ap@meanwhile.example.com', 'EUR', now())`,
        );
        return [before, (await tx.listCustomers({})).length];
      },
      { readOnly: true },
    );
    expect(seen).toEqual([13, 13]);
    expect(await count('customers')).toBe(14);
  });
});
