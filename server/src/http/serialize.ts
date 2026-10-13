import type { AccountBalance, ClockAdvance, Payment, PaymentMethod } from '@ledgerline/core';

// Domain objects go out as they are (Dates serialize to ISO 8601 UTC); these
// shapes exist where the API shows less or something different.

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

export const clockAdvanceDto = (advance: ClockAdvance) => ({
  from: advance.from,
  to: advance.to,
  days: advance.days.map((day) => ({ at: day.at, ...day.report })),
});
