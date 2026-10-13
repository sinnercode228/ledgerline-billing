import type { InvoiceDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { TableScroll } from '../../ui/Card';
import { StatusChip } from '../../ui/Chip';
import { Money } from '../../ui/Money';
import { DateText, Mono, PeriodText, RouteLink } from '../../ui/bits';
import type { Directory } from '../directory';

/**
 * Invoices as a dense table; the customer column is left out on a customer's own page.
 * Most invoices bill a period of a subscription, so only prorations are marked.
 */
export function InvoiceTable({ invoices, directory, showCustomer = true }: { invoices: readonly InvoiceDto[]; directory?: Directory | undefined; showCustomer?: boolean }) {
  const { t } = useI18n();
  return (
    <TableScroll label={t('invoices.title')}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t('invoices.number')}</th>
            {showCustomer && <th scope="col">{t('common.customer')}</th>}
            <th scope="col">{t('common.period')}</th>
            <th scope="col">{t('common.status')}</th>
            <th scope="col" className="cell-num">
              {t('invoices.total')}
            </th>
            <th scope="col" className="cell-num">
              {t('invoices.credit')}
            </th>
            <th scope="col" className="cell-num">
              {t('invoices.due')}
            </th>
            <th scope="col" className="cell-num">
              {t('invoices.paid')}
            </th>
            <th scope="col">{t('invoices.issued')}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>
                <RouteLink to={{ page: 'invoice', id: invoice.id }}>
                  <Mono>{invoice.number ?? invoice.id}</Mono>
                </RouteLink>
                {invoice.kind === 'proration' && <span className="cell-sub">{t('invoiceKind.proration')}</span>}
              </td>
              {showCustomer && (
                <td className="nowrap">
                  <RouteLink to={{ page: 'customer', id: invoice.customerId }}>{directory?.customers.get(invoice.customerId)?.name ?? invoice.customerId}</RouteLink>
                </td>
              )}
              <td>
                <PeriodText start={invoice.periodStart} end={invoice.periodEnd} />
              </td>
              <td>
                <StatusChip status={invoice.status} />
              </td>
              <td className="cell-num">
                <Money amount={invoice.total} currency={invoice.currency} />
              </td>
              <td className="cell-num">{invoice.creditApplied > 0 ? <Money amount={invoice.creditApplied} currency={invoice.currency} /> : <span className="faint">—</span>}</td>
              <td className="cell-num">
                <Money amount={invoice.amountDue} currency={invoice.currency} />
              </td>
              <td className="cell-num">
                <Money amount={invoice.amountPaid} currency={invoice.currency} />
              </td>
              <td className="cell-date">
                <DateText iso={invoice.finalizedAt ?? invoice.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
