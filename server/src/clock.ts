import type { BillingEngine } from '@ledgerline/core';

/** Where "now" comes from: the wall clock in production, a stored clock the API can advance in test-clock mode. */
export interface Clock {
  now(): Promise<Date>;
}

export const systemClock: Clock = {
  now: () => Promise.resolve(new Date()),
};

export function fixedClock(start: Date): Clock & { set(now: Date): void } {
  let current = start;
  return {
    now: () => Promise.resolve(current),
    set(now: Date) {
      current = now;
    },
  };
}

/** Starts at the wall clock the first time it is read, then only moves when advanced. */
export function storedClock(engine: BillingEngine): Clock {
  return {
    async now() {
      const stored = await engine.getClock();
      if (stored) return stored;
      const start = new Date();
      await engine.setClock(start);
      return start;
    },
  };
}
