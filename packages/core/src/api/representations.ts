import type { Customer, PaymentMethod } from '../customer.js';
import type { ClockAdvance } from '../engine/test-clock.js';
import type { Invoice } from '../invoice.js';
import { customerCreditAccount, type AccountBalance } from '../ledger.js';
import type { Payment } from '../payments.js';

// How the API shows domain objects. The HTTP server and the in-browser demo
// both answer with these, so the dashboard sees the same shapes from either.
// Objects not listed here go out as they are; Dates become ISO 8601 strings.

/** The provider token stays on the server. */
export const paymentMethodDto = (method: PaymentMethod, defaultId: string | null) => ({
  id: method.id,
  customerId: method.customerId,
  brand: method.brand,
  last4: method.last4,
  expMonth: method.expMonth,
  expYear: method.expYear,
  isDefault: method.id === defaultId,
  createdAt: method.createdAt,
});

export const paymentDto = (payment: Payment) => ({
  id: payment.id,
  attempt: payment.attempt,
  trigger: payment.trigger,
  status: payment.status,
  failureCode: payment.failureCode,
  amount: payment.amount,
  currency: payment.currency,
  providerPaymentId: payment.providerPaymentId,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

export const accountDto = (row: AccountBalance) => ({
  ...row.account,
  debits: row.debits,
  credits: row.credits,
  balance: row.balance,
});

/** The credit account is a liability, so the credit a customer can spend is its balance negated. */
export function customerDetailDto(customer: Customer, methods: readonly PaymentMethod[], accounts: readonly AccountBalance[]) {
  const credit = accounts.find((row) => row.account.id === customerCreditAccount(customer.id, customer.currency).id);
  return {
    ...customer,
    paymentMethods: methods.map((method) => paymentMethodDto(method, customer.defaultPaymentMethodId)),
    creditBalance: credit ? -credit.balance : 0,
  };
}

export const invoiceDetailDto = (invoice: Invoice, payments: readonly Payment[]) => ({
  ...invoice,
  payments: payments.map(paymentDto),
});

export const clockAdvanceDto = (advance: ClockAdvance) => ({
  from: advance.from,
  to: advance.to,
  days: advance.days.map((day) => ({ at: day.at, ...day.report })),
});
