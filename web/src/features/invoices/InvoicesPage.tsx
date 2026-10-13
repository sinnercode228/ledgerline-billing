import { useState } from 'react';
import { useResource } from '../../api/api-context';
import { hrefFor, INVOICE_FILTERS, type InvoiceFilter } from '../../app/routes';
import { useI18n } from '../../i18n/i18n';
import { Card } from '../../ui/Card';
import { Loaded } from '../../ui/Loaded';
import { PageHeader, Pager, Segmented } from '../../ui/bits';
import { useDirectory } from '../directory';
import { InvoiceTable } from './InvoiceTable';

const PAGE = 50;

function InvoiceList({ status }: { status: InvoiceFilter | null }) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const directory = useDirectory();
  const invoices = useResource(`invoices:${status ?? 'all'}:${offset}`, (api) => api.invoices({ status: status ?? undefined, limit: PAGE, offset }));
  return (
    <Loaded resource={invoices} rows={12}>
      {(page) => (
        <>
          {page.data.length === 0 ? <p className="empty">{t('invoices.empty')}</p> : <InvoiceTable invoices={page.data} directory={directory.data} />}
          <Pager offset={offset} limit={PAGE} shown={page.data.length} onChange={setOffset} />
        </>
      )}
    </Loaded>
  );
}

export function InvoicesPage({ status }: { status: InvoiceFilter | null }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('invoices.title')} />
      <Card
        flush
        title={
          <Segmented
            label={t('common.status')}
            value={status ?? 'all'}
            onChange={(value) => {
              window.location.hash = hrefFor({ page: 'invoices', status: value === 'all' ? null : value });
            }}
            options={[{ value: 'all' as const, label: t('common.all') }, ...INVOICE_FILTERS.map((value) => ({ value, label: t(`status.${value}`) }))]}
          />
        }
      >
        <InvoiceList key={status ?? 'all'} status={status} />
      </Card>
    </>
  );
}
