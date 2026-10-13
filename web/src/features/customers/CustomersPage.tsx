import { useId, useState } from 'react';
import { useResource } from '../../api/api-context';
import type { CustomerDto, PlanDto, SubscriptionDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { Card, TableScroll } from '../../ui/Card';
import { StatusChip } from '../../ui/Chip';
import { Loaded } from '../../ui/Loaded';
import { Money } from '../../ui/Money';
import { DateText, PageHeader, RouteLink, Segmented } from '../../ui/bits';
import { fetchAll } from '../shared';

const STATUS_FILTERS = ['all', 'active', 'trialing', 'past_due', 'canceled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The subscription that describes a customer best: the newest one still running, else the newest. */
export function currentSubscription(subscriptions: readonly SubscriptionDto[]): SubscriptionDto | null {
  const newestFirst = [...subscriptions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return newestFirst.find((subscription) => subscription.status !== 'canceled') ?? newestFirst[0] ?? null;
}

function NextEvent({ subscription }: { subscription: SubscriptionDto }) {
  const { t, date } = useI18n();
  if (subscription.status === 'canceled') return <span className="muted">{t('customer.endedOn', { date: date(subscription.endedAt ?? subscription.updatedAt) })}</span>;
  if (subscription.cancelAtPeriodEnd) return <span className="text-warning">{t('customer.cancelsOn', { date: date(subscription.currentPeriodEnd) })}</span>;
  return <DateText iso={subscription.currentPeriodEnd} />;
}

function PlanPrice({ plan, currency }: { plan: PlanDto | undefined; currency: CustomerDto['currency'] }) {
  const { t } = useI18n();
  const price = plan?.prices[currency];
  if (!plan || price === undefined) return <span className="faint">—</span>;
  return (
    <>
      <Money amount={price} currency={currency} /> <span className="muted">{t(`interval.${plan.interval}`)}</span>
    </>
  );
}

export function CustomersPage() {
  const { t, plural } = useI18n();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const data = useResource('customers:list', async (api) => {
    const [customers, subscriptions, plans] = await Promise.all([
      fetchAll((page) => api.customers(page)),
      fetchAll((page) => api.subscriptions(page)),
      api.plans(),
    ]);
    return customers.map((customer) => {
      const subscription = currentSubscription(subscriptions.filter((s) => s.customerId === customer.id));
      return { customer, subscription, plan: plans.find((plan) => plan.id === subscription?.planId) };
    });
  });

  return (
    <>
      <PageHeader title={t('customers.title')} />
      <Card
        flush
        title={
          <div className="toolbar">
            <label htmlFor={searchId} className="visually-hidden">
              {t('customers.search')}
            </label>
            <input id={searchId} type="search" className="search" placeholder={t('customers.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
            <Segmented
              label={t('common.status')}
              value={status}
              onChange={setStatus}
              options={STATUS_FILTERS.map((value) => ({ value, label: value === 'all' ? t('common.all') : t(`status.${value}`) }))}
            />
          </div>
        }
      >
        <Loaded resource={data} rows={10}>
          {(rows) => {
            const needle = search.trim().toLowerCase();
            const shown = rows.filter(
              ({ customer, subscription }) =>
                (status === 'all' || subscription?.status === status) &&
                (needle === '' || customer.name.toLowerCase().includes(needle) || customer.email.toLowerCase().includes(needle)),
            );
            return (
              <>
                <TableScroll label={t('customers.title')}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{t('common.customer')}</th>
                        <th scope="col">{t('common.plan')}</th>
                        <th scope="col">{t('common.status')}</th>
                        <th scope="col" className="cell-num">
                          {t('customers.price')}
                        </th>
                        <th scope="col">{t('customers.nextEvent')}</th>
                        <th scope="col">{t('common.created')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(({ customer, subscription, plan }) => (
                        <tr key={customer.id}>
                          <td className="cell-name">
                            <RouteLink to={{ page: 'customer', id: customer.id }}>{customer.name}</RouteLink>
                            <span className="cell-sub">{customer.email}</span>
                          </td>
                          <td>{plan?.name ?? <span className="faint">{t('customers.noSubscription')}</span>}</td>
                          <td>{subscription && <StatusChip status={subscription.status} />}</td>
                          <td className="cell-num">
                            <PlanPrice plan={plan} currency={customer.currency} />
                          </td>
                          <td className="nowrap">{subscription && <NextEvent subscription={subscription} />}</td>
                          <td className="cell-date">
                            <DateText iso={customer.createdAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                {shown.length === 0 ? <p className="empty">{t('customers.empty')}</p> : <p className="table-foot">{plural('customers.count', shown.length)}</p>}
              </>
            );
          }}
        </Loaded>
      </Card>
    </>
  );
}
