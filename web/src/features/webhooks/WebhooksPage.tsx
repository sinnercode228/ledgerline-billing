import type { WebhookOutcome } from '@ledgerline/core';
import { useState } from 'react';
import { useResource } from '../../api/api-context';
import type { WebhookEventDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { Card, TableScroll } from '../../ui/Card';
import { Chip, type Tone } from '../../ui/Chip';
import { Loaded } from '../../ui/Loaded';
import { Money } from '../../ui/Money';
import { DateText, Mono, PageHeader, Pager, RouteLink } from '../../ui/bits';

const PAGE = 50;

type Badge = 'processed' | 'duplicate' | 'ignored';

/** Three badges for six outcomes: did the event change anything, was it news we already had, or was it set aside. */
const BADGES: Record<WebhookOutcome, Badge> = {
  applied: 'processed',
  duplicate_payment_update: 'duplicate',
  stale_payment_update: 'ignored',
  unmatched: 'ignored',
  ignored_type: 'ignored',
  malformed: 'ignored',
};
const TONES: Record<Badge, Tone> = { processed: 'positive', duplicate: 'info', ignored: 'neutral' };

interface PaymentPayload {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  metadata?: { invoice_id?: unknown };
}

/** The payment an event is about, when its payload has one. Payloads are provider data, so every field is checked. */
function paymentOf(event: WebhookEventDto): { id: string; amount: number | null; currency: 'RUB' | 'EUR' | null; invoiceId: string | null } | null {
  const object = (event.payload as { data?: { object?: PaymentPayload & { object?: unknown; payment?: unknown } } } | null)?.data?.object;
  if (!object) return null;
  const id = object.object === 'refund' ? object.payment : object.id;
  if (typeof id !== 'string') return null;
  const currency = object.currency === 'RUB' || object.currency === 'EUR' ? object.currency : null;
  return {
    id,
    amount: typeof object.amount === 'number' ? object.amount : null,
    currency,
    invoiceId: typeof object.metadata?.invoice_id === 'string' ? object.metadata.invoice_id : null,
  };
}

function Events() {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const events = useResource(`webhooks:${offset}`, (api) => api.webhookEvents({ limit: PAGE, offset }));
  return (
    <Loaded resource={events} rows={12}>
      {(page) =>
        page.data.length === 0 ? (
          <p className="empty">{t('webhooks.empty')}</p>
        ) : (
          <>
            <TableScroll label={t('webhooks.title')}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('webhooks.received')}</th>
                    <th scope="col">{t('webhooks.type')}</th>
                    <th scope="col">{t('webhooks.payment')}</th>
                    <th scope="col" className="cell-num">
                      {t('common.amount')}
                    </th>
                    <th scope="col">{t('webhooks.outcome')}</th>
                    <th scope="col">{t('webhooks.meaning')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.map((event) => {
                    const payment = paymentOf(event);
                    const badge = event.outcome ? BADGES[event.outcome] : null;
                    return (
                      <tr key={event.id}>
                        <td className="cell-date">
                          <DateText iso={event.receivedAt} style="dateTime" />
                        </td>
                        <td>
                          <Mono>{event.type}</Mono>
                        </td>
                        <td>
                          {payment ? (
                            <>
                              <Mono>{payment.id}</Mono>
                              {payment.invoiceId && (
                                <RouteLink to={{ page: 'invoice', id: payment.invoiceId }} className="cell-sub">
                                  {t('ledger.forInvoice')}
                                </RouteLink>
                              )}
                            </>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="cell-num">{payment && payment.amount !== null && payment.currency ? <Money amount={payment.amount} currency={payment.currency} /> : ''}</td>
                        <td>{badge && <Chip tone={TONES[badge]} title={event.outcome ?? undefined}>{t(`webhook.${badge}`)}</Chip>}</td>
                        <td className="muted">{event.outcome && t(`webhookOutcome.${event.outcome}`)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <Pager offset={offset} limit={PAGE} shown={page.data.length} onChange={setOffset} />
          </>
        )
      }
    </Loaded>
  );
}

export function WebhooksPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('webhooks.title')} subtitle={t('webhooks.subtitle')} />
      <Card flush>
        <Events />
      </Card>
    </>
  );
}
