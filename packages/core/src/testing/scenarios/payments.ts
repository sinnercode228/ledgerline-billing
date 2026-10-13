import { describe, expect, it } from 'vitest';
import { MINUTE_MS } from '../../calendar.js';
import type { PayrailEvent } from '../../payrail/events.js';
import { at, expectBalancedLedger, useStore, type StoreFactory } from '../harness.js';
import { BillingWorld } from '../world.js';

function asEvent(event: PayrailEvent, changes: { id: string; type: string; status: string; failure_code: string | null }): PayrailEvent {
  return {
    ...event,
    id: changes.id,
    type: changes.type,
    data: { object: { ...event.data.object, status: changes.status, failure_code: changes.failure_code } },
  };
}

export function paymentScenarios(factory: StoreFactory): void {
  describe('payments and webhooks', () => {
    const store = useStore(factory);

    async function paidSubscription(world: BillingWorld) {
      const { customer } = await world.customer('Halcyon Docs', 'EUR', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
      const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      return { customer, subscription, invoice: invoice! };
    }

    it('processes a redelivered webhook once, even when both copies arrive together', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      world.provider.setMode('async');
      const { invoice } = await paidSubscription(world);
      expect(invoice.status).toBe('open');
      const { payments } = await world.engine.getInvoice(invoice.id);
      expect(payments).toMatchObject([{ status: 'pending', attempt: 1 }]);
      expect(payments[0]!.providerPaymentId).not.toBeNull();

      const [event] = world.provider.drainEvents();
      const results = await Promise.all([world.engine.receiveProviderEvent(event!, world.now), world.engine.receiveProviderEvent(event!, world.now)]);
      expect(results.filter((r) => r.duplicate)).toHaveLength(1);
      expect(results.find((r) => !r.duplicate)?.outcome).toBe('applied');
      expect(await world.engine.receiveProviderEvent(event!, world.now)).toEqual({ duplicate: true, outcome: null });

      expect((await world.engine.getInvoice(invoice.id)).invoice).toMatchObject({ status: 'paid', amountPaid: 9_900 });
      expect(await world.balance('provider_clearing:EUR')).toBe(9_900);
      expect(await world.engine.listWebhookEvents()).toHaveLength(1);
    });

    it('treats the webhook for an already applied synchronous answer as a no-op', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      const { invoice } = await paidSubscription(world);
      expect(invoice.status).toBe('paid');
      const before = await world.balances();
      expect(await world.deliverEvents()).toEqual([{ duplicate: false, outcome: 'duplicate_payment_update' }]);
      expect(await world.balances()).toEqual(before);
    });

    it('ignores a failure that arrives after the success, and records it', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      const { invoice, subscription } = await paidSubscription(world);
      const [succeeded] = world.provider.drainEvents();
      const lateFailure = asEvent(succeeded!, { id: 'evt_late_failure', type: 'payment.failed', status: 'failed', failure_code: 'card_declined' });

      expect(await world.engine.receiveProviderEvent(lateFailure, world.now)).toEqual({ duplicate: false, outcome: 'stale_payment_update' });
      const { invoice: after, payments } = await world.engine.getInvoice(invoice.id);
      expect(after.status).toBe('paid');
      expect(payments).toMatchObject([{ status: 'succeeded', failureCode: null }]);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('active');
      const [record] = await world.engine.listWebhookEvents();
      expect(record).toMatchObject({ providerEventId: 'evt_late_failure', outcome: 'stale_payment_update' });
      expect(record!.note).toMatch(/already succeeded/);
    });

    it('lets a success overtake an earlier failure of the same payment', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      const { customer } = await world.customer('Marigold Supply', 'RUB', 'declined');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('past_due');
      const [failed] = world.provider.drainEvents();
      const success = asEvent(failed!, { id: 'evt_recovered', type: 'payment.succeeded', status: 'succeeded', failure_code: null });

      expect(await world.engine.receiveProviderEvent(success, world.now)).toMatchObject({ outcome: 'applied' });
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('active');
      await world.advanceDays(6);
      const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      expect(invoice).toMatchObject({ status: 'paid', attemptCount: 1, nextRetryAt: null });
      await expectBalancedLedger(world.engine);
    });

    it('resolves an event for a payment it never linked through the invoice in the metadata', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      world.provider.injectFault('unavailable_after_processing');
      const { invoice, subscription } = await paidSubscription(world);
      const { payments } = await world.engine.getInvoice(invoice.id);
      expect(payments).toMatchObject([{ status: 'pending', providerPaymentId: null }]);

      const results = await world.deliverEvents();
      expect(results).toEqual([{ duplicate: false, outcome: 'applied' }]);
      const settled = await world.engine.getInvoice(invoice.id);
      expect(settled.invoice.status).toBe('paid');
      expect(settled.payments[0]!.providerPaymentId).toMatch(/^pay_/);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('active');
    });

    it('asks again with the same idempotency key when an answer was lost, without charging twice', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      world.provider.injectFault('unavailable_after_processing');
      const { invoice } = await paidSubscription(world);
      world.provider.drainEvents();

      const report = await world.engine.runDueWork(new Date(world.now.getTime() + 15 * MINUTE_MS));
      expect(report.recoveredPayments).toBe(1);
      expect((await world.engine.getInvoice(invoice.id)).invoice.status).toBe('paid');
      expect(world.provider.succeededCharges().filter((c) => c.invoiceId === invoice.id)).toHaveLength(1);
    });

    it('sends a payment the provider never received once the provider is back', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      world.provider.injectFault('unavailable_before_processing');
      const { invoice } = await paidSubscription(world);
      expect(world.provider.succeededCharges()).toHaveLength(0);
      expect((await world.engine.runDueWork(new Date(world.now.getTime() + 5 * MINUTE_MS))).recoveredPayments).toBe(0);

      await world.engine.runDueWork(new Date(world.now.getTime() + 11 * MINUTE_MS));
      expect((await world.engine.getInvoice(invoice.id)).invoice.status).toBe('paid');
      expect(world.provider.succeededCharges()).toHaveLength(1);
    });

    it('stores and acknowledges events it does not handle', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      const results = [
        await world.engine.receiveProviderEvent({ id: 'evt_card_updated', type: 'payment_method.updated', created: 1, data: { object: {} } }, world.now),
        await world.engine.receiveProviderEvent({ id: 'evt_bad_shape', type: 'payment.succeeded', created: 1, data: { object: { id: 42 } } }, world.now),
        await world.engine.receiveProviderEvent(
          {
            id: 'evt_stranger',
            type: 'payment.succeeded',
            created: 1,
            data: {
              object: {
                object: 'payment',
                id: 'pay_unknown',
                amount: 100,
                currency: 'EUR',
                status: 'succeeded',
                failure_code: null,
                metadata: { invoice_id: 'in_missing', attempt: '1' },
              },
            },
          },
          world.now,
        ),
      ];
      expect(results.map((r) => r.outcome)).toEqual(['ignored_type', 'malformed', 'unmatched']);
      expect(await world.engine.listWebhookEvents()).toHaveLength(3);
    });

    it('refunds a paid invoice once and reverses the revenue', async () => {
      const world = await BillingWorld.create(store(), at('2026-05-04T08:00:00Z'));
      const { invoice } = await paidSubscription(world);
      const refunded = await world.engine.refundInvoice(invoice.id, world.now);
      expect(refunded.amountRefunded).toBe(9_900);
      expect(await world.engine.refundInvoice(invoice.id, world.now)).toMatchObject({ amountRefunded: 9_900 });
      expect(await world.balances()).toMatchObject({ 'revenue:EUR': 0, 'provider_clearing:EUR': 0 });
      expect((await world.engine.journal({ kind: 'refund' })).length).toBe(1);
      await expectBalancedLedger(world.engine);
    });
  });

  describe('dunning', () => {
    const store = useStore(factory);

    it('retries 1, 3 and 5 days after the first failure, then cancels and writes off', async () => {
      const world = await BillingWorld.create(store(), at('2026-03-10T12:00:00Z'));
      const { customer } = await world.customer('Saltmarsh Media', 'RUB', 'declined');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('past_due');
      const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      expect(invoice).toMatchObject({ status: 'open', nextRetryAt: at('2026-03-11T12:00:00Z'), firstFailedAt: at('2026-03-10T12:00:00Z') });

      await world.advanceDays(4);
      expect((await world.engine.getInvoice(invoice!.id)).invoice).toMatchObject({ status: 'open', nextRetryAt: at('2026-03-15T12:00:00Z') });
      await world.advanceDays(1);

      const { invoice: closed, payments } = await world.engine.getInvoice(invoice!.id);
      expect(closed).toMatchObject({ status: 'uncollectible', uncollectibleAt: at('2026-03-15T12:00:00Z'), nextRetryAt: null });
      expect(payments.map((p) => [p.attempt, p.trigger, p.status, p.failureCode, p.createdAt.toISOString()])).toEqual([
        [1, 'initial', 'failed', 'card_declined', '2026-03-10T12:00:00.000Z'],
        [2, 'scheduled_retry', 'failed', 'card_declined', '2026-03-11T12:00:00.000Z'],
        [3, 'scheduled_retry', 'failed', 'card_declined', '2026-03-13T12:00:00.000Z'],
        [4, 'scheduled_retry', 'failed', 'card_declined', '2026-03-15T12:00:00.000Z'],
      ]);
      expect(await world.engine.getSubscription(subscription.id)).toMatchObject({ status: 'canceled', endedAt: at('2026-03-15T12:00:00Z') });
      expect(await world.balances()).toMatchObject({
        [`receivable:${customer.id}`]: 0,
        'bad_debt:RUB': 990_000,
        'revenue:RUB': -990_000,
      });

      await world.advanceDays(40);
      expect(await world.engine.listInvoices({ subscriptionId: subscription.id })).toHaveLength(1);
      await expectBalancedLedger(world.engine);
    });

    it('recovers when a scheduled retry succeeds', async () => {
      const world = await BillingWorld.create(store(), at('2026-03-10T12:00:00Z'));
      const { customer, method } = await world.customer('Fernhill Clinic', 'EUR', 'insufficientFunds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('past_due');

      world.provider.setCardBehaviour(method!.providerToken, 'succeed');
      await world.advanceDays(1);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('active');
      const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      const { payments } = await world.engine.getInvoice(invoice!.id);
      expect(payments.map((p) => [p.trigger, p.status])).toEqual([
        ['initial', 'failed'],
        ['scheduled_retry', 'succeeded'],
      ]);
    });

    it('retries immediately when a new card is attached', async () => {
      const world = await BillingWorld.create(store(), at('2026-03-10T12:00:00Z'));
      const { customer } = await world.customer('Orchid Payroll', 'RUB', 'insufficientFunds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('past_due');

      await world.attachCard(customer.id, 'succeeds');
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('active');
      const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      expect(invoice!.status).toBe('paid');

      await world.advanceDays(6);
      const { payments } = await world.engine.getInvoice(invoice!.id);
      expect(payments.map((p) => [p.trigger, p.status])).toEqual([
        ['initial', 'failed'],
        ['payment_method_updated', 'succeeded'],
      ]);
    });

    it('reverses the write-off when the money arrives after all', async () => {
      const world = await BillingWorld.create(store(), at('2026-03-10T12:00:00Z'));
      const { customer } = await world.customer('Gristmill Tools', 'RUB', 'declined');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_starter_monthly' }, world.now);
      await world.advanceDays(20);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('canceled');
      const events = world.provider.drainEvents();
      const lastFailure = events.at(-1)!;

      const late = asEvent(lastFailure, { id: 'evt_paid_late', type: 'payment.succeeded', status: 'succeeded', failure_code: null });
      expect(await world.engine.receiveProviderEvent(late, world.now)).toMatchObject({ outcome: 'applied' });
      const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      expect(invoice).toMatchObject({ status: 'paid', amountPaid: 99_000 });
      expect(await world.balances()).toMatchObject({ 'bad_debt:RUB': 0, [`receivable:${customer.id}`]: 0, 'provider_clearing:RUB': 99_000 });
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('canceled');
      await expectBalancedLedger(world.engine);
    });
  });
}
