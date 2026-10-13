import { BillingError } from '../errors.js';
import type { Currency } from '../money.js';
import {
  ProviderUnavailableError,
  type CardDetails,
  type CreatePaymentRequest,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderRefund,
  type RefundRequest,
  type TokenizedCard,
} from '../ports/provider.js';
import type { PayrailEvent, PayrailPaymentObject } from './events.js';

export const PAYRAIL_TEST_CARDS = {
  succeeds: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
} as const;

export type CardBehaviour = 'succeed' | 'decline' | 'insufficient_funds';

const BEHAVIOUR_BY_LAST4: Record<string, CardBehaviour> = {
  '4242': 'succeed',
  '0002': 'decline',
  '9995': 'insufficient_funds',
};

const FAILURE_CODES: Record<Exclude<CardBehaviour, 'succeed'>, string> = {
  decline: 'card_declined',
  insufficient_funds: 'insufficient_funds',
};

export type InjectedFault = 'unavailable_before_processing' | 'unavailable_after_processing';

interface FakePayment {
  request: CreatePaymentRequest;
  result: ProviderPayment;
}

export interface FakePayrailOptions {
  now?: () => Date;
  /**
   * `sync` answers createPayment with the final status; `async` answers
   * "pending" and reports the outcome only through a webhook event, and to
   * later calls with the same idempotency key.
   */
  mode?: 'sync' | 'async';
}

const encoder = new TextEncoder();

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

function luhnValid(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * In-memory stand-in for Payrail, a made-up payment provider. Ids are derived
 * from the idempotency key, so separate processes agree on them, and a
 * repeated request never creates a second charge.
 */
export class FakePayrail implements PaymentProvider {
  private readonly paymentsByKey = new Map<string, FakePayment>();
  private readonly refundsByKey = new Map<string, ProviderRefund>();
  private readonly behaviourOverrides = new Map<string, CardBehaviour>();
  private readonly outbox: PayrailEvent[] = [];
  private readonly listeners = new Set<(event: PayrailEvent) => void>();
  private readonly faults: InjectedFault[] = [];
  private readonly now: () => Date;
  private mode: 'sync' | 'async';
  private sequence = 0;

  constructor(options: FakePayrailOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.mode = options.mode ?? 'sync';
  }

  async tokenizeCard(card: CardDetails, now: Date): Promise<TokenizedCard> {
    const number = card.number.replace(/[\s-]/g, '');
    const last4 = number.slice(-4);
    if (!/^\d{16}$/.test(number) || !luhnValid(number) || !(last4 in BEHAVIOUR_BY_LAST4)) {
      throw new BillingError('card_not_supported', 'Payrail test mode accepts only the documented test cards');
    }
    const expiresAfter = Date.UTC(card.expYear, card.expMonth, 1);
    if (card.expMonth < 1 || card.expMonth > 12 || expiresAfter <= now.getTime()) {
      throw new BillingError('card_not_supported', 'card is expired');
    }
    this.sequence += 1;
    const token = `tok_${last4}_${await digest(`${number}:${now.getTime()}:${this.sequence}:${Math.random()}`)}`;
    return { token, brand: 'visa', last4, expMonth: card.expMonth, expYear: card.expYear };
  }

  async createPayment(request: CreatePaymentRequest): Promise<ProviderPayment> {
    if (this.takeFault('unavailable_before_processing')) {
      throw new ProviderUnavailableError('Payrail did not answer (request not processed)');
    }
    let stored = this.paymentsByKey.get(request.idempotencyKey);
    let firstResponse = false;
    if (stored) {
      const original = stored.request;
      if (original.amount !== request.amount || original.currency !== request.currency || original.paymentMethodToken !== request.paymentMethodToken) {
        throw new Error(`idempotency key ${request.idempotencyKey} was reused with different parameters`);
      }
    } else {
      stored = { request, result: await this.process(request) };
      this.paymentsByKey.set(request.idempotencyKey, stored);
      this.emitPaymentEvent(stored.result, request);
      firstResponse = true;
    }
    if (this.takeFault('unavailable_after_processing')) {
      throw new ProviderUnavailableError('Payrail did not answer (request was processed)');
    }
    if (this.mode === 'async' && firstResponse) {
      return { ...stored.result, status: 'pending', failureCode: null };
    }
    return { ...stored.result };
  }

  async refundPayment(request: RefundRequest): Promise<ProviderRefund> {
    const existing = this.refundsByKey.get(request.idempotencyKey);
    if (existing) return { ...existing };
    const payment = [...this.paymentsByKey.values()].find((p) => p.result.id === request.providerPaymentId);
    if (!payment || payment.result.status !== 'succeeded') {
      throw new BillingError('not_found', `payment ${request.providerPaymentId} cannot be refunded`);
    }
    const refund = { id: `re_${await digest(request.idempotencyKey)}`, providerPaymentId: request.providerPaymentId, amount: request.amount };
    this.refundsByKey.set(request.idempotencyKey, refund);
    this.emit({
      id: `evt_${await digest(`${refund.id}:refund.succeeded`)}`,
      type: 'refund.succeeded',
      created: Math.floor(this.now().getTime() / 1000),
      data: { object: { object: 'refund', id: refund.id, payment: refund.providerPaymentId, amount: refund.amount } },
    });
    return { ...refund };
  }

  setMode(mode: 'sync' | 'async'): void {
    this.mode = mode;
  }

  /** Changes how a tokenized card behaves from now on, e.g. a card that runs out of funds. */
  setCardBehaviour(token: string, behaviour: CardBehaviour): void {
    this.behaviourOverrides.set(token, behaviour);
  }

  injectFault(fault: InjectedFault): void {
    this.faults.push(fault);
  }

  onEvent(listener: (event: PayrailEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Removes and returns the events emitted so far, oldest first. */
  drainEvents(): PayrailEvent[] {
    return this.outbox.splice(0, this.outbox.length);
  }

  /** Successful charges per idempotency key; a double charge would show up as a second key for one invoice attempt. */
  succeededCharges(): Array<{ id: string; amount: number; currency: Currency; invoiceId: string }> {
    return [...this.paymentsByKey.values()]
      .filter((p) => p.result.status === 'succeeded')
      .map((p) => ({ id: p.result.id, amount: p.result.amount, currency: p.result.currency, invoiceId: p.request.metadata.invoiceId }));
  }

  private async process(request: CreatePaymentRequest): Promise<ProviderPayment> {
    const id = `pay_${await digest(request.idempotencyKey)}`;
    const behaviour = this.behaviourOf(request.paymentMethodToken);
    return behaviour === 'succeed'
      ? { id, status: 'succeeded', failureCode: null, amount: request.amount, currency: request.currency }
      : { id, status: 'failed', failureCode: FAILURE_CODES[behaviour], amount: request.amount, currency: request.currency };
  }

  private behaviourOf(token: string): CardBehaviour {
    const override = this.behaviourOverrides.get(token);
    if (override) return override;
    const last4 = /^tok_(\d{4})_/.exec(token)?.[1];
    const behaviour = last4 === undefined ? undefined : BEHAVIOUR_BY_LAST4[last4];
    if (!behaviour) throw new BillingError('card_not_supported', `unknown payment method token ${token}`);
    return behaviour;
  }

  private takeFault(fault: InjectedFault): boolean {
    const index = this.faults.indexOf(fault);
    if (index === -1) return false;
    this.faults.splice(index, 1);
    return true;
  }

  private emitPaymentEvent(result: ProviderPayment, request: CreatePaymentRequest): void {
    if (result.status === 'pending') return;
    const object: PayrailPaymentObject = {
      object: 'payment',
      id: result.id,
      amount: result.amount,
      currency: result.currency,
      status: result.status,
      failure_code: result.failureCode,
      metadata: { invoice_id: request.metadata.invoiceId, attempt: String(request.metadata.attempt) },
    };
    this.emit({
      id: `evt_${result.id.slice(4)}_${result.status}`,
      type: `payment.${result.status}`,
      created: Math.floor(this.now().getTime() / 1000),
      data: { object: { ...object } },
    });
  }

  private emit(event: PayrailEvent): void {
    this.outbox.push(event);
    for (const listener of this.listeners) listener(event);
  }
}
