import { periodBoundary, addDays, truncateToSecond } from '../calendar.js';
import { BillingError } from '../errors.js';
import { newId } from '../ids.js';
import { cycleLines } from '../invoice.js';
import { priceFor } from '../plans.js';
import type { Subscription } from '../subscription.js';
import { executeCharge, startPayment, type ChargeIntent } from './charging.js';
import type { EngineContext } from './context.js';
import { findReplay, rememberResult } from './idempotency.js';
import { issueInvoice } from './invoicing.js';
import { requireCustomer, requirePlan, requireSubscription } from './lookups.js';

export interface NewSubscription {
  customerId: string;
  planId: string;
}

/**
 * With a trial the billing anchor is the trial end and nothing is charged
 * yet. Without one the first period starts now and is invoiced and charged
 * immediately, so a payment method is required up front.
 */
export async function createSubscription(
  ctx: EngineContext,
  input: NewSubscription,
  now: Date,
  idempotencyKey?: string,
): Promise<Subscription> {
  const fingerprint = JSON.stringify([input.customerId, input.planId]);
  const created = await ctx.store.run(async (tx): Promise<{ id: string; intent: ChargeIntent | null }> => {
    if (idempotencyKey !== undefined) {
      const replay = await findReplay(tx, 'subscriptions.create', idempotencyKey, fingerprint);
      if (replay) return { id: replay, intent: null };
    }
    const customer = await requireCustomer(tx, input.customerId, 'for_update');
    const plan = await requirePlan(tx, input.planId);
    const price = priceFor(plan, customer.currency);
    const start = truncateToSecond(now);
    const base = {
      id: newId('sub'),
      customerId: customer.id,
      planId: plan.id,
      currency: customer.currency,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    let intent: ChargeIntent | null = null;
    if (plan.trialDays > 0) {
      const trialEnd = addDays(start, plan.trialDays);
      await tx.insertSubscription({
        ...base,
        status: 'trialing',
        billingAnchor: trialEnd,
        paidCycles: 0,
        currentPeriodStart: start,
        currentPeriodEnd: trialEnd,
        trialEnd,
      });
    } else {
      if (price > 0 && customer.defaultPaymentMethodId === null) {
        throw new BillingError('payment_method_required', 'attach a payment method before subscribing to a plan without a trial');
      }
      const end = periodBoundary(start, plan.interval, 1);
      const subscription: Subscription = {
        ...base,
        status: 'active',
        billingAnchor: start,
        paidCycles: 1,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        trialEnd: null,
      };
      await tx.insertSubscription(subscription);
      const invoice = await issueInvoice(tx, customer, {
        subscription,
        kind: 'cycle',
        periodStart: start,
        periodEnd: end,
        lines: cycleLines({ plan, price, periodStart: start, periodEnd: end }),
        now,
      });
      intent = await startPayment(ctx, tx, { subscription, customer, invoice, trigger: 'initial', now });
    }
    if (idempotencyKey !== undefined) {
      await rememberResult(tx, { scope: 'subscriptions.create', key: idempotencyKey, fingerprint, resourceId: base.id, now });
    }
    return { id: base.id, intent };
  });

  if (created.intent) await executeCharge(ctx, created.intent, now);
  return ctx.store.run((tx) => requireSubscription(tx, created.id));
}

export async function setCancelAtPeriodEnd(ctx: EngineContext, subscriptionId: string, cancel: boolean, now: Date): Promise<Subscription> {
  return ctx.store.run(async (tx) => {
    const subscription = await requireSubscription(tx, subscriptionId, 'for_update');
    if (subscription.status === 'canceled') {
      throw new BillingError('invalid_transition', `subscription ${subscriptionId} has already ended`);
    }
    const updated = { ...subscription, cancelAtPeriodEnd: cancel, updatedAt: now };
    await tx.updateSubscription(updated);
    return updated;
  });
}
