import { describe, expect, it } from 'vitest';
import { at, expectBalancedLedger, useStore, type StoreFactory } from '../harness.js';
import { BillingWorld } from '../world.js';

export function planChangeScenarios(factory: StoreFactory): void {
  describe('plan changes', () => {
    const store = useStore(factory);

    it('invoices an upgrade now and turns a downgrade into credit for the next invoice', async () => {
      const world = await BillingWorld.create(store(), at('2026-02-01T00:00:00Z'));
      const { customer } = await world.customer('Wayfarer Maps', 'EUR', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_starter_monthly' }, world.now);
      await world.advanceTo(at('2026-02-22T00:00:00Z'));
      // Period is Feb 15 - Mar 15 (28 days); 21 days are left.
      const upgrade = await world.engine.previewPlanChange(subscription.id, 'plan_team_monthly', world.now);
      expect(upgrade).toMatchObject({ effect: 'invoice_now', credit: 675, charge: 2_175, net: 1_500 });
      expect(upgrade.lines.map((l) => [l.kind, l.description, l.amount])).toEqual([
        ['proration_credit', 'Unused time on Starter', -675],
        ['proration_charge', 'Remaining time on Team', 2_175],
      ]);

      const applied = await world.engine.changePlan(subscription.id, 'plan_team_monthly', world.now);
      expect(applied.subscription.planId).toBe('plan_team_monthly');
      expect(applied.invoice).toMatchObject({ kind: 'proration', status: 'paid', total: 1_500, periodStart: at('2026-02-22T00:00:00Z') });
      expect(applied.invoice!.lines).toEqual(upgrade.lines);

      await world.advanceTo(at('2026-03-08T00:00:00Z'));
      const downgrade = await world.engine.previewPlanChange(subscription.id, 'plan_starter_monthly', world.now);
      expect(downgrade).toMatchObject({ effect: 'customer_credit', credit: 725, charge: 225, net: -500 });
      const afterDowngrade = await world.engine.changePlan(subscription.id, 'plan_starter_monthly', world.now);
      expect(afterDowngrade.invoice).toBeNull();
      expect(await world.balance(`customer_credit:${customer.id}`)).toBe(-500);

      await world.advanceTo(at('2026-03-16T00:00:00Z'));
      const [renewal] = await world.engine.listInvoices({ subscriptionId: subscription.id });
      expect(renewal).toMatchObject({ kind: 'cycle', total: 900, creditApplied: 500, amountDue: 400, amountPaid: 400, status: 'paid' });
      expect(await world.balances()).toMatchObject({
        [`customer_credit:${customer.id}`]: 0,
        [`receivable:${customer.id}`]: 0,
        'revenue:EUR': -(900 + 1_500 - 500 + 900),
        'provider_clearing:EUR': 900 + 1_500 + 400,
      });
      await expectBalancedLedger(world.engine);
    });

    it('switches plans during a trial without moving money', async () => {
      const world = await BillingWorld.create(store(), at('2026-02-01T00:00:00Z'));
      const { customer } = await world.customer('Juniper Events', 'RUB', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_starter_monthly' }, world.now);
      const result = await world.engine.changePlan(subscription.id, 'plan_team_monthly', world.now);
      expect(result.preview).toMatchObject({ effect: 'trial_switch', net: 0, lines: [] });
      expect(result.subscription).toMatchObject({ status: 'trialing', planId: 'plan_team_monthly' });
      expect(await world.engine.journal()).toHaveLength(0);
    });

    it('refuses changes it cannot price', async () => {
      const world = await BillingWorld.create(store(), at('2026-02-01T00:00:00Z'));
      const { customer } = await world.customer('Copperline', 'RUB', 'succeeds');
      const monthly = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
      await expect(world.engine.previewPlanChange(monthly.id, 'plan_business_monthly', world.now)).rejects.toMatchObject({ code: 'same_plan' });
      await expect(world.engine.changePlan(monthly.id, 'plan_team_yearly', world.now)).rejects.toMatchObject({ code: 'interval_mismatch' });
      await expect(world.engine.changePlan(monthly.id, 'plan_missing', world.now)).rejects.toMatchObject({ code: 'not_found' });

      const { customer: declined } = await world.customer('Slate Rooms', 'RUB', 'declined');
      const pastDue = await world.engine.createSubscription({ customerId: declined.id, planId: 'plan_business_monthly' }, world.now);
      await expect(world.engine.changePlan(pastDue.id, 'plan_starter_monthly', world.now)).rejects.toMatchObject({
        code: 'subscription_not_changeable',
      });
    });
  });
}
