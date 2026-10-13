import type { Currency } from './money.js';

export interface Customer {
  id: string;
  name: string;
  email: string;
  /** A customer is billed in exactly one currency; there is no FX. */
  currency: Currency;
  defaultPaymentMethodId: string | null;
  createdAt: Date;
}

export interface PaymentMethod {
  id: string;
  customerId: string;
  providerToken: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  createdAt: Date;
}
