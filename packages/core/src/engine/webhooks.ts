import { newId } from '../ids.js';
import { isPaymentEventType, readPaymentObject, type PayrailEvent } from '../payrail/events.js';
import type { StoreTx } from '../ports/store.js';
import type { WebhookEventRecord, WebhookOutcome } from '../webhook-events.js';
import type { EngineContext } from './context.js';
import { applyPaymentResult } from './payment-results.js';

export interface ReceiveResult {
  duplicate: boolean;
  outcome: WebhookOutcome | null;
}

/**
 * Stores and processes a verified provider event in one transaction: if
 * processing fails nothing is stored and the provider's redelivery gets a
 * second chance; a redelivery of a processed event is acknowledged untouched.
 */
export async function receiveProviderEvent(ctx: EngineContext, event: PayrailEvent, now: Date): Promise<ReceiveResult> {
  return ctx.store.run(async (tx) => {
    const record: WebhookEventRecord = {
      id: newId('whe'),
      providerEventId: event.id,
      type: event.type,
      payload: event,
      receivedAt: now,
      processedAt: null,
      outcome: null,
      note: null,
    };
    if (!(await tx.insertWebhookEvent(record))) return { duplicate: true, outcome: null };
    const { outcome, note } = await process(ctx, tx, event, now);
    await tx.updateWebhookEvent({ ...record, processedAt: now, outcome, note });
    return { duplicate: false, outcome };
  });
}

async function process(
  ctx: EngineContext,
  tx: StoreTx,
  event: PayrailEvent,
  now: Date,
): Promise<{ outcome: WebhookOutcome; note: string | null }> {
  if (!isPaymentEventType(event.type)) {
    return { outcome: 'ignored_type', note: `no handler for ${event.type}` };
  }
  const payment = readPaymentObject(event);
  const attempt = Number(payment?.metadata.attempt);
  if (!payment || !Number.isSafeInteger(attempt)) {
    return { outcome: 'malformed', note: 'payment payload does not have the expected shape' };
  }
  const { outcome } = await applyPaymentResult(
    ctx,
    tx,
    { providerPaymentId: payment.id, invoiceId: payment.metadata.invoice_id, attempt, amount: payment.amount },
    { status: payment.status, failureCode: payment.failure_code, providerPaymentId: payment.id },
    now,
  );
  switch (outcome) {
    case 'applied':
      return { outcome: 'applied', note: null };
    case 'duplicate':
      return { outcome: 'duplicate_payment_update', note: `payment was already ${payment.status}` };
    case 'stale':
      return { outcome: 'stale_payment_update', note: `ignored ${event.type}: the payment had already succeeded` };
    case 'unmatched':
      return { outcome: 'unmatched', note: `no payment matches ${payment.id} for invoice ${payment.metadata.invoice_id}` };
  }
}
