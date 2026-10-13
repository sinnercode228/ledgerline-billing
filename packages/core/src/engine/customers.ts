import type { Customer, PaymentMethod } from '../customer.js';
import { BillingError } from '../errors.js';
import { newId } from '../ids.js';
import { customerCreditAccount, receivableAccount } from '../ledger.js';
import type { Currency } from '../money.js';
import type { CardDetails } from '../ports/provider.js';
import { executeCharge, hasPaymentInFlight, startPayment, type ChargeIntent } from './charging.js';
import type { EngineContext } from './context.js';
import { findReplay, rememberResult } from './idempotency.js';
import { requireCustomer, requireSubscription } from './lookups.js';

export interface NewCustomer {
  name: string;
  email: string;
  currency: Currency;
}

export async function createCustomer(ctx: EngineContext, input: NewCustomer, now: Date, idempotencyKey?: string): Promise<Customer> {
  if (input.name.trim() === '') throw new BillingError('invalid_argument', 'customer name is required');
  const fingerprint = JSON.stringify([input.name, input.email, input.currency]);
  return ctx.store.run(async (tx) => {
    if (idempotencyKey !== undefined) {
      const replay = await findReplay(tx, 'customers.create', idempotencyKey, fingerprint);
      if (replay) return requireCustomer(tx, replay);
    }
    const customer: Customer = {
      id: newId('cus'),
      name: input.name.trim(),
      email: input.email,
      currency: input.currency,
      defaultPaymentMethodId: null,
      createdAt: now,
    };
    await tx.insertCustomer(customer);
    await tx.ensureLedgerAccounts([receivableAccount(customer.id, customer.currency), customerCreditAccount(customer.id, customer.currency)]);
    if (idempotencyKey !== undefined) {
      await rememberResult(tx, { scope: 'customers.create', key: idempotencyKey, fingerprint, resourceId: customer.id, now });
    }
    return customer;
  });
}

export async function attachPaymentMethod(
  ctx: EngineContext,
  customerId: string,
  card: CardDetails,
  now: Date,
  options: { makeDefault?: boolean | undefined } = {},
): Promise<PaymentMethod> {
  await ctx.store.run((tx) => requireCustomer(tx, customerId));
  const tokenized = await ctx.provider.tokenizeCard(card, now);
  const { method, isDefault } = await ctx.store.run(async (tx) => {
    const customer = await requireCustomer(tx, customerId, 'for_update');
    const method: PaymentMethod = {
      id: newId('pm'),
      customerId,
      providerToken: tokenized.token,
      brand: tokenized.brand,
      last4: tokenized.last4,
      expMonth: tokenized.expMonth,
      expYear: tokenized.expYear,
      createdAt: now,
    };
    await tx.insertPaymentMethod(method);
    const isDefault = options.makeDefault ?? true;
    if (isDefault || customer.defaultPaymentMethodId === null) {
      await tx.updateCustomer({ ...customer, defaultPaymentMethodId: method.id });
      return { method, isDefault: true };
    }
    return { method, isDefault: false };
  });
  if (isDefault) await retryPastDueInvoices(ctx, customerId, now);
  return method;
}

export async function setDefaultPaymentMethod(ctx: EngineContext, customerId: string, paymentMethodId: string, now: Date): Promise<Customer> {
  const customer = await ctx.store.run(async (tx) => {
    const customer = await requireCustomer(tx, customerId, 'for_update');
    const method = await tx.getPaymentMethod(paymentMethodId);
    if (method?.customerId !== customerId) {
      throw new BillingError('not_found', `payment method ${paymentMethodId} not found for customer ${customerId}`);
    }
    const updated = { ...customer, defaultPaymentMethodId: paymentMethodId };
    await tx.updateCustomer(updated);
    return updated;
  });
  await retryPastDueInvoices(ctx, customerId, now);
  return customer;
}

/** A new card is the best moment to collect: past-due invoices are retried right away, outside the schedule. */
export async function retryPastDueInvoices(ctx: EngineContext, customerId: string, now: Date): Promise<number> {
  const pastDue = await ctx.store.run((tx) => tx.listSubscriptions({ customerId, status: 'past_due' }));
  let attempts = 0;
  for (const { id } of pastDue) {
    const intents = await ctx.store.run(async (tx) => {
      const subscription = await requireSubscription(tx, id, 'for_update');
      if (subscription.status !== 'past_due') return [];
      const customer = await requireCustomer(tx, customerId, 'for_update');
      const failing = (await tx.listInvoices({ subscriptionId: id, status: 'open' })).filter((i) => i.firstFailedAt !== null);
      const started: ChargeIntent[] = [];
      for (const invoice of failing) {
        if (await hasPaymentInFlight(tx, invoice.id)) continue;
        const current = await requireSubscription(tx, id);
        const intent = await startPayment(ctx, tx, { subscription: current, customer, invoice, trigger: 'payment_method_updated', now });
        if (intent) started.push(intent);
      }
      return started;
    });
    for (const intent of intents) {
      await executeCharge(ctx, intent, now);
      attempts += 1;
    }
  }
  return attempts;
}
