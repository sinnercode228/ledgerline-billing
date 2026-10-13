import { describe, expect, it } from 'vitest';
import { addDays } from '../../calendar.js';
import { at, expectBalancedLedger, expectGaplessNumbers, useStore, type StoreFactory } from '../harness.js';
import { BillingWorld } from '../world.js';

export function lifecycleScenarios(factory: StoreFactory): void {
  describe('subscription lifecycle', () => {
    const store = useStore(factory);

    it('turns a trial into a paid period exactly at the trial end', async () => {
      const world = await BillingWorld.create(store(), at('2026-01-31T09:00:00Z'));
      const { customer } = await world.customer('Borealis Analytics', 'RUB', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_team_monthly' }, world.now);
      expect(subscription).toMatchObject({ status: 'trialing', trialEnd: at('2026-02-14T09:00:00Z'), billingAnchor: at('2026-02-14T09:00:00Z') });

      await world.advanceDays(13);
      expect((await world.engine.getSubscription(subscription.id)).status).toBe('trialing');
      expect(await world.engine.listInvoices({ subscriptionId: subscription.id })).toHaveLength(0);

      await world.advanceDays(1);
      const converted = await world.engine.getSubscription(subscription.id);
      expect(converted).toMatchObject({
        status: 'active',
        currentPeriodStart: at('2026-02-14T09:00:00Z'),
        currentPeriodEnd: at('2026-03-14T09:00:00Z'),
      });
      const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      expect(invoice).toMatchObject({ number: 'LL-2026-000001', status: 'paid', total: 299_000, amountPaid: 299_000, kind: 'cycle' });
      expect(await world.balances()).toMatchObject({
        [`receivable:${customer.id}`]: 0,
        'revenue:RUB': -299_000,
        'provider_clearing:RUB': 299_000,
      });
      await expectBalancedLedger(world.engine);
    });

    it('renews on the anchor day and clamps it to shorter months', async () => {
      const world = await BillingWorld.create(store(), at('2026-01-31T10:00:00Z'));
      const { customer } = await world.customer('Pinegrove Studio', 'RUB', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
      await world.advanceTo(at('2026-05-01T00:00:00Z'));

      const invoices = (await world.engine.listInvoices({ subscriptionId: subscription.id })).reverse();
      expect(invoices.map((i) => [i.number, i.periodStart.toISOString(), i.periodEnd.toISOString(), i.status])).toEqual([
        ['LL-2026-000001', '2026-01-31T10:00:00.000Z', '2026-02-28T10:00:00.000Z', 'paid'],
        ['LL-2026-000002', '2026-02-28T10:00:00.000Z', '2026-03-31T10:00:00.000Z', 'paid'],
        ['LL-2026-000003', '2026-03-31T10:00:00.000Z', '2026-04-30T10:00:00.000Z', 'paid'],
        ['LL-2026-000004', '2026-04-30T10:00:00.000Z', '2026-05-31T10:00:00.000Z', 'paid'],
      ]);
    });

    it('requires a payment method for a plan without a trial', async () => {
      const world = await BillingWorld.create(store(), at('2026-02-01T00:00:00Z'));
      const { customer } = await world.customer('Tundra Freight Ops', 'EUR');
      await expect(world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now)).rejects.toMatchObject({
        code: 'payment_method_required',
      });
      expect(await world.engine.listSubscriptions({ customerId: customer.id })).toHaveLength(0);
    });

    it('cancels at the period end, and can be resumed until then', async () => {
      const world = await BillingWorld.create(store(), at('2026-04-30T00:00:00Z'));
      const { customer } = await world.customer('Kettle & Co', 'EUR', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);

      expect((await world.engine.cancelAtPeriodEnd(subscription.id, world.now)).cancelAtPeriodEnd).toBe(true);
      expect((await world.engine.resume(subscription.id, world.now)).cancelAtPeriodEnd).toBe(false);
      await world.engine.cancelAtPeriodEnd(subscription.id, world.now);
      await world.advanceTo(at('2026-06-02T00:00:00Z'));

      const ended = await world.engine.getSubscription(subscription.id);
      expect(ended).toMatchObject({ status: 'canceled', endedAt: at('2026-05-30T00:00:00Z') });
      expect(await world.engine.listInvoices({ subscriptionId: subscription.id })).toHaveLength(1);
      await expect(world.engine.resume(subscription.id, world.now)).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('ends a trial without billing when it was canceled', async () => {
      const world = await BillingWorld.create(store(), at('2026-03-01T00:00:00Z'));
      const { customer } = await world.customer('Lumen Forms', 'RUB', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_starter_monthly' }, world.now);
      await world.engine.cancelAtPeriodEnd(subscription.id, world.now);
      await world.advanceDays(20);
      expect(await world.engine.getSubscription(subscription.id)).toMatchObject({ status: 'canceled', endedAt: at('2026-03-15T00:00:00Z') });
      expect(await world.engine.listInvoices({ subscriptionId: subscription.id })).toHaveLength(0);
    });

    it('bills a period once when two workers run due work at the same moment', async () => {
      const world = await BillingWorld.create(store(), at('2026-07-01T00:00:00Z'));
      const subscriptions = [];
      for (const name of ['Arbor Labs', 'Brightwell', 'Cobalt Desk', 'Driftwood HR', 'Ember Notes']) {
        const { customer } = await world.customer(name, 'RUB', 'succeeds');
        subscriptions.push(await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_team_monthly' }, world.now));
      }
      const due = addDays(world.now, 14);
      const reports = await Promise.all([world.engine.runDueWork(due), world.anotherWorker().runDueWork(due), world.anotherWorker().runDueWork(due)]);

      expect(reports.reduce((sum, r) => sum + r.trialsEnded, 0)).toBe(5);
      for (const subscription of subscriptions) {
        const invoices = await world.engine.listInvoices({ subscriptionId: subscription.id });
        expect(invoices).toHaveLength(1);
        expect(world.provider.succeededCharges().filter((c) => c.invoiceId === invoices[0]!.id)).toHaveLength(1);
      }
      expectGaplessNumbers(await world.engine.listInvoices({}));
      await expectBalancedLedger(world.engine);
    });

    it('creates each customer and subscription once per Idempotency-Key', async () => {
      const world = await BillingWorld.create(store(), at('2026-08-03T00:00:00Z'));
      const input = { name: 'Quarry Metrics', email: 'ap@quarry.example.com', currency: 'EUR' as const };
      const first = await world.engine.createCustomer(input, world.now, { idempotencyKey: 'key-cus-1' });
      const again = await world.engine.createCustomer(input, world.now, { idempotencyKey: 'key-cus-1' });
      expect(again.id).toBe(first.id);
      await expect(world.engine.createCustomer({ ...input, name: 'Other' }, world.now, { idempotencyKey: 'key-cus-1' })).rejects.toMatchObject({
        code: 'idempotency_conflict',
      });
      expect(await world.engine.listCustomers()).toHaveLength(1);

      await world.attachCard(first.id, 'succeeds');
      const request = { customerId: first.id, planId: 'plan_business_monthly' };
      const [a, b] = await Promise.all([
        world.engine.createSubscription(request, world.now, { idempotencyKey: 'key-sub-1' }),
        world.engine.createSubscription(request, world.now, { idempotencyKey: 'key-sub-1' }),
      ]);
      expect(a.id).toBe(b.id);
      expect(await world.engine.listSubscriptions({ customerId: first.id })).toHaveLength(1);
      expect(world.provider.succeededCharges()).toHaveLength(1);
    });
  });
}
