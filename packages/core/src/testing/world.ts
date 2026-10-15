import { addDays } from '../calendar.js';
import type { Customer, PaymentMethod } from '../customer.js';
import type { DunningPolicy } from '../dunning.js';
import { BillingEngine } from '../engine/billing-engine.js';
import type { DueWorkReport } from '../engine/due-work.js';
import type { ReceiveResult } from '../engine/webhooks.js';
import type { Currency } from '../money.js';
import { FakePayrail, PAYRAIL_TEST_CARDS } from '../payrail/fake-payrail.js';
import { PLAN_CATALOG } from '../plans.js';
import type { Store } from '../ports/store.js';

export type TestCard = keyof typeof PAYRAIL_TEST_CARDS;

/** An engine, a fake Payrail and a test clock around one store, for scenario tests. */
export class BillingWorld {
  readonly provider: FakePayrail;
  readonly engine: BillingEngine;
  private current: Date;

  private constructor(
    readonly store: Store,
    start: Date,
    options: { dunning?: DunningPolicy },
  ) {
    this.current = start;
    this.provider = new FakePayrail({ now: () => this.current });
    this.engine = new BillingEngine({ store, provider: this.provider, ...(options.dunning ? { dunning: options.dunning } : {}) });
  }

  static async create(store: Store, start: Date, options: { dunning?: DunningPolicy } = {}): Promise<BillingWorld> {
    const world = new BillingWorld(store, start, options);
    await world.engine.syncPlans(PLAN_CATALOG);
    await world.engine.setClock(start);
    return world;
  }

  get now(): Date {
    return this.current;
  }

  /** A second engine on the same store and provider, like a second worker process. */
  anotherWorker(): BillingEngine {
    return new BillingEngine({ store: this.store, provider: this.provider });
  }

  async advanceTo(to: Date, onDay?: (at: Date, report: DueWorkReport) => Promise<void> | void): Promise<void> {
    await this.engine.advanceClock(to, async (at, report) => {
      this.current = at;
      // Due work reports a failed step and carries on with the others, so a walk would not notice it otherwise.
      if (report.errors.length > 0) throw new Error(`due work failed on ${at.toISOString()}: ${JSON.stringify(report.errors)}`);
      await onDay?.(at, report);
    });
    this.current = to;
  }

  advanceDays(days: number, onDay?: (at: Date, report: DueWorkReport) => Promise<void> | void): Promise<void> {
    return this.advanceTo(addDays(this.current, days), onDay);
  }

  async customer(name: string, currency: Currency, card?: TestCard): Promise<{ customer: Customer; method: PaymentMethod | null }> {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');
    const customer = await this.engine.createCustomer({ name, email: `billing@${slug}.example.com`, currency }, this.current);
    const method = card ? await this.attachCard(customer.id, card) : null;
    return { customer: await this.engine.getCustomer(customer.id), method };
  }

  attachCard(customerId: string, card: TestCard): Promise<PaymentMethod> {
    const expYear = this.current.getUTCFullYear() + 3;
    return this.engine.attachPaymentMethod(customerId, { number: PAYRAIL_TEST_CARDS[card], expMonth: 12, expYear }, this.current);
  }

  async balances(): Promise<Record<string, number>> {
    const rows = await this.engine.ledgerAccounts();
    return Object.fromEntries(rows.map((row) => [row.account.id, row.balance]));
  }

  async balance(accountId: string): Promise<number> {
    return (await this.balances())[accountId] ?? 0;
  }

  /** Delivers every event the fake provider emitted so far, in order. */
  async deliverEvents(): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];
    for (const event of this.provider.drainEvents()) {
      results.push(await this.engine.receiveProviderEvent(event, this.current));
    }
    return results;
  }
}
