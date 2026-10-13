import { CURRENCIES, type Currency } from '@ledgerline/core';
import { useState } from 'react';
import { useResource } from '../../api/api-context';
import type { JournalTransactionDto, MetricsDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { Card, TableScroll } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Loaded } from '../../ui/Loaded';
import { Money } from '../../ui/Money';
import { DateText, PageHeader, RouteLink, Segmented } from '../../ui/bits';
import { useDirectory, type Directory } from '../directory';
import { fetchAll } from '../shared';
import { ComingUp } from './ComingUp';
import { RevenueChart, type RevenuePoint } from './RevenueChart';

const RANGES = [30, 90] as const;
type Range = (typeof RANGES)[number];

/** Every day of the range, with zero where the engine booked nothing. */
function dailySeries(metrics: MetricsDto, currency: Currency, days: number): RevenuePoint[] {
  const amounts = new Map(metrics.revenueByDay.filter((row) => row.currency === currency).map((row) => [row.day, row.amount]));
  const today = Date.parse(`${metrics.asOf.slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, amount: amounts.get(day) ?? 0 };
  });
}

function Tiles({ metrics }: { metrics: MetricsDto }) {
  const { t, money } = useI18n();
  const tiles = [
    ...metrics.mrr.map((row) => ({ key: `mrr-${row.currency}`, label: t('overview.mrr', { currency: row.currency }), value: money(row.amount, row.currency), tone: '' })),
    { key: 'active', label: t('overview.active'), value: String(metrics.subscriptions.active), tone: '' },
    { key: 'trialing', label: t('overview.trialing'), value: String(metrics.subscriptions.trialing), tone: '' },
    { key: 'past-due', label: t('overview.pastDue'), value: String(metrics.subscriptions.past_due), tone: metrics.subscriptions.past_due > 0 ? 'tile-warning' : '' },
    { key: 'churn', label: t('overview.churn'), value: String(metrics.churnedLast30Days), tone: '' },
  ];
  return (
    <div className="tiles">
      {tiles.map((tile) => (
        <div key={tile.key} className={`tile ${tile.tone}`.trim()}>
          <span className="tile-label">{tile.label}</span>
          <span className="tile-value">{tile.value}</span>
        </div>
      ))}
    </div>
  );
}

function Revenue() {
  const { t } = useI18n();
  const [days, setDays] = useState<Range>(30);
  const [currency, setCurrency] = useState<Currency>('RUB');
  const metrics = useResource(`metrics:${days}`, (api) => api.metrics(days));
  return (
    <Card
      title={t('overview.revenue', { currency })}
      subtitle={t('overview.revenueHint')}
      actions={
        <>
          <Segmented label={t('common.currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((value) => ({ value, label: value }))} />
          <Segmented
            label={t('common.period')}
            value={String(days)}
            onChange={(value) => setDays(Number(value) as Range)}
            options={RANGES.map((range) => ({ value: String(range), label: t('overview.days', { days: range }) }))}
          />
        </>
      }
    >
      <Loaded resource={metrics} rows={6}>
        {(data) => <RevenueChart points={dailySeries(data, currency, days)} currency={currency} label={t('overview.revenue', { currency })} />}
      </Loaded>
    </Card>
  );
}

function PastDue({ directory }: { directory: Directory | undefined }) {
  const { t, date } = useI18n();
  const pastDue = useResource('overview:past-due', async (api) => {
    const [subscriptions, open] = await Promise.all([
      fetchAll((page) => api.subscriptions({ status: 'past_due', ...page })),
      fetchAll((page) => api.invoices({ status: 'open', ...page })),
    ]);
    return subscriptions.map((subscription) => {
      const invoices = open.filter((invoice) => invoice.subscriptionId === subscription.id);
      const retries = invoices.map((invoice) => invoice.nextRetryAt).filter((at): at is string => at !== null).sort();
      return {
        subscription,
        owed: invoices.reduce((sum, invoice) => sum + invoice.amountDue - invoice.amountPaid, 0),
        attempts: invoices.reduce((sum, invoice) => sum + invoice.attemptCount, 0),
        nextRetry: retries[0] ?? null,
      };
    });
  });
  return (
    <Card title={t('overview.attention')} flush>
      <Loaded resource={pastDue} rows={3}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="empty">{t('overview.noPastDue')}</p>
          ) : (
            <ul className="attention-list">
              {rows.map((row) => (
                <li key={row.subscription.id}>
                  <div>
                    <RouteLink to={{ page: 'customer', id: row.subscription.customerId }}>
                      {directory?.customers.get(row.subscription.customerId)?.name ?? row.subscription.customerId}
                    </RouteLink>
                    <span className="cell-sub">
                      {row.nextRetry ? `${t('overview.nextRetry')}: ${date(row.nextRetry)}` : t('overview.dunningOver')} · {t('overview.attempts')}: {row.attempts}
                    </span>
                  </div>
                  <Money amount={row.owed} currency={row.subscription.currency} />
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Card>
  );
}

function amountOf(transaction: JournalTransactionDto): number {
  return transaction.entries.reduce((sum, entry) => sum + Math.max(entry.amount, 0), 0);
}

function LatestEvents({ directory }: { directory: Directory | undefined }) {
  const { t } = useI18n();
  const journal = useResource('overview:journal', (api) => api.journal({ limit: 8 }));
  return (
    <Card title={t('overview.latest')} flush actions={<RouteLink to={{ page: 'ledger', tab: 'journal' }}>{t('ledger.journal')}</RouteLink>}>
      <Loaded resource={journal} rows={8}>
        {(page) => (
          <TableScroll label={t('overview.latest')}>
            <table className="table">
              <tbody>
                {page.data.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="cell-date">
                      <DateText iso={transaction.postedAt} style="dateTime" />
                    </td>
                    <td>
                      <Chip tone={transaction.kind === 'write_off' ? 'negative' : transaction.kind === 'payment_succeeded' ? 'positive' : 'neutral'}>
                        {t(`posting.${transaction.kind}`)}
                      </Chip>
                    </td>
                    <td className="cell-name">
                      {transaction.refs.customerId ? (
                        <RouteLink to={{ page: 'customer', id: transaction.refs.customerId }}>
                          {directory?.customers.get(transaction.refs.customerId)?.name ?? transaction.refs.customerId}
                        </RouteLink>
                      ) : (
                        '—'
                      )}
                      {transaction.refs.invoiceId && (
                        <RouteLink to={{ page: 'invoice', id: transaction.refs.invoiceId }} className="cell-sub">
                          {t('ledger.forInvoice')}
                        </RouteLink>
                      )}
                    </td>
                    <td className="cell-num">
                      <Money amount={amountOf(transaction)} currency={transaction.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Loaded>
    </Card>
  );
}

export function OverviewPage() {
  const { t, date } = useI18n();
  const metrics = useResource('metrics:30', (api) => api.metrics(30));
  const directory = useDirectory();
  return (
    <>
      <PageHeader title={t('overview.title')} subtitle={metrics.data ? date(metrics.data.asOf, 'weekdayDate') : undefined} />
      <Loaded resource={metrics} rows={2}>
        {(data) => <Tiles metrics={data} />}
      </Loaded>
      <div className="grid-main-side">
        <div className="stack">
          <Revenue />
          <LatestEvents directory={directory.data} />
        </div>
        <div className="stack">
          <PastDue directory={directory.data} />
          <ComingUp directory={directory.data} />
        </div>
      </div>
    </>
  );
}
