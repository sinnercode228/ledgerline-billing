import { useResource } from '../../api/api-context';
import type { AccountDto, CustomerDetail } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { Card, TableScroll } from '../../ui/Card';
import { Loaded } from '../../ui/Loaded';
import { Money } from '../../ui/Money';
import { Mono, PageHeader } from '../../ui/bits';
import { InvoiceTable } from '../invoices/InvoiceTable';
import { fetchAll } from '../shared';
import { PaymentMethodsCard } from './PaymentMethodsCard';
import { SubscriptionCard } from './SubscriptionCard';

function BalancesCard({ customer, accounts }: { customer: CustomerDetail; accounts: readonly AccountDto[] }) {
  const { t } = useI18n();
  return (
    <Card title={t('customer.balances')} flush>
      <TableScroll label={t('customer.balances')}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('ledger.account')}</th>
              <th scope="col" className="cell-num">
                {t('ledger.debits')}
              </th>
              <th scope="col" className="cell-num">
                {t('ledger.credits')}
              </th>
              <th scope="col" className="cell-num">
                {t('ledger.balance')}
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  {t(`account.${account.kind}`)}
                  <span className="cell-sub mono">{account.id.split(':')[0]}</span>
                </td>
                <td className="cell-num">
                  <Money amount={account.debits} currency={account.currency} />
                </td>
                <td className="cell-num">
                  <Money amount={account.credits} currency={account.currency} />
                </td>
                <td className="cell-num">
                  <Money amount={account.balance} currency={account.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="table-foot">
        {t('customer.credit')}: <Money amount={customer.creditBalance} currency={customer.currency} />
      </p>
    </Card>
  );
}

export function CustomerPage({ id }: { id: string }) {
  const { t, date } = useI18n();
  const data = useResource(`customer:${id}`, async (api) => {
    const [customer, subscriptions, invoices, accounts, plans, downgradeCredits, clock] = await Promise.all([
      api.customer(id),
      fetchAll((page) => api.subscriptions({ customerId: id, ...page })),
      fetchAll((page) => api.invoices({ customerId: id, ...page })),
      api.ledgerAccounts(id),
      api.plans(),
      fetchAll((page) => api.journal({ accountId: `customer_credit:${id}`, kind: 'downgrade_credit', ...page })),
      api.clock(),
    ]);
    return { customer, subscriptions, invoices, accounts, plans, downgradeCredits, now: clock.now ?? new Date().toISOString() };
  });

  return (
    <Loaded resource={data} rows={8}>
      {({ customer, subscriptions, invoices, accounts, plans, downgradeCredits, now }) => (
        <>
          <PageHeader
            back={{ to: { page: 'customers' }, label: t('customers.title') }}
            title={customer.name}
            subtitle={
              <>
                {customer.email} · {customer.currency} · {t('customer.since', { date: date(customer.createdAt) })} · <Mono>{customer.id}</Mono>
              </>
            }
          />
          <div className="grid-main-side">
            <div className="stack">
              {[...subscriptions]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((subscription) => (
                  <SubscriptionCard key={subscription.id} subscription={subscription} plans={plans} invoices={invoices} downgradeCredits={downgradeCredits} now={now} />
                ))}
            </div>
            <div className="stack">
              <PaymentMethodsCard customer={customer} now={now} />
              <BalancesCard customer={customer} accounts={accounts} />
            </div>
          </div>
          <Card title={t('customer.invoices')} flush>
            {invoices.length === 0 ? <p className="empty">{t('customer.noInvoices')}</p> : <InvoiceTable invoices={invoices} showCustomer={false} />}
          </Card>
        </>
      )}
    </Loaded>
  );
}
