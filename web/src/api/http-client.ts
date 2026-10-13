import { ApiError, type LedgerlineApi } from './client';
import type {
  AccountDto,
  CardInput,
  ClockAdvanceDto,
  ClockDto,
  ClockStep,
  CustomerDetail,
  CustomerDto,
  InvoiceDetail,
  InvoiceDto,
  InvoiceQuery,
  JournalQuery,
  JournalTransactionDto,
  ListPage,
  MetricsDto,
  PageQuery,
  PaymentMethodDto,
  PlanChangePreviewDto,
  PlanChangeResultDto,
  PlanDto,
  SubscriptionDto,
  SubscriptionQuery,
  TrialBalanceDto,
  WebhookEventDto,
} from './types';

export interface HttpApiOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  /** Called when the server refuses the key, so the app can ask for another one. */
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | undefined>;

const id = encodeURIComponent;

/** The Ledgerline HTTP API, as documented in docs/api.md. */
export class HttpApi implements LedgerlineApi {
  private readonly baseUrl: string;
  private readonly send: typeof fetch;

  constructor(private readonly options: HttpApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // Bound so the browser's fetch is not called as a method of this object.
    this.send = options.fetch ?? fetch.bind(globalThis);
  }

  async plans() {
    return (await this.get<{ data: PlanDto[] }>('/v1/plans')).data;
  }

  customers(query: PageQuery = {}) {
    return this.get<ListPage<CustomerDto>>('/v1/customers', { ...query });
  }

  customer(customerId: string) {
    return this.get<CustomerDetail>(`/v1/customers/${id(customerId)}`);
  }

  attachCard(customerId: string, card: CardInput, makeDefault: boolean) {
    return this.post<PaymentMethodDto>(`/v1/customers/${id(customerId)}/payment-methods`, { card, makeDefault });
  }

  setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    return this.post<CustomerDto>(`/v1/customers/${id(customerId)}/payment-methods/${id(paymentMethodId)}/default`);
  }

  subscriptions(query: SubscriptionQuery = {}) {
    return this.get<ListPage<SubscriptionDto>>('/v1/subscriptions', { ...query });
  }

  previewPlanChange(subscriptionId: string, planId: string) {
    return this.post<PlanChangePreviewDto>(`/v1/subscriptions/${id(subscriptionId)}/plan-change/preview`, { planId });
  }

  changePlan(subscriptionId: string, planId: string) {
    return this.post<PlanChangeResultDto>(`/v1/subscriptions/${id(subscriptionId)}/plan-change`, { planId });
  }

  cancelAtPeriodEnd(subscriptionId: string) {
    return this.post<SubscriptionDto>(`/v1/subscriptions/${id(subscriptionId)}/cancel`);
  }

  resume(subscriptionId: string) {
    return this.post<SubscriptionDto>(`/v1/subscriptions/${id(subscriptionId)}/resume`);
  }

  invoices(query: InvoiceQuery = {}) {
    return this.get<ListPage<InvoiceDto>>('/v1/invoices', { ...query });
  }

  invoice(invoiceId: string) {
    return this.get<InvoiceDetail>(`/v1/invoices/${id(invoiceId)}`);
  }

  async ledgerAccounts(customerId?: string) {
    return (await this.get<{ data: AccountDto[] }>('/v1/ledger/accounts', { customerId })).data;
  }

  journal(query: JournalQuery = {}) {
    return this.get<ListPage<JournalTransactionDto>>('/v1/ledger/journal', { ...query });
  }

  trialBalance() {
    return this.get<TrialBalanceDto>('/v1/ledger/trial-balance');
  }

  metrics(days: number) {
    return this.get<MetricsDto>('/v1/metrics', { days });
  }

  webhookEvents(query: PageQuery = {}) {
    return this.get<ListPage<WebhookEventDto>>('/v1/webhook-events', { ...query });
  }

  clock() {
    return this.get<ClockDto>('/v1/test-clock');
  }

  advanceClock(step: ClockStep) {
    return this.post<ClockAdvanceDto>('/v1/test-clock/advance', step);
  }

  private get<T>(path: string, query: Query = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const search = params.size > 0 ? `?${params.toString()}` : '';
    return this.request<T>('GET', `${path}${search}`);
  }

  private post<T>(path: string, body: object = {}): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const headers = new Headers({ authorization: `Bearer ${this.options.apiKey}` });
    if (body !== undefined) headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await this.send(`${this.baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw new ApiError(0, 'network_error', error instanceof Error ? error.message : 'the API could not be reached');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) this.options.onUnauthorized?.();
      const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(response.status, error?.code ?? 'http_error', error?.message ?? `${response.status} ${response.statusText}`);
    }
    return payload as T;
  }
}
