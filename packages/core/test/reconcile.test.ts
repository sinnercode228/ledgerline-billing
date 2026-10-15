import { describe, expect, it } from 'vitest';
import { seedDemo } from '../src/demo/seed.js';
import { BillingEngine } from '../src/engine/billing-engine.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { FakePayrail } from '../src/payrail/fake-payrail.js';
import { reconcile } from '../src/reconcile.js';
import { at } from '../src/testing/harness.js';
import { BillingWorld } from '../src/testing/world.js';

describe('reconcile', () => {
  it('finds nothing to report in the seeded demo and says how much it read', async () => {
    const store = new MemoryStore();
    const provider = new FakePayrail();
    const engine = new BillingEngine({ store, provider });
    await seedDemo({ engine, provider, end: at('2026-10-13T09:00:00Z'), days: 120 });

    const report = await reconcile(store);

    expect(report.violations).toEqual([]);
    const payments = await store.run(async (tx) => {
      const invoices = await tx.listInvoices({});
      return (await Promise.all(invoices.map((invoice) => tx.listPaymentsForInvoice(invoice.id)))).flat();
    });
    expect(report.checked).toEqual({
      customers: (await engine.listCustomers()).length,
      subscriptions: (await engine.listSubscriptions()).length,
      invoices: (await engine.listInvoices()).length,
      payments: payments.length,
      accounts: (await engine.ledgerAccounts()).length,
    });
    expect(report.checked.payments).toBeGreaterThan(report.checked.invoices);
  });

  it('names the receivable and the bad debt when an invoice is written off twice', async () => {
    const world = await BillingWorld.create(new MemoryStore(), at('2026-03-10T12:00:00Z'));
    const { customer } = await world.customer('Tundra Freight Ops', 'RUB', 'declined');
    await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
    await world.advanceDays(6);
    const [writeOff] = await world.engine.journal({ kind: 'write_off' });
    expect(writeOff?.entries).toEqual([
      { accountId: 'bad_debt:RUB', amount: 990_000 },
      { accountId: `receivable:${customer.id}`, amount: -990_000 },
    ]);
    expect((await reconcile(world.store)).violations).toEqual([]);

    // The shape the retry loop once produced: a second write-off that balances on its own.
    await world.store.run((tx) => tx.insertJournalTransaction({ ...writeOff!, id: 'jt_written_off_again' }));

    expect((await world.engine.trialBalance()).balanced).toBe(true);
    expect((await reconcile(world.store)).violations).toEqual([
      { rule: 'receivable', message: 'customer Tundra Freight Ops: receivable -990000, open invoices owe 0' },
      { rule: 'bad_debt', message: 'RUB bad debt 1980000, uncollectible invoices owe 990000' },
    ]);
  });
});
