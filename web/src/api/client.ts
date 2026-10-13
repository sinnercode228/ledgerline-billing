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

/**
 * Everything the dashboard asks of Ledgerline. One implementation calls the
 * HTTP API; the other runs the engine in the browser for the demo. Both
 * answer with the API's JSON shapes.
 */
export interface LedgerlineApi {
  plans(): Promise<PlanDto[]>;

  customers(query?: PageQuery): Promise<ListPage<CustomerDto>>;
  customer(id: string): Promise<CustomerDetail>;
  attachCard(customerId: string, card: CardInput, makeDefault: boolean): Promise<PaymentMethodDto>;
  setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<CustomerDto>;

  subscriptions(query?: SubscriptionQuery): Promise<ListPage<SubscriptionDto>>;
  previewPlanChange(subscriptionId: string, planId: string): Promise<PlanChangePreviewDto>;
  changePlan(subscriptionId: string, planId: string): Promise<PlanChangeResultDto>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<SubscriptionDto>;
  resume(subscriptionId: string): Promise<SubscriptionDto>;

  invoices(query?: InvoiceQuery): Promise<ListPage<InvoiceDto>>;
  invoice(id: string): Promise<InvoiceDetail>;

  ledgerAccounts(customerId?: string): Promise<AccountDto[]>;
  journal(query?: JournalQuery): Promise<ListPage<JournalTransactionDto>>;
  trialBalance(): Promise<TrialBalanceDto>;
  metrics(days: number): Promise<MetricsDto>;
  webhookEvents(query?: PageQuery): Promise<ListPage<WebhookEventDto>>;

  clock(): Promise<ClockDto>;
  advanceClock(step: ClockStep): Promise<ClockAdvanceDto>;
}

/** An error the API answered with: `{ error: { code, message } }` and its status. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The API caps list pages at this size. */
export const MAX_PAGE = 200;
