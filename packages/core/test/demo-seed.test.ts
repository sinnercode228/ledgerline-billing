import { describe, expect, it } from 'vitest';
import { seedDemo, type DemoStory } from '../src/demo/seed.js';
import { BillingEngine } from '../src/engine/billing-engine.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { FakePayrail } from '../src/payrail/fake-payrail.js';
import { expectGaplessNumbers } from '../src/testing/harness.js';

describe('demo seed', () => {
  it('builds four months of history by running the engine, not by writing rows', async () => {
    const end = new Date('2026-10-13T12:00:00Z');
    const provider = new FakePayrail();
    const engine = new BillingEngine({ store: new MemoryStore(), provider });
    const summary = await seedDemo({ engine, provider, end, days: 120 });

    expect(summary.from).toEqual(new Date('2026-06-15T12:00:00Z'));
    expect(await engine.getClock()).toEqual(end);
    const subscriptions = await engine.listSubscriptions();
    const statuses = new Set(subscriptions.map((s) => s.status));
    expect([...statuses].sort()).toEqual(['active', 'canceled', 'past_due', 'trialing']);
    expect((await engine.listCustomers()).length).toBeGreaterThanOrEqual(10);

    const invoices = await engine.listInvoices();
    expectGaplessNumbers(invoices);
    expect(invoices.some((i) => i.kind === 'proration')).toBe(true);
    expect(invoices.some((i) => i.status === 'uncollectible')).toBe(true);
    expect(invoices.some((i) => i.creditApplied > 0)).toBe(true);
    expect(invoices.some((i) => i.amountRefunded > 0)).toBe(true);
    expect((await engine.trialBalance()).balanced).toBe(true);
    expect((await engine.listWebhookEvents()).length).toBeGreaterThan(0);
  }, 60_000);

  it('plays a story it is given instead of the default one', async () => {
    const story: DemoStory = {
      customers: {
        alder: { name: 'Alder & Finch', currency: 'EUR', card: 'succeeds' },
        riverbend: { name: 'Riverbend Logistics', currency: 'RUB', card: 'declined' },
      },
      timeline: [
        [0, { kind: 'subscribe', customer: 'alder', planId: 'plan_team_monthly' }],
        [8, { kind: 'subscribe', customer: 'riverbend', planId: 'plan_business_monthly' }],
      ],
    };
    const provider = new FakePayrail();
    const engine = new BillingEngine({ store: new MemoryStore(), provider });
    const summary = await seedDemo({ engine, provider, end: new Date('2026-10-13T12:00:00Z'), days: 10, story });

    expect(summary.customers).toBe(2);
    const names = new Map((await engine.listCustomers()).map((c) => [c.id, c.name]));
    const statuses = (await engine.listSubscriptions()).map((s) => `${names.get(s.customerId)}: ${s.status}`).sort();
    expect(statuses).toEqual(['Alder & Finch: trialing', 'Riverbend Logistics: past_due']);
  });

  it('refuses to seed a store that already has customers', async () => {
    const provider = new FakePayrail();
    const engine = new BillingEngine({ store: new MemoryStore(), provider });
    await seedDemo({ engine, provider, end: new Date('2026-10-13T12:00:00Z'), days: 10 });
    await expect(seedDemo({ engine, provider, end: new Date('2026-10-13T12:00:00Z'), days: 10 })).rejects.toThrow(/already has customers/);
  });
});
