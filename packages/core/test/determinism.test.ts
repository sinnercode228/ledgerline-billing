import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../src/calendar.js';
import { seedDemo } from '../src/demo/seed.js';
import { BillingEngine } from '../src/engine/billing-engine.js';
import { seededIds } from '../src/ids.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { FakePayrail } from '../src/payrail/fake-payrail.js';
import { SeededRandom } from '../src/random.js';

const end = new Date('2026-10-13T09:00:00Z');

async function seededWorld(seed: number) {
  const days = 60;
  const random = new SeededRandom(seed);
  // Event timestamps follow the simulated clock, not the wall clock.
  let now = new Date(end.getTime() - days * DAY_MS);
  const provider = new FakePayrail({ random: random.next, now: () => now });
  const engine = new BillingEngine({ store: new MemoryStore(), provider, ids: seededIds(random.next) });
  await seedDemo({
    engine,
    provider,
    end,
    days,
    onDay: (at) => {
      now = at;
    },
  });
  return engine;
}

async function contents(engine: BillingEngine) {
  return {
    customers: await engine.listCustomers(),
    subscriptions: await engine.listSubscriptions(),
    invoices: await engine.listInvoices(),
    journal: await engine.journal(),
    webhookEvents: await engine.listWebhookEvents(),
  };
}

describe('SeededRandom', () => {
  it('repeats its sequence for a seed and resumes it from a saved state', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const first = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);

    const resumed = new SeededRandom(a.state);
    expect(resumed.next()).toBe(a.next());
  });
});

describe('seeded worlds', () => {
  it('builds the same world, id for id, from the same seed', async () => {
    const first = await contents(await seededWorld(20261013));
    const second = await contents(await seededWorld(20261013));
    expect(first.invoices.length).toBeGreaterThan(5);
    expect(second).toEqual(first);
  });

  it('gives other ids for another seed but the same money', async () => {
    const first = await contents(await seededWorld(1));
    const second = await contents(await seededWorld(2));
    expect(second.customers.map((c) => c.id)).not.toEqual(first.customers.map((c) => c.id));
    const money = (world: typeof first) => world.invoices.map((i) => `${i.kind} ${i.status} ${i.total} ${i.currency}`).sort();
    expect(money(second)).toEqual(money(first));
  });
});
