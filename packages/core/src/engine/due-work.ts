import { cycleLines } from '../invoice.js';
import { priceFor } from '../plans.js';
import type { StoreTx } from '../ports/store.js';
import { nextPeriod, transition, type Subscription } from '../subscription.js';
import { executeCharge, hasPaymentInFlight, retryStalePayments, startPayment, type ChargeIntent } from './charging.js';
import type { EngineContext } from './context.js';
import { issueInvoice } from './invoicing.js';
import { requireCustomer, requirePlan, requireSubscription } from './lookups.js';

export interface DueWorkReport {
  trialsEnded: number;
  renewals: number;
  retries: number;
  canceled: number;
  recoveredPayments: number;
  errors: Array<{ subscriptionId: string; message: string }>;
}

type StepKind = 'trial_ended' | 'renewed' | 'retried' | 'canceled';

interface Step {
  kind: StepKind;
  intents: ChargeIntent[];
}

/** Guards against a bug turning the claim loop into an endless one. */
const MAX_STEPS = 100_000;

/**
 * Processes everything due at `now`, one subscription per transaction.
 * Claims use SKIP LOCKED, so several workers can run this at once, and every
 * step moves the subscription forward, so a subscription is billed once per
 * period however many workers race for it.
 */
export async function runDueWork(ctx: EngineContext, now: Date): Promise<DueWorkReport> {
  const report: DueWorkReport = { trialsEnded: 0, renewals: 0, retries: 0, canceled: 0, recoveredPayments: 0, errors: [] };
  const skip: string[] = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const claim: { id: string | null } = { id: null };
    let step: Step | null;
    try {
      step = await ctx.store.run(async (tx) => {
        const subscription = await tx.claimDueSubscription(now, skip);
        if (!subscription) return null;
        claim.id = subscription.id;
        return advance(ctx, tx, subscription, now);
      });
    } catch (error) {
      if (claim.id === null) throw error;
      // Leave this subscription for the next run instead of stopping everyone else's billing.
      skip.push(claim.id);
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ subscriptionId: claim.id, message });
      ctx.logger.error({ subscriptionId: claim.id, error: message }, 'due work failed for subscription');
      continue;
    }
    if (!step) break;
    tally(report, step.kind);
    for (const intent of step.intents) await executeCharge(ctx, intent, now);
  }
  report.recoveredPayments = await retryStalePayments(ctx, now);
  return report;
}

function tally(report: DueWorkReport, kind: StepKind): void {
  switch (kind) {
    case 'trial_ended':
      report.trialsEnded += 1;
      break;
    case 'renewed':
      report.renewals += 1;
      break;
    case 'retried':
      report.retries += 1;
      break;
    case 'canceled':
      report.canceled += 1;
      break;
  }
}

async function advance(ctx: EngineContext, tx: StoreTx, subscription: Subscription, now: Date): Promise<Step> {
  if (subscription.status === 'past_due') {
    return retryDueInvoices(ctx, tx, subscription, now);
  }
  if (subscription.cancelAtPeriodEnd) {
    await tx.updateSubscription({
      ...subscription,
      status: transition(subscription.status, 'period_ended_canceled'),
      canceledAt: now,
      endedAt: subscription.currentPeriodEnd,
      updatedAt: now,
    });
    return { kind: 'canceled', intents: [] };
  }

  const plan = await requirePlan(tx, subscription.planId);
  const customer = await requireCustomer(tx, subscription.customerId, 'for_update');
  const period = nextPeriod(subscription, plan.interval);
  const wasTrialing = subscription.status === 'trialing';
  const renewed: Subscription = {
    ...subscription,
    status: wasTrialing ? transition('trialing', 'trial_ended') : subscription.status,
    paidCycles: subscription.paidCycles + 1,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    updatedAt: now,
  };
  await tx.updateSubscription(renewed);
  const invoice = await issueInvoice(tx, customer, {
    subscription: renewed,
    kind: 'cycle',
    periodStart: period.start,
    periodEnd: period.end,
    lines: cycleLines({ plan, price: priceFor(plan, renewed.currency), periodStart: period.start, periodEnd: period.end }),
    now,
  });
  const intent = await startPayment(ctx, tx, { subscription: renewed, customer, invoice, trigger: 'initial', now });
  return { kind: wasTrialing ? 'trial_ended' : 'renewed', intents: intent ? [intent] : [] };
}

async function retryDueInvoices(ctx: EngineContext, tx: StoreTx, subscription: Subscription, now: Date): Promise<Step> {
  const customer = await requireCustomer(tx, subscription.customerId, 'for_update');
  const due = (await tx.listInvoices({ subscriptionId: subscription.id, status: 'open' })).filter(
    (invoice) => invoice.nextRetryAt !== null && invoice.nextRetryAt <= now,
  );
  const intents: ChargeIntent[] = [];
  for (const invoice of due) {
    if (await hasPaymentInFlight(tx, invoice.id)) {
      // The outcome of the payment in flight decides the next retry.
      await tx.updateInvoice({ ...invoice, nextRetryAt: null });
      continue;
    }
    const current = await requireSubscription(tx, subscription.id);
    const counted = { ...invoice, scheduledRetries: invoice.scheduledRetries + 1 };
    const intent = await startPayment(ctx, tx, { subscription: current, customer, invoice: counted, trigger: 'scheduled_retry', now });
    if (intent) intents.push(intent);
  }
  return { kind: 'retried', intents };
}
