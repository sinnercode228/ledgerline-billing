import type { InvoiceStatus, PaymentStatus, SubscriptionStatus } from '@ledgerline/core';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/i18n';

export type Tone = 'positive' | 'info' | 'warning' | 'negative' | 'neutral';

export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string | undefined }) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      <span className="chip-dot" aria-hidden />
      {children}
    </span>
  );
}

type Status = SubscriptionStatus | InvoiceStatus | PaymentStatus;

const TONES: Record<Status, Tone> = {
  active: 'positive',
  paid: 'positive',
  succeeded: 'positive',
  trialing: 'info',
  open: 'info',
  pending: 'info',
  past_due: 'warning',
  failed: 'negative',
  uncollectible: 'negative',
  canceled: 'neutral',
  void: 'neutral',
  draft: 'neutral',
};

/** The status of a subscription, an invoice or a payment, in words and color. */
export function StatusChip({ status }: { status: Status }) {
  const { t } = useI18n();
  return <Chip tone={TONES[status]}>{t(`status.${status}`)}</Chip>;
}
