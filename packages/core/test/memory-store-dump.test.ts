import { describe, expect, it } from 'vitest';
import { seedDemo } from '../src/demo/seed.js';
import { BillingEngine } from '../src/engine/billing-engine.js';
import { seededIds } from '../src/ids.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { FakePayrail } from '../src/payrail/fake-payrail.js';
import { SeededRandom } from '../src/random.js';

const end = new Date('2026-10-13T09:00:00Z');

function engineOn(store: MemoryStore, seed: number) {
  const random = new SeededRandom(seed);
  const provider = new FakePayrail({ random: random.next });
  return { engine: new BillingEngine({ store, provider, ids: seededIds(random.next) }), provider };
}

async function everything(engine: BillingEngine) {
  return {
    clock: await engine.getClock(),
    plans: await engine.listPlans(),
    customers: await engine.listCustomers(),
    subscriptions: await engine.listSubscriptions(),
    invoices: await engine.listInvoices(),
    accounts: await engine.ledgerAccounts(),
    journal: await engine.journal(),
    webhookEvents: await engine.listWebhookEvents(),
  };
}

async function seededStore() {
  const store = new MemoryStore();
  const { engine, provider } = engineOn(store, 7);
  await seedDemo({ engine, provider, end, days: 90 });
  return { store, engine };
}

describe('MemoryStore dumps', () => {
  it('restores every row, and the restored store carries on exactly like the original', async () => {
    const { store, engine } = await seededStore();
    const restored = MemoryStore.restore(structuredClone(await store.dump()));
    expect(await everything(engineOn(restored, 99).engine)).toEqual(await everything(engine));

    const original = engineOn(store, 99).engine;
    const copy = engineOn(restored, 99).engine;
    const later = new Date('2026-12-20T09:00:00Z');
    await original.advanceClock(later);
    await copy.advanceClock(later);
    expect(await everything(copy)).toEqual(await everything(original));
    expect((await copy.trialBalance()).balanced).toBe(true);
  });

  it('hands out a copy that later writes do not change', async () => {
    const { store, engine } = await seededStore();
    const dump = await store.dump();
    const invoices = dump.invoices.length;
    await engine.advanceClock(new Date('2026-11-20T09:00:00Z'));
    expect(dump.invoices).toHaveLength(invoices);
    expect((await store.dump()).invoices.length).toBeGreaterThan(invoices);
  });

  it('refuses a dump whose journal does not balance', async () => {
    const { store } = await seededStore();
    const dump = await store.dump();
    const [first] = dump.journal;
    first!.entries[0]!.amount += 1;
    expect(() => MemoryStore.restore(dump)).toThrow(/does not balance/);
  });
});
