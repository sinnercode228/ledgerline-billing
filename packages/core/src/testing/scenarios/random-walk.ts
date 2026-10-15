import { describe, expect, it } from 'vitest';
import { addDays, MINUTE_MS, utcDay } from '../../calendar.js';
import { isBillingError, type BillingErrorCode } from '../../errors.js';
import type { PayrailEvent } from '../../payrail/events.js';
import { PAYRAIL_TEST_CARDS, type CardBehaviour } from '../../payrail/fake-payrail.js';
import { PLAN_CATALOG } from '../../plans.js';
import { SeededRandom } from '../../random.js';
import { findInvariantViolations } from '../invariants.js';
import { at, expectGaplessNumbers, useStore, type StoreFactory } from '../harness.js';
import { BillingWorld, type TestCard } from '../world.js';

/** What a customer may legitimately be told no for; anything else ends the walk. */
const REFUSALS: readonly BillingErrorCode[] = [
  'payment_method_required',
  'subscription_not_changeable',
  'same_plan',
  'interval_mismatch',
  'invalid_argument',
  'invalid_transition',
];

const NAMES = ['Aster', 'Bramble', 'Cinder', 'Dune', 'Elm', 'Fjord', 'Garnet', 'Heron', 'Iris', 'Juniper', 'Kestrel', 'Larch', 'Moss', 'Nettle'];

/**
 * A seeded random walk: customers arrive with good and bad cards, change
 * plans, cancel, swap cards, get refunds, while the provider switches between
 * synchronous and webhook-only answers, drops responses and delivers events
 * late, twice and out of order. After every step the books must agree with
 * the documents.
 */
export function randomWalkScenarios(factory: StoreFactory): void {
  describe('random walk', () => {
    const store = useStore(factory);

    it.each([20261013, 7])(
      'keeps documents and books in agreement on a seeded walk (seed %i)',
      async (seed) => {
        const random = new SeededRandom(seed);
        const chance = (p: number) => random.next() < p;
        const pick = <T>(items: readonly T[]): T => items[Math.floor(random.next() * items.length)]!;

        const world = await BillingWorld.create(store(), at('2026-01-29T09:30:00Z'));
        const { engine, provider } = world;
        const customers: string[] = [];
        const tokens: string[] = [];
        const held: PayrailEvent[] = [];
        const failures: PayrailEvent[] = [];
        const capturedLater = new Set<string>();

        const attempt = async (work: () => Promise<unknown>) => {
          try {
            await work();
          } catch (error) {
            if (!isBillingError(error) || !REFUSALS.includes(error.code)) throw error;
          }
        };
        const attachCard = async (customerId: string, card: TestCard, makeDefault = true) => {
          const expYear = world.now.getUTCFullYear() + 3;
          const method = await engine.attachPaymentMethod(
            customerId,
            { number: PAYRAIL_TEST_CARDS[card], expMonth: 12, expYear },
            world.now,
            { makeDefault },
          );
          tokens.push(method.providerToken);
        };
        const liveSubscriptions = async () => (await engine.listSubscriptions({})).filter((s) => s.status !== 'canceled');

        const end = addDays(world.now, 240);
        const violations: string[] = [];
        while (world.now < end && violations.length === 0) {
          if (customers.length < NAMES.length && chance(0.08)) {
            const currency = pick(['RUB', 'EUR'] as const);
            const customer = await engine.createCustomer(
              { name: `${NAMES[customers.length]} ${customers.length}`, email: `billing${customers.length}@walk.example.com`, currency },
              world.now,
            );
            customers.push(customer.id);
            const card = pick(['succeeds', 'succeeds', 'succeeds', 'declined', 'insufficientFunds', null] as const);
            if (card) await attachCard(customer.id, card);
            await attempt(() => engine.createSubscription({ customerId: customer.id, planId: pick(PLAN_CATALOG).id }, world.now));
          }
          if (customers.length > 0 && chance(0.06)) {
            await attempt(() => engine.createSubscription({ customerId: pick(customers), planId: pick(PLAN_CATALOG).id }, world.now));
          }
          const subscriptions = await liveSubscriptions();
          if (subscriptions.length > 0 && chance(0.25)) {
            const subscription = pick(subscriptions);
            await attempt(() => engine.changePlan(subscription.id, pick(PLAN_CATALOG).id, world.now));
          }
          if (subscriptions.length > 0 && chance(0.03)) await attempt(() => engine.cancelAtPeriodEnd(pick(subscriptions).id, world.now));
          if (subscriptions.length > 0 && chance(0.04)) await attempt(() => engine.resume(pick(subscriptions).id, world.now));
          if (customers.length > 0 && chance(0.12)) {
            await attachCard(pick(customers), pick(['succeeds', 'declined', 'insufficientFunds'] as const), chance(0.8));
          }
          if (tokens.length > 0 && chance(0.1)) {
            provider.setCardBehaviour(pick(tokens), pick<CardBehaviour>(['succeed', 'succeed', 'decline', 'insufficient_funds']));
          }
          if (chance(0.05)) {
            const paid = (await engine.listInvoices({ status: 'paid' })).filter((i) => i.amountPaid > 0 && i.amountRefunded === 0);
            const invoice = paid.length > 0 ? await engine.getInvoice(pick(paid).id) : null;
            // The fake provider still knows a late capture as declined and would refuse to refund it.
            if (invoice && !invoice.payments.some((p) => capturedLater.has(p.providerPaymentId ?? ''))) {
              await attempt(() => engine.refundInvoice(invoice.invoice.id, world.now));
            }
          }
          if (chance(0.15)) provider.setMode(pick(['sync', 'async'] as const));
          if (chance(0.06)) provider.injectFault(pick(['unavailable_before_processing', 'unavailable_after_processing'] as const));

          held.push(...provider.drainEvents());
          if (chance(0.7)) {
            const batch = held.splice(0, held.length);
            if (chance(0.3)) batch.reverse();
            if (chance(0.3) && batch.length > 0) batch.push(pick(batch));
            if (chance(0.3)) await Promise.all(batch.map((event) => engine.receiveProviderEvent(event, world.now)));
            else for (const event of batch) await engine.receiveProviderEvent(event, world.now);
            failures.push(...batch.filter((event) => event.type === 'payment.failed'));
          }
          if (failures.length > 0 && chance(0.04)) {
            // A decline the provider later turns into a capture: the money arrives after the invoice moved on.
            const failed = failures.splice(Math.floor(random.next() * failures.length), 1)[0]!;
            const object = { ...failed.data.object, status: 'succeeded', failure_code: null };
            capturedLater.add(String(failed.data.object.id));
            await engine.receiveProviderEvent({ ...failed, id: `${failed.id}_captured`, type: 'payment.succeeded', data: { object } }, world.now);
          }

          const step = chance(0.15) ? (1 + Math.floor(random.next() * 23)) * 60 * MINUTE_MS : 24 * 60 * MINUTE_MS;
          const next = new Date(world.now.getTime() + step);
          if (chance(0.2)) {
            // Two workers racing over the same due work before the clock moves.
            const reports = await Promise.all([engine.runDueWork(next), world.anotherWorker().runDueWork(next)]);
            expect(reports.flatMap((report) => report.errors)).toEqual([]);
          }
          await world.advanceTo(next);
          for (const problem of await findInvariantViolations(world, { capturedLater })) violations.push(`${utcDay(world.now)}: ${problem}`);
        }
        expect(violations).toEqual([]);
        expect(customers.length).toBeGreaterThan(8);
        expect((await engine.journal({ kind: 'write_off' })).length).toBeGreaterThan(0);
        expect((await engine.listInvoices({})).filter((i) => i.kind === 'proration').length).toBeGreaterThan(0);
        expectGaplessNumbers(await engine.listInvoices({}));
      },
      180_000,
    );
  });
}
