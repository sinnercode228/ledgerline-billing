import type { Currency } from '../money.js';

export interface CardDetails {
  number: string;
  expMonth: number;
  expYear: number;
}

export interface TokenizedCard {
  token: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface CreatePaymentRequest {
  amount: number;
  currency: Currency;
  paymentMethodToken: string;
  /** Repeating a request with the same key returns the original payment instead of charging again. */
  idempotencyKey: string;
  metadata: { invoiceId: string; attempt: number };
}

export interface ProviderPayment {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  failureCode: string | null;
  amount: number;
  currency: Currency;
}

export interface RefundRequest {
  providerPaymentId: string;
  amount: number;
  idempotencyKey: string;
}

export interface ProviderRefund {
  id: string;
  providerPaymentId: string;
  amount: number;
}

/** The request may or may not have reached the provider: retry later with the same idempotency key. */
export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError';
}

export interface PaymentProvider {
  /** Rejects with BillingError `card_not_supported` for cards the provider does not accept. */
  tokenizeCard(card: CardDetails, now: Date): Promise<TokenizedCard>;
  createPayment(request: CreatePaymentRequest): Promise<ProviderPayment>;
  refundPayment(request: RefundRequest): Promise<ProviderRefund>;
}
