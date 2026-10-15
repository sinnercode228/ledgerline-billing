import { describe, expect, it } from 'vitest';
import { addDays } from '../../calendar.js';
import { draftInvoice, finalizeInvoice } from '../../engine/invoicing.js';
import { newId } from '../../ids.js';
import { receivableAccount, revenueAccount, type JournalTransaction } from '../../ledger.js';
import type { StoreTx } from '../../ports/store.js';
import { at, expectBalancedLedger, useStore, type StoreFactory } from '../harness.js';
import { BillingWorld } from '../world.js';

export function ledgerScenarios(factory: StoreFactory): void {
  describe('store guarantees', () => {
    const store = useStore(factory);

    async function trialingSubscription(world: BillingWorld) {
      const { customer } = await world.customer('Northbank Tutors', 'RUB', 'succeeds');
      const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_team_monthly' }, world.now);
      return { customer, subscription };
    }

    function brokenTransaction(customerId: string, revenueCurrency: 'RUB' | 'EUR', revenueAmount: number): JournalTransaction {
      return {
        id: newId('jt'),
        kind: 'invoice_finalized',
        currency: 'RUB',
        memo: 'hand-made',
        refs: { customerId, subscriptionId: null, invoiceId: null, paymentId: null, reversesId: null },
        postedAt: at('2026-01-10T00:00:00Z'),
        entries: [
          { accountId: `receivable:${customerId}`, amount: 1_000 },
          { accountId: `revenue:${revenueCurrency}`, amount: revenueAmount },
        ],
      };
    }

    it('refuses to commit a journal transaction that does not balance', async () => {
      const world = await BillingWorld.create(store(), at('2026-01-10T00:00:00Z'));
      const { customer } = await trialingSubscription(world);
      await expect(
        world.store.run(async (tx) => {
          await tx.ensureLedgerAccounts([receivableAccount(customer.id, 'RUB'), revenueAccount('RUB')]);
          await tx.insertJournalTransaction(brokenTransaction(customer.id, 'RUB', -999));
        }),
      ).rejects.toMatchObject({ code: 'unbalanced_transaction' });
      expect(await world.engine.journal()).toHaveLength(0);
    });

    it('refuses to mix currencies in one journal transaction', async () => {
      const world = await BillingWorld.create(store(), at('2026-01-10T00:00:00Z'));
      const { customer } = await trialingSubscription(world);
      await expect(
        world.store.run(async (tx) => {
          await tx.ensureLedgerAccounts([receivableAccount(customer.id, 'RUB'), revenueAccount('EUR')]);
          await tx.insertJournalTransaction(brokenTransaction(customer.id, 'EUR', -1_000));
        }),
      ).rejects.toMatchObject({ code: 'currency_mismatch' });
      expect(await world.engine.journal()).toHaveLength(0);
    });

    it('refuses writes and row locks in a read-only transaction and keeps none of the writes', async () => {
      const world = await BillingWorld.create(store(), at('2026-01-10T00:00:00Z'));
      const { customer, subscription } = await trialingSubscription(world);
      let read = false;
      await expect(
        world.store.run(
          async (tx) => {
            const current = await tx.getCustomer(customer.id);
            read = current !== null;
            await tx.updateCustomer({ ...current!, name: 'Renamed Tutors' });
          },
          { readOnly: true },
        ),
      ).rejects.toThrow(/read-only transaction/);
      expect(read).toBe(true);
      expect((await world.engine.getCustomer(customer.id)).name).toBe('Northbank Tutors');

      // PostgreSQL refuses SELECT ... FOR UPDATE in a read-only transaction, even when no row matches.
      const locks: Array<(tx: StoreTx) => Promise<unknown>> = [
        (tx) => tx.getCustomer(customer.id, 'for_update'),
        (tx) => tx.getSubscription(subscription.id, 'for_update'),
        (tx) => tx.getInvoice('in_none', 'for_update'),
        (tx) => tx.getPayment('pay_none', 'for_update'),
        (tx) => tx.claimDueSubscription(world.now, []),
        (tx) => tx.claimStalePendingPayment(world.now, []),
      ];
      for (const lock of locks) {
        await expect(world.store.run(lock, { readOnly: true })).rejects.toThrow(/read-only transaction/);
      }
    });

    it('refuses to bill the same period twice', async () => {
      const world = await BillingWorld.create(store(), at('2026-01-10T00:00:00Z'));
      const { subscription } = await trialingSubscription(world);
      const period = { periodStart: at('2026-01-24T00:00:00Z'), periodEnd: at('2026-02-24T00:00:00Z') };
      const draft = () => draftInvoice({ id: newId('in'), subscription, kind: 'cycle', ...period, lines: [], now: world.now });
      await world.store.run((tx) => tx.insertInvoice(draft()));
      await expect(world.store.run((tx) => tx.insertInvoice(draft()))).rejects.toMatchObject({ code: 'duplicate_invoice' });
      await world.store.run((tx) => tx.insertInvoice(draftInvoice({ id: newId('in'), subscription, kind: 'proration', ...period, lines: [], now: world.now })));
    });

    it('numbers 20 concurrent finalizations without gaps, even when others roll back', async () => {
      const world = await BillingWorld.create(store(), at('2026-01-10T00:00:00Z'));
      const { customer, subscription } = await trialingSubscription(world);
      const drafts = Array.from({ length: 25 }, (_, i) =>
        draftInvoice({
          id: newId('in'),
          subscription,
          kind: 'cycle',
          periodStart: addDays(world.now, i),
          periodEnd: addDays(world.now, i + 1),
          lines: [{ kind: 'plan', description: 'Team', amount: 1_000, planId: 'plan_team_monthly', periodStart: addDays(world.now, i), periodEnd: addDays(world.now, i + 1) }],
          now: world.now,
        }),
      );
      await world.store.run(async (tx) => {
        for (const draft of drafts) await tx.insertInvoice(draft);
      });

      const results = await Promise.allSettled(
        drafts.map((draft, i) =>
          world.store.run(async (tx) => {
            const finalized = await finalizeInvoice(tx, draft, (await tx.getCustomer(customer.id))!, world.now, newId);
            if (i % 5 === 4) throw new Error('crash after taking a number');
            return finalized.number;
          }),
        ),
      );
      const numbers = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])).sort();
      expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => `LL-2026-${String(i + 1).padStart(6, '0')}`));

      const stillDraft = await world.engine.listInvoices({ status: 'draft' });
      expect(stillDraft).toHaveLength(5);
      const next = await world.store.run(async (tx) => finalizeInvoice(tx, stillDraft[0]!, (await tx.getCustomer(customer.id))!, world.now, newId));
      expect(next.number).toBe('LL-2026-000021');
      await expectBalancedLedger(world.engine);
    });
  });
}
