import type { JournalTransactionDto } from '../../api/types';
import { useI18n } from '../../i18n/i18n';
import { TableScroll } from '../../ui/Card';
import { Money } from '../../ui/Money';
import { DateText, RouteLink } from '../../ui/bits';
import { useDirectory } from '../directory';
import { accountLabel } from './accounts';

/** Journal transactions with their entries split into debit and credit columns, the way a ledger is read. */
export function JournalEntries({ transactions }: { transactions: readonly JournalTransactionDto[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const directory = useDirectory();
  return (
    <TableScroll label={t('ledger.journal')}>
      <table className="table journal">
        <thead>
          <tr>
            <th scope="col">{t('common.date')}</th>
            <th scope="col">{t('ledger.transaction')}</th>
            <th scope="col">{t('ledger.account')}</th>
            <th scope="col" className="cell-num">
              {t('ledger.debit')}
            </th>
            <th scope="col" className="cell-num">
              {t('ledger.credit')}
            </th>
          </tr>
        </thead>
        {transactions.map((transaction) => (
          <tbody key={transaction.id} className="journal-group">
            {transaction.entries.map((entry, i) => {
              const account = accountLabel(i18n, entry.accountId, directory.data);
              return (
                <tr key={`${entry.accountId}-${i}`}>
                  {i === 0 && (
                    <>
                      <td className="cell-date" rowSpan={transaction.entries.length}>
                        <DateText iso={transaction.postedAt} style="dateTime" />
                      </td>
                      <td className="journal-what" rowSpan={transaction.entries.length}>
                        <span className="journal-kind">{t(`posting.${transaction.kind}`)}</span>
                        {transaction.refs.invoiceId && (
                          <RouteLink to={{ page: 'invoice', id: transaction.refs.invoiceId }} className="cell-sub">
                            {t('ledger.forInvoice')}
                          </RouteLink>
                        )}
                      </td>
                    </>
                  )}
                  <td className={entry.amount < 0 ? 'journal-account is-credit' : 'journal-account'}>
                    {account.name}
                    <span className="cell-sub">{account.owner}</span>
                  </td>
                  <td className="cell-num">{entry.amount > 0 ? <Money amount={entry.amount} currency={transaction.currency} /> : ''}</td>
                  <td className="cell-num">{entry.amount < 0 ? <Money amount={-entry.amount} currency={transaction.currency} /> : ''}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </TableScroll>
  );
}
