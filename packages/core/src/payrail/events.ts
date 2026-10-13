import { isCurrency, type Currency } from '../money.js';

/** Webhook payload as Payrail sends it (snake_case on the wire). */
export interface PayrailEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export interface PayrailPaymentObject {
  object: 'payment';
  id: string;
  amount: number;
  currency: Currency;
  status: 'succeeded' | 'failed';
  failure_code: string | null;
  metadata: { invoice_id: string; attempt: string };
}

export const PAYMENT_EVENT_TYPES = ['payment.succeeded', 'payment.failed'] as const;

export function isPaymentEventType(type: string): type is (typeof PAYMENT_EVENT_TYPES)[number] {
  return (PAYMENT_EVENT_TYPES as readonly string[]).includes(type);
}

/** Returns the payment carried by a payment event, or null when the payload does not have the expected shape. */
export function readPaymentObject(event: PayrailEvent): PayrailPaymentObject | null {
  const o = event.data.object;
  const metadata = o.metadata as Record<string, unknown> | null | undefined;
  const status = event.type === 'payment.succeeded' ? 'succeeded' : event.type === 'payment.failed' ? 'failed' : null;
  if (
    status === null ||
    o.object !== 'payment' ||
    typeof o.id !== 'string' ||
    typeof o.amount !== 'number' ||
    !Number.isSafeInteger(o.amount) ||
    !isCurrency(o.currency) ||
    o.status !== status ||
    !(o.failure_code === null || typeof o.failure_code === 'string') ||
    typeof metadata !== 'object' ||
    metadata === null ||
    typeof metadata.invoice_id !== 'string' ||
    typeof metadata.attempt !== 'string'
  ) {
    return null;
  }
  return {
    object: 'payment',
    id: o.id,
    amount: o.amount,
    currency: o.currency,
    status,
    failure_code: o.failure_code,
    metadata: { invoice_id: metadata.invoice_id, attempt: metadata.attempt },
  };
}
