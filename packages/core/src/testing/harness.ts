import { afterEach, beforeEach, expect } from 'vitest';
import type { BillingEngine } from '../engine/billing-engine.js';
import type { Invoice } from '../invoice.js';
import type { Store } from '../ports/store.js';

export interface StoreHarness {
  store: Store;
  close(): Promise<void>;
}

/** Creates an isolated, empty store: a fresh MemoryStore, or a PgStore on a fresh schema. */
export type StoreFactory = () => Promise<StoreHarness>;

export function useStore(factory: StoreFactory): () => Store {
  let harness: StoreHarness | undefined;
  beforeEach(async () => {
    harness = await factory();
  });
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });
  return () => {
    if (!harness) throw new Error('store is only available inside a test');
    return harness.store;
  };
}

export const at = (iso: string): Date => new Date(iso);

export async function expectBalancedLedger(engine: BillingEngine): Promise<void> {
  const trial = await engine.trialBalance();
  expect(trial.balanced, JSON.stringify(trial.currencies)).toBe(true);
}

/** Per year, invoice numbers must be exactly 1..n with nothing skipped or repeated. */
export function expectGaplessNumbers(invoices: readonly Invoice[]): void {
  const byYear = new Map<string, number[]>();
  for (const invoice of invoices) {
    if (invoice.number === null) continue;
    const [, year, sequence] = /^LL-(\d{4})-(\d{6})$/.exec(invoice.number) ?? [];
    expect(year, `malformed number ${invoice.number}`).toBeDefined();
    byYear.set(year!, [...(byYear.get(year!) ?? []), Number(sequence)]);
  }
  for (const [year, sequences] of byYear) {
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(sorted, `invoice numbers for ${year}`).toEqual(sorted.map((_, i) => i + 1));
  }
}
