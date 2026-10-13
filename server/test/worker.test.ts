import { BillingEngine, FakePayrail, MemoryStore, PLAN_CATALOG, silentLogger } from '@ledgerline/core';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../src/clock.js';
import { startWorker } from '../src/worker.js';

describe('worker loop', () => {
  it('runs due work on every tick and finishes the current run before stopping', async () => {
    const start = new Date('2026-03-01T00:00:00Z');
    const clock = fixedClock(start);
    const provider = new FakePayrail();
    const engine = new BillingEngine({ store: new MemoryStore(), provider });
    await engine.syncPlans(PLAN_CATALOG);
    const customer = await engine.createCustomer({ name: 'Arbor Labs', email: 'ap@arbor.example.com', currency: 'RUB' }, start);
    await engine.attachPaymentMethod(customer.id, { number: '4242424242424242', expMonth: 6, expYear: 2030 }, start);
    const subscription = await engine.createSubscription({ customerId: customer.id, planId: 'plan_team_monthly' }, start);

    const worker = startWorker({ engine, clock, intervalMs: 5, logger: silentLogger });
    clock.set(new Date('2026-03-16T00:00:00Z'));
    await expect.poll(async () => (await engine.getSubscription(subscription.id)).status, { timeout: 2_000 }).toBe('active');
    await worker.stop();

    const runsAfterStop = worker.runs;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(worker.runs).toBe(runsAfterStop);
    expect(await engine.listInvoices({ subscriptionId: subscription.id })).toHaveLength(1);
  });
});
