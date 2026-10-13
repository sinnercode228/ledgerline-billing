import { addDays, DAY_MS, utcDay } from '../calendar.js';
import type { Customer, PaymentMethod } from '../customer.js';
import type { Invoice } from '../invoice.js';
import { trialBalance, type AccountBalance, type JournalTransaction, type TrialBalance } from '../ledger.js';
import { churnedBetween, countByStatus, monthlyRecurringRevenue, type Metrics } from '../metrics.js';
import type { Payment } from '../payments.js';
import type { PayrailEvent } from '../payrail/events.js';
import type { Plan } from '../plans.js';
import type { CardDetails } from '../ports/provider.js';
import type { InvoiceFilter, JournalFilter, Page, Store, SubscriptionFilter } from '../ports/store.js';
import type { Subscription } from '../subscription.js';
import type { WebhookEventRecord } from '../webhook-events.js';
import { createContext, type EngineContext, type EngineOptions } from './context.js';
import { attachPaymentMethod, createCustomer, setDefaultPaymentMethod, type NewCustomer } from './customers.js';
import { runDueWork, type DueWorkReport } from './due-work.js';
import { requireCustomer, requireInvoice, requireSubscription } from './lookups.js';
import { changePlan, previewPlanChange, type PlanChangePreview } from './plan-change.js';
import { refundInvoice } from './refunds.js';
import { createSubscription, setCancelAtPeriodEnd, type NewSubscription } from './subscriptions.js';
import { advanceClock, type ClockAdvance } from './test-clock.js';
import { receiveProviderEvent, type ReceiveResult } from './webhooks.js';

/**
 * Billing rules on top of a Store and a PaymentProvider. Every method takes
 * `now` explicitly; the engine never reads the wall clock.
 */
export class BillingEngine {
  private readonly ctx: EngineContext;

  constructor(options: EngineOptions) {
    this.ctx = createContext(options);
  }

  get store(): Store {
    return this.ctx.store;
  }

  async syncPlans(plans: readonly Plan[]): Promise<void> {
    await this.ctx.store.run(async (tx) => {
      for (const plan of plans) await tx.upsertPlan(plan);
    });
  }

  createCustomer(input: NewCustomer, now: Date, options: { idempotencyKey?: string } = {}): Promise<Customer> {
    return createCustomer(this.ctx, input, now, options.idempotencyKey);
  }

  attachPaymentMethod(customerId: string, card: CardDetails, now: Date, options: { makeDefault?: boolean } = {}): Promise<PaymentMethod> {
    return attachPaymentMethod(this.ctx, customerId, card, now, options);
  }

  setDefaultPaymentMethod(customerId: string, paymentMethodId: string, now: Date): Promise<Customer> {
    return setDefaultPaymentMethod(this.ctx, customerId, paymentMethodId, now);
  }

  createSubscription(input: NewSubscription, now: Date, options: { idempotencyKey?: string } = {}): Promise<Subscription> {
    return createSubscription(this.ctx, input, now, options.idempotencyKey);
  }

  previewPlanChange(subscriptionId: string, planId: string, now: Date): Promise<PlanChangePreview> {
    return previewPlanChange(this.ctx, subscriptionId, planId, now);
  }

  changePlan(subscriptionId: string, planId: string, now: Date) {
    return changePlan(this.ctx, subscriptionId, planId, now);
  }

  cancelAtPeriodEnd(subscriptionId: string, now: Date): Promise<Subscription> {
    return setCancelAtPeriodEnd(this.ctx, subscriptionId, true, now);
  }

  resume(subscriptionId: string, now: Date): Promise<Subscription> {
    return setCancelAtPeriodEnd(this.ctx, subscriptionId, false, now);
  }

  refundInvoice(invoiceId: string, now: Date): Promise<Invoice> {
    return refundInvoice(this.ctx, invoiceId, now);
  }

  runDueWork(now: Date): Promise<DueWorkReport> {
    return runDueWork(this.ctx, now);
  }

  receiveProviderEvent(event: PayrailEvent, now: Date): Promise<ReceiveResult> {
    return receiveProviderEvent(this.ctx, event, now);
  }

  getClock(): Promise<Date | null> {
    return this.ctx.store.run((tx) => tx.getClock());
  }

  setClock(now: Date): Promise<void> {
    return this.ctx.store.run((tx) => tx.setClock(now));
  }

  advanceClock(to: Date, onDay?: (at: Date, report: DueWorkReport) => Promise<void> | void): Promise<ClockAdvance> {
    return advanceClock(this.ctx, to, onDay);
  }

  listPlans(): Promise<Plan[]> {
    return this.ctx.store.run((tx) => tx.listPlans());
  }

  getCustomer(id: string): Promise<Customer> {
    return this.ctx.store.run((tx) => requireCustomer(tx, id));
  }

  listCustomers(page: Page = {}): Promise<Customer[]> {
    return this.ctx.store.run((tx) => tx.listCustomers(page));
  }

  listPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    return this.ctx.store.run(async (tx) => {
      await requireCustomer(tx, customerId);
      return tx.listPaymentMethods(customerId);
    });
  }

  getSubscription(id: string): Promise<Subscription> {
    return this.ctx.store.run((tx) => requireSubscription(tx, id));
  }

  listSubscriptions(filter: SubscriptionFilter = {}): Promise<Subscription[]> {
    return this.ctx.store.run((tx) => tx.listSubscriptions(filter));
  }

  getInvoice(id: string): Promise<{ invoice: Invoice; payments: Payment[] }> {
    return this.ctx.store.run(async (tx) => ({ invoice: await requireInvoice(tx, id), payments: await tx.listPaymentsForInvoice(id) }));
  }

  listInvoices(filter: InvoiceFilter = {}): Promise<Invoice[]> {
    return this.ctx.store.run((tx) => tx.listInvoices(filter));
  }

  ledgerAccounts(filter: { customerId?: string } = {}): Promise<AccountBalance[]> {
    return this.ctx.store.run((tx) => tx.listAccountBalances(filter));
  }

  journal(filter: JournalFilter = {}): Promise<JournalTransaction[]> {
    return this.ctx.store.run((tx) => tx.listJournal(filter));
  }

  async trialBalance(): Promise<TrialBalance> {
    return trialBalance(await this.ledgerAccounts());
  }

  listWebhookEvents(page: Page = {}): Promise<WebhookEventRecord[]> {
    return this.ctx.store.run((tx) => tx.listWebhookEvents(page));
  }

  async metrics(now: Date, options: { revenueDays?: number } = {}): Promise<Metrics> {
    const revenueDays = options.revenueDays ?? 30;
    return this.ctx.store.run(async (tx) => {
      const subscriptions = await tx.listSubscriptions({});
      const plans = new Map((await tx.listPlans()).map((plan) => [plan.id, plan]));
      const today = new Date(`${utcDay(now)}T00:00:00.000Z`);
      const revenueByDay = await tx.dailyRevenue({ from: addDays(today, 1 - revenueDays), to: new Date(today.getTime() + DAY_MS) });
      return {
        asOf: now,
        mrr: monthlyRecurringRevenue(subscriptions, plans),
        subscriptions: countByStatus(subscriptions),
        churnedLast30Days: churnedBetween(subscriptions, addDays(now, -30), now),
        revenueByDay,
      };
    });
  }
}
