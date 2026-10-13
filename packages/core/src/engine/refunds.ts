import { BillingError } from '../errors.js';
import type { Invoice } from '../invoice.js';
import { postings } from '../ledger.js';
import type { EngineContext } from './context.js';
import { post } from './ledger-ops.js';
import { requireInvoice, requireSubscription } from './lookups.js';

/** Refunds everything collected by card for a paid invoice. Repeating the call is harmless. */
export async function refundInvoice(ctx: EngineContext, invoiceId: string, now: Date): Promise<Invoice> {
  const target = await ctx.store.run(async (tx) => {
    const invoice = await requireInvoice(tx, invoiceId);
    if (invoice.amountRefunded > 0) return null;
    if (invoice.status !== 'paid' || invoice.amountPaid === 0) {
      throw new BillingError('invalid_transition', 'only a paid invoice with a card payment can be refunded');
    }
    const payment = (await tx.listPaymentsForInvoice(invoiceId)).filter((p) => p.status === 'succeeded' && p.providerPaymentId !== null).at(-1);
    if (!payment?.providerPaymentId) throw new BillingError('not_found', `no captured payment for invoice ${invoiceId}`);
    return { amount: invoice.amountPaid, providerPaymentId: payment.providerPaymentId, paymentId: payment.id };
  });
  if (!target) return ctx.store.run((tx) => requireInvoice(tx, invoiceId));

  await ctx.provider.refundPayment({
    providerPaymentId: target.providerPaymentId,
    amount: target.amount,
    idempotencyKey: `ledgerline:${invoiceId}:refund`,
  });

  return ctx.store.run(async (tx) => {
    const unlocked = await requireInvoice(tx, invoiceId);
    await requireSubscription(tx, unlocked.subscriptionId, 'for_update');
    const invoice = await requireInvoice(tx, invoiceId, 'for_update');
    if (invoice.amountRefunded > 0) return invoice;
    await post(
      tx,
      postings.refund({
        customerId: invoice.customerId,
        currency: invoice.currency,
        subscriptionId: invoice.subscriptionId,
        invoiceId: invoice.id,
        paymentId: target.paymentId,
        amount: target.amount,
      }),
      now,
      ctx.ids,
    );
    const refunded = { ...invoice, amountRefunded: target.amount };
    await tx.updateInvoice(refunded);
    return refunded;
  });
}
