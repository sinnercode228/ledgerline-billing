import type { Customer, PaymentMethod } from '../customer.js';
import { BillingError } from '../errors.js';
import { newId } from '../ids.js';
import type { Invoice } from '../invoice.js';
import type { Currency } from '../money.js';
import { paymentIdempotencyKey, type Payment, type PaymentTrigger } from '../payments.js';
import { ProviderUnavailableError, type ProviderPayment } from '../ports/provider.js';
import type { StoreTx } from '../ports/store.js';
import type { Subscription } from '../subscription.js';
import type { EngineContext } from './context.js';
import { outstanding } from './invoicing.js';
import { applyPaymentResult, handleFailedPayment } from './payment-results.js';

/** A payment recorded as pending, to be sent to the provider after the transaction commits. */
export interface ChargeIntent {
  paymentId: string;
  invoiceId: string;
  attempt: number;
  amount: number;
  currency: Currency;
  paymentMethodToken: string;
  idempotencyKey: string;
}

function intentFor(payment: Payment, method: PaymentMethod): ChargeIntent {
  return {
    paymentId: payment.id,
    invoiceId: payment.invoiceId,
    attempt: payment.attempt,
    amount: payment.amount,
    currency: payment.currency,
    paymentMethodToken: method.providerToken,
    idempotencyKey: payment.idempotencyKey,
  };
}

export async function hasPaymentInFlight(tx: StoreTx, invoiceId: string): Promise<boolean> {
  return (await tx.listPaymentsForInvoice(invoiceId)).some((payment) => payment.status === 'pending');
}

/**
 * Records the next payment attempt for an open invoice. The provider is not
 * called here: holding row locks across a network call would block every
 * other writer of this subscription for the length of the call.
 * The caller holds the subscription, customer and invoice locks.
 */
export async function startPayment(
  ctx: EngineContext,
  tx: StoreTx,
  input: { subscription: Subscription; customer: Customer; invoice: Invoice; trigger: PaymentTrigger; now: Date },
): Promise<ChargeIntent | null> {
  const { subscription, customer, invoice, trigger, now } = input;
  const amount = outstanding(invoice);
  if (invoice.status !== 'open' || amount <= 0) return null;

  const attempt = invoice.attemptCount + 1;
  const method = customer.defaultPaymentMethodId === null ? null : await tx.getPaymentMethod(customer.defaultPaymentMethodId);
  const payment: Payment = {
    id: newId('pay'),
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    subscriptionId: invoice.subscriptionId,
    attempt,
    trigger,
    idempotencyKey: paymentIdempotencyKey(invoice.id, attempt),
    paymentMethodId: method?.id ?? null,
    providerPaymentId: null,
    amount,
    currency: invoice.currency,
    status: method ? 'pending' : 'failed',
    failureCode: method ? null : 'payment_method_missing',
    createdAt: now,
    updatedAt: now,
    lastAttemptAt: now,
  };
  const attempted: Invoice = { ...invoice, attemptCount: attempt, nextRetryAt: null };
  await tx.updateInvoice(attempted);
  await tx.insertPayment(payment);

  if (!method) {
    await handleFailedPayment(ctx, tx, { subscription, invoice: attempted, now });
    return null;
  }
  return intentFor(payment, method);
}

/** Sends a recorded payment to the provider and applies the answer in a new transaction. */
export async function executeCharge(ctx: EngineContext, intent: ChargeIntent, now: Date): Promise<void> {
  let answer: ProviderPayment;
  try {
    answer = await ctx.provider.createPayment({
      amount: intent.amount,
      currency: intent.currency,
      paymentMethodToken: intent.paymentMethodToken,
      idempotencyKey: intent.idempotencyKey,
      metadata: { invoiceId: intent.invoiceId, attempt: intent.attempt },
    });
  } catch (error) {
    // The outcome is unknown. The payment stays pending: a webhook or the
    // recovery sweep (same idempotency key, so no second charge) settles it.
    const message = error instanceof Error ? error.message : String(error);
    const details = { paymentId: intent.paymentId, invoiceId: intent.invoiceId, error: message };
    if (error instanceof ProviderUnavailableError) ctx.logger.warn(details, 'payment provider unavailable');
    else ctx.logger.error(details, 'payment provider rejected the request');
    return;
  }

  await ctx.store.run(async (tx) => {
    if (answer.status === 'pending') {
      const payment = await tx.getPayment(intent.paymentId, 'for_update');
      if (payment && payment.providerPaymentId === null) {
        await tx.updatePayment({ ...payment, providerPaymentId: answer.id, updatedAt: now });
      }
      return;
    }
    await applyPaymentResult(
      ctx,
      tx,
      { paymentId: intent.paymentId },
      { status: answer.status, failureCode: answer.failureCode, providerPaymentId: answer.id },
      now,
    );
  });
}

/**
 * Asks the provider again about payments that stayed pending, e.g. after a
 * timeout or a crash between recording the payment and calling the provider.
 * The same idempotency key makes the repeated call safe.
 */
export async function retryStalePayments(ctx: EngineContext, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ctx.pendingPaymentRetryAfterMs);
  const seen: string[] = [];
  let retried = 0;
  for (;;) {
    const intent = await ctx.store.run(async (tx) => {
      const payment = await tx.claimStalePendingPayment(cutoff, seen);
      if (!payment) return null;
      seen.push(payment.id);
      await tx.updatePayment({ ...payment, lastAttemptAt: now, updatedAt: now });
      const method = payment.paymentMethodId === null ? null : await tx.getPaymentMethod(payment.paymentMethodId);
      if (!method) throw new BillingError('not_found', `pending payment ${payment.id} has no payment method`);
      return intentFor(payment, method);
    });
    if (!intent) return retried;
    await executeCharge(ctx, intent, now);
    retried += 1;
  }
}
