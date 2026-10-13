import { truncateToSecond } from '../calendar.js';
import { BillingError } from '../errors.js';
import type { Invoice, InvoiceLine } from '../invoice.js';
import { postings } from '../ledger.js';
import type { Currency } from '../money.js';
import { priceFor } from '../plans.js';
import type { StoreTx } from '../ports/store.js';
import { quotePlanChange } from '../proration.js';
import type { Subscription } from '../subscription.js';
import { executeCharge, startPayment, type ChargeIntent } from './charging.js';
import type { EngineContext } from './context.js';
import { issueInvoice } from './invoicing.js';
import { post } from './ledger-ops.js';
import { requireCustomer, requireInvoice, requirePlan, requireSubscription } from './lookups.js';

export type PlanChangeEffect = 'invoice_now' | 'customer_credit' | 'no_charge' | 'trial_switch';

export interface PlanChangePreview {
  subscriptionId: string;
  currency: Currency;
  fromPlanId: string;
  toPlanId: string;
  changeAt: Date;
  periodStart: Date;
  periodEnd: Date;
  credit: number;
  charge: number;
  net: number;
  effect: PlanChangeEffect;
  lines: InvoiceLine[];
}

async function quote(tx: StoreTx, subscription: Subscription, toPlanId: string, now: Date): Promise<PlanChangePreview> {
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    throw new BillingError('subscription_not_changeable', `a ${subscription.status} subscription cannot change plans`);
  }
  if (toPlanId === subscription.planId) {
    throw new BillingError('same_plan', 'the subscription is already on this plan');
  }
  const from = await requirePlan(tx, subscription.planId);
  const to = await requirePlan(tx, toPlanId);
  if (from.interval !== to.interval) {
    throw new BillingError('interval_mismatch', 'plan changes keep the billing interval; cancel and resubscribe to switch it');
  }
  const base = {
    subscriptionId: subscription.id,
    currency: subscription.currency,
    fromPlanId: from.id,
    toPlanId: to.id,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
  };
  const toPrice = priceFor(to, subscription.currency);
  if (subscription.status === 'trialing') {
    return { ...base, changeAt: truncateToSecond(now), credit: 0, charge: 0, net: 0, effect: 'trial_switch', lines: [] };
  }
  const q = quotePlanChange({
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    changeAt: now,
    from: { planId: from.id, name: from.name, price: priceFor(from, subscription.currency) },
    to: { planId: to.id, name: to.name, price: toPrice },
  });
  const effect: PlanChangeEffect = q.net > 0 ? 'invoice_now' : q.net < 0 ? 'customer_credit' : 'no_charge';
  return { ...base, changeAt: q.changeAt, credit: q.credit, charge: q.charge, net: q.net, effect, lines: q.lines };
}

export async function previewPlanChange(ctx: EngineContext, subscriptionId: string, toPlanId: string, now: Date): Promise<PlanChangePreview> {
  return ctx.store.run(async (tx) => quote(tx, await requireSubscription(tx, subscriptionId), toPlanId, now));
}

/**
 * Applies exactly what the preview shows: an upgrade is invoiced and charged
 * now, a downgrade becomes customer credit that the next invoice spends.
 */
export async function changePlan(
  ctx: EngineContext,
  subscriptionId: string,
  toPlanId: string,
  now: Date,
): Promise<{ subscription: Subscription; preview: PlanChangePreview; invoice: Invoice | null }> {
  const applied = await ctx.store.run(async (tx) => {
    const subscription = await requireSubscription(tx, subscriptionId, 'for_update');
    const customer = await requireCustomer(tx, subscription.customerId, 'for_update');
    const preview = await quote(tx, subscription, toPlanId, now);
    const updated: Subscription = { ...subscription, planId: toPlanId, updatedAt: now };
    await tx.updateSubscription(updated);

    let invoiceId: string | null = null;
    let intent: ChargeIntent | null = null;
    if (preview.effect === 'invoice_now') {
      const invoice = await issueInvoice(tx, customer, ctx.ids, {
        subscription: updated,
        kind: 'proration',
        periodStart: preview.changeAt,
        periodEnd: preview.periodEnd,
        lines: preview.lines,
        now,
      });
      invoiceId = invoice.id;
      intent = await startPayment(ctx, tx, { subscription: updated, customer, invoice, trigger: 'initial', now });
    } else if (preview.effect === 'customer_credit') {
      await post(
        tx,
        postings.downgradeCredit({
          customerId: customer.id,
          currency: subscription.currency,
          subscriptionId: subscription.id,
          amount: -preview.net,
        }),
        now,
        ctx.ids,
      );
    }
    return { preview, invoiceId, intent };
  });

  if (applied.intent) await executeCharge(ctx, applied.intent, now);
  return ctx.store.run(async (tx) => ({
    subscription: await requireSubscription(tx, subscriptionId),
    preview: applied.preview,
    invoice: applied.invoiceId === null ? null : await requireInvoice(tx, applied.invoiceId),
  }));
}
