import type {
  accountDto,
  clockAdvanceDto,
  customerDetailDto,
  Currency,
  Customer,
  Invoice,
  InvoiceStatus,
  invoiceDetailDto,
  JournalTransaction,
  Metrics,
  paymentMethodDto,
  Plan,
  PlanChangePreview,
  PostingKind,
  Subscription,
  SubscriptionStatus,
  TrialBalance,
  WebhookEventRecord,
} from '@ledgerline/core';

/** What a value looks like after JSON: Dates arrive as ISO 8601 strings. */
export type Wire<T> = T extends Date
  ? string
  : T extends ReadonlyArray<infer Item>
    ? Wire<Item>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export type PlanDto = Wire<Plan>;
export type CustomerDto = Wire<Customer>;
export type CustomerDetail = Wire<ReturnType<typeof customerDetailDto>>;
export type PaymentMethodDto = Wire<ReturnType<typeof paymentMethodDto>>;
export type SubscriptionDto = Wire<Subscription>;
export type InvoiceDto = Wire<Invoice>;
export type InvoiceDetail = Wire<ReturnType<typeof invoiceDetailDto>>;
export type PaymentDto = InvoiceDetail['payments'][number];
export type AccountDto = Wire<ReturnType<typeof accountDto>>;
export type JournalTransactionDto = Wire<JournalTransaction>;
export type TrialBalanceDto = Wire<TrialBalance>;
export type MetricsDto = Wire<Metrics>;
export type WebhookEventDto = Wire<WebhookEventRecord>;
export type PlanChangePreviewDto = Wire<PlanChangePreview>;
export type ClockAdvanceDto = Wire<ReturnType<typeof clockAdvanceDto>>;
export type DayReportDto = ClockAdvanceDto['days'][number];

export interface PlanChangeResultDto {
  subscription: SubscriptionDto;
  preview: PlanChangePreviewDto;
  invoice: InvoiceDto | null;
}

export interface ClockDto {
  enabled: boolean;
  now: string | null;
}

export interface ListPage<T> {
  data: T[];
  limit: number;
  offset: number;
}

export interface PageQuery {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SubscriptionQuery extends PageQuery {
  customerId?: string | undefined;
  status?: SubscriptionStatus | undefined;
}

export interface InvoiceQuery extends PageQuery {
  customerId?: string | undefined;
  subscriptionId?: string | undefined;
  status?: InvoiceStatus | undefined;
}

export interface JournalQuery extends PageQuery {
  accountId?: string | undefined;
  invoiceId?: string | undefined;
  kind?: PostingKind | undefined;
}

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
}

export type ClockStep = { days: number } | { to: string };

export type { Currency };
