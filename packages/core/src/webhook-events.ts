export type WebhookOutcome =
  | 'applied'
  | 'duplicate_payment_update'
  | 'stale_payment_update'
  | 'unmatched'
  | 'ignored_type'
  | 'malformed';

export interface WebhookEventRecord {
  id: string;
  /** Unique: a redelivered event is acknowledged without being processed again. */
  providerEventId: string;
  type: string;
  payload: unknown;
  receivedAt: Date;
  processedAt: Date | null;
  outcome: WebhookOutcome | null;
  note: string | null;
}
