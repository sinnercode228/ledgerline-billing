import { decideAfterFailure, type DunningDecision } from '../dunning.js';
import { BillingError } from '../errors.js';
import { assertInvoiceTransition, type Invoice } from '../invoice.js';
import { postings, reversePosting } from '../ledger.js';
import { decidePaymentUpdate, type Payment } from '../payments.js';
import type { StoreTx } from '../ports/store.js';
import { transition, type Subscription } from '../subscription.js';
import type { EngineContext } from './context.js';
import { outstanding } from './invoicing.js';
import { post } from './ledger-ops.js';
import { requireInvoice, requireSubscription } from './lookups.js';

export interface PaymentResult {
  status: 'succeeded' | 'failed';
  failureCode: string | null;
  providerPaymentId: string | null;
}

/** How to find the local payment: directly, or from what a provider event tells us. */
export type PaymentLocator =
  | { paymentId: string }
  | { providerPaymentId: string; invoiceId: string; attempt: number; amount: number };

export type ApplyOutcome = 'applied' | 'duplicate' | 'stale' | 'unmatched';

/** What applying payment outcomes changed; due work sums these into its report. */
export interface PaymentEffects {
  succeeded: number;
  failed: number;
  /** Invoices written off because dunning ran out of retries. */
  writtenOff: number;
  /** Subscriptions that dunning canceled. */
  canceled: number;
}

export const noEffects = (): PaymentEffects => ({ succeeded: 0, failed: 0, writtenOff: 0, canceled: 0 });

export function addEffects(a: PaymentEffects, b: PaymentEffects): PaymentEffects {
  return {
    succeeded: a.succeeded + b.succeeded,
    failed: a.failed + b.failed,
    writtenOff: a.writtenOff + b.writtenOff,
    canceled: a.canceled + b.canceled,
  };
}

async function locatePayment(tx: StoreTx, locator: PaymentLocator): Promise<Payment | null> {
  if ('paymentId' in locator) return tx.getPayment(locator.paymentId);
  const linked = await tx.findPaymentByProviderId(locator.providerPaymentId);
  if (linked) return linked;
  // Every payment row is written before the provider is called. A provider id
  // we have never seen means we crashed before storing the response, so the
  // invoice and attempt in the event metadata point at our pending row.
  const byAttempt = await tx.findPaymentByAttempt(locator.invoiceId, locator.attempt);
  if (byAttempt && byAttempt.providerPaymentId === null && byAttempt.amount === locator.amount) return byAttempt;
  return null;
}

/**
 * The single entry point for payment outcomes, whether they come back from
 * the API call, a webhook or the recovery sweep. Status only moves forward,
 * so applying the same outcome twice, or a failure after a success, changes
 * nothing.
 */
export async function applyPaymentResult(
  ctx: EngineContext,
  tx: StoreTx,
  locator: PaymentLocator,
  result: PaymentResult,
  now: Date,
): Promise<{ outcome: ApplyOutcome; payment: Payment | null; effects: PaymentEffects }> {
  const located = await locatePayment(tx, locator);
  if (!located) return { outcome: 'unmatched', payment: null, effects: noEffects() };

  const subscription = await requireSubscription(tx, located.subscriptionId, 'for_update');
  const invoice = await requireInvoice(tx, located.invoiceId, 'for_update');
  const payment = await tx.getPayment(located.id, 'for_update');
  if (!payment) throw new BillingError('not_found', `payment ${located.id} disappeared`);

  const decision = decidePaymentUpdate(payment.status, result.status);
  if (decision !== 'apply') return { outcome: decision, payment, effects: noEffects() };

  const updated: Payment = {
    ...payment,
    status: result.status,
    failureCode: result.status === 'failed' ? (result.failureCode ?? 'unknown') : null,
    providerPaymentId: payment.providerPaymentId ?? result.providerPaymentId,
    updatedAt: now,
  };
  await tx.updatePayment(updated);

  if (result.status === 'succeeded') {
    await settleWithPayment(ctx, tx, { subscription, invoice, payment: updated, now });
    return { outcome: 'applied', payment: updated, effects: { ...noEffects(), succeeded: 1 } };
  }
  const effects = await handleFailedPayment(ctx, tx, { subscription, invoice, now });
  return { outcome: 'applied', payment: updated, effects };
}

async function hasFailingInvoices(tx: StoreTx, subscriptionId: string): Promise<boolean> {
  const open = await tx.listInvoices({ subscriptionId, status: 'open' });
  return open.some((invoice) => invoice.firstFailedAt !== null);
}

async function settleWithPayment(
  ctx: EngineContext,
  tx: StoreTx,
  input: { subscription: Subscription; invoice: Invoice; payment: Payment; now: Date },
): Promise<void> {
  const { subscription, invoice, payment, now } = input;
  const refs = {
    customerId: invoice.customerId,
    currency: invoice.currency,
    subscriptionId: invoice.subscriptionId,
    invoiceId: invoice.id,
    paymentId: payment.id,
  };
  await post(tx, postings.paymentSucceeded({ ...refs, amount: payment.amount }), now, ctx.ids);

  if (invoice.status === 'uncollectible' && outstanding(invoice) > 0) {
    const [writeOff] = await tx.listJournal({ invoiceId: invoice.id, kind: 'write_off', limit: 1 });
    if (!writeOff) throw new BillingError('not_found', `invoice ${invoice.id} is uncollectible but has no write-off`);
    const original = postings.writeOff({ ...refs, amount: outstanding(invoice) });
    await post(tx, reversePosting(original, writeOff.id, 'Write-off reversed: the payment arrived after all'), now, ctx.ids);
  }

  const owed = invoice.status === 'open' || invoice.status === 'uncollectible' ? outstanding(invoice) : 0;
  const applied = Math.min(owed, payment.amount);
  const excess = payment.amount - applied;
  if (excess > 0) {
    await post(tx, postings.overpaymentCredit({ ...refs, amount: excess }), now, ctx.ids);
  }

  let next: Invoice = { ...invoice, amountPaid: invoice.amountPaid + applied };
  if ((next.status === 'open' || next.status === 'uncollectible') && outstanding(next) === 0) {
    assertInvoiceTransition(next.status, 'paid');
    next = { ...next, status: 'paid', paidAt: now, nextRetryAt: null };
  }
  await tx.updateInvoice(next);

  if (subscription.status === 'past_due' && !(await hasFailingInvoices(tx, subscription.id))) {
    await tx.updateSubscription({ ...subscription, status: transition('past_due', 'payment_recovered'), updatedAt: now });
  }
}

/** The caller holds the subscription and invoice locks. */
export async function handleFailedPayment(
  ctx: EngineContext,
  tx: StoreTx,
  input: { subscription: Subscription; invoice: Invoice; now: Date },
): Promise<PaymentEffects> {
  const { subscription, invoice, now } = input;
  const failed = { ...noEffects(), failed: 1 };
  // A failure for an invoice that is already settled or closed is history only.
  if (invoice.status !== 'open') return failed;

  const firstFailedAt = invoice.firstFailedAt ?? now;
  const decision: DunningDecision =
    subscription.status === 'canceled'
      ? { action: 'give_up' }
      : decideAfterFailure({ policy: ctx.dunning, firstFailedAt, scheduledRetries: invoice.scheduledRetries, now });

  if (decision.action === 'retry') {
    await tx.updateInvoice({ ...invoice, firstFailedAt, nextRetryAt: decision.at });
    if (subscription.status !== 'past_due') {
      await tx.updateSubscription({ ...subscription, status: transition(subscription.status, 'payment_failed'), updatedAt: now });
    }
    return failed;
  }
  return addEffects(failed, await giveUp(ctx, tx, { subscription, failedInvoice: { ...invoice, firstFailedAt }, now }));
}

/** Dunning is exhausted: every open invoice is written off and the subscription ends. */
async function giveUp(
  ctx: EngineContext,
  tx: StoreTx,
  input: { subscription: Subscription; failedInvoice: Invoice; now: Date },
): Promise<PaymentEffects> {
  const { subscription, failedInvoice, now } = input;
  const open = await tx.listInvoices({ subscriptionId: subscription.id, status: 'open' });
  for (const stored of open) {
    const invoice = stored.id === failedInvoice.id ? failedInvoice : stored;
    const remainder = outstanding(invoice);
    if (remainder > 0) {
      await post(
        tx,
        postings.writeOff({
          customerId: invoice.customerId,
          currency: invoice.currency,
          subscriptionId: invoice.subscriptionId,
          invoiceId: invoice.id,
          amount: remainder,
        }),
        now,
        ctx.ids,
      );
    }
    assertInvoiceTransition(invoice.status, 'uncollectible');
    await tx.updateInvoice({ ...invoice, status: 'uncollectible', uncollectibleAt: now, nextRetryAt: null });
  }
  if (subscription.status !== 'canceled') {
    await tx.updateSubscription({
      ...subscription,
      status: transition(subscription.status, 'dunning_exhausted'),
      cancelAtPeriodEnd: false,
      canceledAt: now,
      endedAt: now,
      updatedAt: now,
    });
  }
  return { ...noEffects(), writtenOff: open.length, canceled: subscription.status === 'canceled' ? 0 : 1 };
}
