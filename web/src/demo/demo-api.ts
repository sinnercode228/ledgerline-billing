import {
  accountDto,
  clockAdvanceDto,
  customerDetailDto,
  DAY_MS,
  invoiceDetailDto,
  isBillingError,
  paymentMethodDto,
  statusForBillingError,
} from '@ledgerline/core';
import { ApiError, MAX_PAGE, type LedgerlineApi } from '../api/client';
import type { CardInput, ClockStep, InvoiceQuery, JournalQuery, PageQuery, SubscriptionQuery, Wire } from '../api/types';
import { DemoWorld, type OpenWorldOptions } from './world';

const DEFAULT_PAGE = 50;

/** Server-side serialization in one line: what goes over the wire is JSON. */
const toWire = <T>(value: T): Wire<T> => JSON.parse(JSON.stringify(value)) as Wire<T>;

function invalid(message: string): ApiError {
  return new ApiError(400, 'validation_failed', message);
}

function pageOf(query: PageQuery): { limit: number; offset: number } {
  const limit = query.limit ?? DEFAULT_PAGE;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw invalid(`limit must be between 1 and ${MAX_PAGE}`);
  if (!Number.isInteger(offset) || offset < 0) throw invalid('offset must not be negative');
  return { limit, offset };
}

function checkCard(card: CardInput): void {
  if (!/^[\d -]{12,23}$/.test(card.number)) throw invalid('card number must be digits');
  if (!Number.isInteger(card.expMonth) || card.expMonth < 1 || card.expMonth > 12) throw invalid('expMonth must be 1-12');
  if (!Number.isInteger(card.expYear) || card.expYear < 2000 || card.expYear > 2100) throw invalid('expYear is out of range');
}

/**
 * The API, answered by the engine running in the page. It applies the same
 * validation, defaults and error statuses as the server and returns the same
 * JSON, so the dashboard cannot tell the two apart.
 */
export class DemoApi implements LedgerlineApi {
  constructor(private readonly world: DemoWorld) {}

  private get engine() {
    return this.world.engine;
  }

  /** True when the browser would not store the world; changes then last until the tab closes. */
  get saveFailed(): boolean {
    return this.world.saveFailed;
  }

  /** Drops the saved world. Reload the page to build a fresh one. */
  reset(): void {
    this.world.forget();
  }

  plans() {
    return this.call(() => this.engine.listPlans());
  }

  customers(query: PageQuery = {}) {
    return this.call(async () => {
      const page = pageOf(query);
      return { data: await this.engine.listCustomers(page), ...page };
    });
  }

  customer(id: string) {
    return this.call(async () => {
      const customer = await this.engine.getCustomer(id);
      return customerDetailDto(customer, await this.engine.listPaymentMethods(id), await this.engine.ledgerAccounts({ customerId: id }));
    });
  }

  attachCard(customerId: string, card: CardInput, makeDefault: boolean) {
    return this.call(async () => {
      checkCard(card);
      const method = await this.world.change((now) => this.engine.attachPaymentMethod(customerId, card, now, { makeDefault }));
      const customer = await this.engine.getCustomer(customerId);
      return paymentMethodDto(method, customer.defaultPaymentMethodId);
    });
  }

  setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    return this.call(() => this.world.change((now) => this.engine.setDefaultPaymentMethod(customerId, paymentMethodId, now)));
  }

  subscriptions(query: SubscriptionQuery = {}) {
    return this.call(async () => {
      const page = pageOf(query);
      return { data: await this.engine.listSubscriptions({ ...query, ...page }), ...page };
    });
  }

  previewPlanChange(subscriptionId: string, planId: string) {
    return this.call(async () => this.engine.previewPlanChange(subscriptionId, planId, await this.world.now()));
  }

  changePlan(subscriptionId: string, planId: string) {
    return this.call(() => this.world.change((now) => this.engine.changePlan(subscriptionId, planId, now)));
  }

  cancelAtPeriodEnd(subscriptionId: string) {
    return this.call(() => this.world.change((now) => this.engine.cancelAtPeriodEnd(subscriptionId, now)));
  }

  resume(subscriptionId: string) {
    return this.call(() => this.world.change((now) => this.engine.resume(subscriptionId, now)));
  }

  invoices(query: InvoiceQuery = {}) {
    return this.call(async () => {
      const page = pageOf(query);
      return { data: await this.engine.listInvoices({ ...query, ...page }), ...page };
    });
  }

  invoice(id: string) {
    return this.call(async () => {
      const { invoice, payments } = await this.engine.getInvoice(id);
      return invoiceDetailDto(invoice, payments);
    });
  }

  ledgerAccounts(customerId?: string) {
    return this.call(async () => (await this.engine.ledgerAccounts({ customerId })).map(accountDto));
  }

  journal(query: JournalQuery = {}) {
    return this.call(async () => {
      const page = pageOf(query);
      return { data: await this.engine.journal({ ...query, ...page }), ...page };
    });
  }

  trialBalance() {
    return this.call(() => this.engine.trialBalance());
  }

  metrics(days: number) {
    return this.call(async () => {
      if (!Number.isInteger(days) || days < 1 || days > 366) throw invalid('days must be between 1 and 366');
      return this.engine.metrics(await this.world.now(), { revenueDays: days });
    });
  }

  webhookEvents(query: PageQuery = {}) {
    return this.call(async () => {
      const page = pageOf(query);
      return { data: await this.engine.listWebhookEvents(page), ...page };
    });
  }

  clock() {
    return this.call(async () => ({ enabled: true, now: await this.world.now() }));
  }

  advanceClock(step: ClockStep) {
    return this.call(async () => {
      const from = await this.world.now();
      let to: Date;
      if ('days' in step) {
        if (!Number.isInteger(step.days) || step.days < 1 || step.days > 400) throw invalid('days must be between 1 and 400');
        to = new Date(from.getTime() + step.days * DAY_MS);
      } else {
        to = new Date(step.to);
        if (Number.isNaN(to.getTime())) throw invalid('to must be an ISO 8601 date-time');
      }
      return clockAdvanceDto(await this.world.advanceTo(to));
    });
  }

  private async call<T>(work: () => Promise<T>): Promise<Wire<T>> {
    try {
      return toWire(await work());
    } catch (error) {
      if (isBillingError(error)) {
        const status = statusForBillingError(error.code);
        throw status >= 500 ? new ApiError(status, 'internal_error', 'Something went wrong on our side') : new ApiError(status, error.code, error.message);
      }
      throw error;
    }
  }
}

export async function createDemoApi(options: OpenWorldOptions): Promise<DemoApi> {
  return new DemoApi(await DemoWorld.open(options));
}
