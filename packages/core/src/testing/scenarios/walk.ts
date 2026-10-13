import { describe, expect, it } from 'vitest';
import { utcDay } from '../../calendar.js';
import { at, expectGaplessNumbers, useStore, type StoreFactory } from '../harness.js';
import { BillingWorld } from '../world.js';

export function walkScenarios(factory: StoreFactory): void {
  describe('long runs', () => {
    const store = useStore(factory);

    it(
      'walks 13 months with an upgrade and a downgrade and keeps the trial balance at zero every day',
      async () => {
        const world = await BillingWorld.create(store(), at('2026-01-31T08:00:00Z'));
        const { engine } = world;
        const a = await world.customer('Aster Robotics', 'RUB', 'succeeds');
        const b = await world.customer('Bramble Studio', 'EUR', 'succeeds');
        const c = await world.customer('Cinder Freight', 'RUB', 'declined');
        const d = await world.customer('Dune Analytics', 'EUR', 'insufficientFunds');
        const e = await world.customer('Elm Street Dental', 'RUB', 'succeeds');

        const subA = await engine.createSubscription({ customerId: a.customer.id, planId: 'plan_team_monthly' }, world.now);
        const subB = await engine.createSubscription({ customerId: b.customer.id, planId: 'plan_team_yearly' }, world.now);
        const subC = await engine.createSubscription({ customerId: c.customer.id, planId: 'plan_starter_monthly' }, world.now);
        const subD = await engine.createSubscription({ customerId: d.customer.id, planId: 'plan_business_monthly' }, world.now);
        const subE = await engine.createSubscription({ customerId: e.customer.id, planId: 'plan_starter_monthly' }, world.now);

        const actions: Record<string, () => Promise<unknown>> = {
          '2026-02-03': () => world.attachCard(d.customer.id, 'succeeds'),
          '2026-04-10': () => engine.changePlan(subA.id, 'plan_business_monthly', world.now),
          '2026-05-20': () => engine.cancelAtPeriodEnd(subE.id, world.now),
          '2026-08-25': () => engine.changePlan(subA.id, 'plan_starter_monthly', world.now),
        };
        const unbalancedDays: string[] = [];
        const end = at('2027-03-01T08:00:00Z');
        while (world.now < end) {
          await actions[utcDay(world.now)]?.();
          await world.advanceDays(1);
          if (!(await engine.trialBalance()).balanced) unbalancedDays.push(utcDay(world.now));
        }
        expect(unbalancedDays).toEqual([]);

        const statuses = await Promise.all([subA, subB, subC, subD, subE].map(async (s) => (await engine.getSubscription(s.id)).status));
        expect(statuses).toEqual(['active', 'active', 'canceled', 'active', 'canceled']);

        const invoicesA = await engine.listInvoices({ subscriptionId: subA.id });
        expect(invoicesA.filter((i) => i.kind === 'proration')).toHaveLength(1);
        expect(invoicesA.every((i) => i.status === 'paid')).toBe(true);
        // The downgrade credit is larger than a Starter invoice, so it is spent over several renewals.
        const [downgrade] = await engine.journal({ kind: 'downgrade_credit' });
        const granted = downgrade!.entries.find((entry) => entry.amount > 0)!.amount;
        expect(invoicesA.filter((i) => i.creditApplied > 0).length).toBeGreaterThan(1);
        expect(invoicesA.reduce((sum, i) => sum + i.creditApplied, 0)).toBe(granted);
        expect(await world.balance(`customer_credit:${a.customer.id}`)).toBe(0);

        const yearly = (await engine.listInvoices({ subscriptionId: subB.id })).map((i) => i.periodStart.toISOString()).sort();
        expect(yearly).toEqual(['2026-01-31T08:00:00.000Z', '2027-01-31T08:00:00.000Z']);

        expect(await world.balance('bad_debt:RUB')).toBe(99_000);
        expect((await engine.getSubscription(subE.id)).endedAt).toEqual(at('2026-06-14T08:00:00Z'));

        const all = await engine.listInvoices({});
        expectGaplessNumbers(all);
        expect(all.some((i) => i.number?.startsWith('LL-2027-'))).toBe(true);
        for (const account of await engine.ledgerAccounts()) {
          if (account.account.kind === 'accounts_receivable') expect(account.balance, account.account.id).toBe(0);
        }
      },
      120_000,
    );

    it('reports MRR, counts, churn and daily revenue from the same data', async () => {
      const world = await BillingWorld.create(store(), at('2026-06-01T00:00:00Z'));
      const { engine } = world;
      const plan = async (name: string, currency: 'RUB' | 'EUR', card: 'succeeds' | 'declined', planId: string) => {
        const { customer } = await world.customer(name, currency, card);
        return engine.createSubscription({ customerId: customer.id, planId }, world.now);
      };
      await plan('Alder Clinic', 'RUB', 'succeeds', 'plan_business_monthly');
      await plan('Birch Ledger', 'RUB', 'succeeds', 'plan_team_yearly');
      await plan('Cedar Kids', 'RUB', 'succeeds', 'plan_starter_monthly');
      await plan('Dogwood Labs', 'EUR', 'succeeds', 'plan_business_yearly');
      await plan('Elder Logistics', 'EUR', 'declined', 'plan_business_monthly');
      const trialToCancel = await plan('Fir Notes', 'RUB', 'succeeds', 'plan_team_monthly');
      await engine.cancelAtPeriodEnd(trialToCancel.id, world.now);

      const today = await engine.metrics(world.now);
      expect(today.mrr).toEqual([
        { currency: 'RUB', amount: 990_000 + Math.round(2_990_000 / 12) },
        { currency: 'EUR', amount: 99_000 / 12 + 9_900 },
      ]);
      expect(today.subscriptions).toEqual({ trialing: 2, active: 3, past_due: 1, canceled: 0 });
      expect(today.churnedLast30Days).toBe(0);
      expect(today.revenueByDay).toEqual([
        { day: '2026-06-01', currency: 'EUR', amount: 99_000 + 9_900 },
        { day: '2026-06-01', currency: 'RUB', amount: 990_000 + 2_990_000 },
      ]);

      await world.advanceDays(15);
      const later = await engine.metrics(world.now);
      expect(later.subscriptions).toEqual({ trialing: 0, active: 4, past_due: 0, canceled: 2 });
      expect(later.churnedLast30Days).toBe(2);
      expect(later.mrr).toEqual([
        { currency: 'RUB', amount: 990_000 + 99_000 + Math.round(2_990_000 / 12) },
        { currency: 'EUR', amount: 99_000 / 12 },
      ]);
      const balances = await world.balances();
      for (const currency of ['RUB', 'EUR'] as const) {
        const fromDays = later.revenueByDay.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.amount, 0);
        expect(fromDays).toBe(-(balances[`revenue:${currency}`] ?? 0));
      }
    });
  });
}
