import {
  BillingEngine,
  BillingError,
  DAY_MS,
  FakePayrail,
  MemoryStore,
  SeededRandom,
  seedDemo,
  seededIds,
  type ClockAdvance,
} from '@ledgerline/core';
import { forgetWorld, loadWorld, saveWorld, type KeyValueStorage, type SavedWorld } from './persistence';
import { BROWSER_STORY, DEMO_DAYS } from './story';

/** The same seed and the same day give every visitor the same world, id for id. */
const DEMO_SEED = 182_026;
const OPENING_HOUR_UTC = 9;

export interface OpenWorldOptions {
  today: Date;
  storage: KeyValueStorage | null;
  onProgress?: (day: number, days: number) => void;
}

/** The demo's history ends at 09:00 UTC on the visitor's day. */
export function openingTime(today: Date): Date {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), OPENING_HOUR_UTC));
}

/**
 * The billing engine on a MemoryStore and the fake Payrail, running in the
 * page. Changes run one at a time at the simulated "now", the webhooks they
 * cause are delivered right after, and the world is saved after each one.
 */
export class DemoWorld {
  readonly engine: BillingEngine;
  private readonly provider: FakePayrail;
  private providerNow: Date;
  private queue: Promise<unknown> = Promise.resolve();
  /** True when the browser refused the last save; the world then lives on in memory only. */
  saveFailed = false;

  private constructor(
    private readonly store: MemoryStore,
    private readonly random: SeededRandom,
    private readonly storage: KeyValueStorage | null,
    now: Date,
  ) {
    this.providerNow = now;
    this.provider = new FakePayrail({ random: random.next, now: () => this.providerNow });
    this.engine = new BillingEngine({ store, provider: this.provider, ids: seededIds(random.next) });
  }

  /** Picks up the saved world, or builds a new one when there is none. */
  static async open(options: OpenWorldOptions): Promise<DemoWorld> {
    const saved = loadWorld(options.storage);
    if (saved) {
      const world = DemoWorld.restore(saved, options.storage);
      if (world) return world;
      forgetWorld(options.storage);
    }
    return DemoWorld.build(options);
  }

  private static restore(saved: SavedWorld, storage: KeyValueStorage | null): DemoWorld | null {
    try {
      const store = MemoryStore.restore(saved.dump);
      return saved.dump.clock ? new DemoWorld(store, new SeededRandom(saved.random), storage, saved.dump.clock) : null;
    } catch {
      return null;
    }
  }

  private static async build(options: OpenWorldOptions): Promise<DemoWorld> {
    const end = openingTime(options.today);
    const from = new Date(end.getTime() - DEMO_DAYS * DAY_MS);
    const world = new DemoWorld(new MemoryStore(), new SeededRandom(DEMO_SEED), options.storage, from);
    let day = 0;
    await seedDemo({
      engine: world.engine,
      provider: world.provider,
      end,
      days: DEMO_DAYS,
      story: BROWSER_STORY,
      onDay: (at) => {
        day += 1;
        world.providerNow = at;
        // Every fourth day Payrail answers "pending" and settles through webhooks, as real
        // providers do for slower payment methods, so the log has events that did the work.
        world.provider.setMode(day % 4 === 0 ? 'async' : 'sync');
        options.onProgress?.(day, DEMO_DAYS);
      },
    });
    world.provider.setMode('sync');
    await world.save();
    return world;
  }

  async now(): Promise<Date> {
    const clock = await this.engine.getClock();
    if (!clock) throw new BillingError('clock_not_set', 'the demo world has no clock');
    return clock;
  }

  /** Runs a change at the simulated now, delivers the webhooks it caused and saves the world. */
  change<T>(work: (now: Date) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const now = await this.now();
      const result = await work(now);
      await this.deliverEvents(now);
      await this.save();
      return result;
    });
  }

  /** Moves the clock a day at a time, like the server's test clock, delivering each day's webhooks before the next day. */
  advanceTo(to: Date): Promise<ClockAdvance> {
    return this.exclusive(async () => {
      const from = await this.now();
      if (to < from) throw new BillingError('invalid_argument', 'the test clock only moves forward');
      const days: ClockAdvance['days'] = [];
      for (let current = from; current < to; ) {
        const at = new Date(Math.min(current.getTime() + DAY_MS, to.getTime()));
        this.providerNow = at;
        days.push(...(await this.engine.advanceClock(at)).days);
        await this.deliverEvents(at);
        current = at;
      }
      await this.save();
      return { from, to, days };
    });
  }

  /** Forgets the saved world; the next open builds a fresh one. */
  forget(): void {
    forgetWorld(this.storage);
  }

  private async deliverEvents(at: Date): Promise<void> {
    for (const event of this.provider.drainEvents()) await this.engine.receiveProviderEvent(event, at);
  }

  private async save(): Promise<void> {
    this.saveFailed = !saveWorld(this.storage, { random: this.random.state, dump: await this.store.dump() });
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
