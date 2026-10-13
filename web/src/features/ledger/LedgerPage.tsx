import { CURRENCIES, type PostingKind } from '@ledgerline/core';
import { useId, useState } from 'react';
import { useResource } from '../../api/api-context';
import type { AccountDto, TrialBalanceDto } from '../../api/types';
import { hrefFor, LEDGER_TABS, type LedgerTab } from '../../app/routes';
import { useI18n } from '../../i18n/i18n';
import { Card, TableScroll } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { Loaded } from '../../ui/Loaded';
import { Money } from '../../ui/Money';
import { Mono, PageHeader, Pager } from '../../ui/bits';
import { useDirectory } from '../directory';
import { accountLabel } from './accounts';
import { JournalEntries } from './JournalEntries';

const PAGE = 25;
const POSTING_KINDS: readonly PostingKind[] = [
  'invoice_finalized',
  'payment_succeeded',
  'credit_applied',
  'downgrade_credit',
  'write_off',
  'refund',
  'overpayment_credit',
  'reversal',
];
const TAB_LABELS = { journal: 'ledger.journal', accounts: 'ledger.accounts', 'trial-balance': 'ledger.trialBalance' } as const;

function Journal() {
  const { t } = useI18n();
  const filterId = useId();
  const [kind, setKind] = useState<PostingKind | ''>('');
  const [offset, setOffset] = useState(0);
  const journal = useResource(`journal:${kind}:${offset}`, (api) => api.journal({ kind: kind || undefined, limit: PAGE, offset }));
  return (
    <Card
      flush
      title={
        <div className="toolbar">
          <label htmlFor={filterId} className="toolbar-label">
            {t('ledger.kind')}
          </label>
          <select
            id={filterId}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as PostingKind | '');
              setOffset(0);
            }}
          >
            <option value="">{t('ledger.allKinds')}</option>
            {POSTING_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`posting.${value}`)}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <Loaded resource={journal} rows={12}>
        {(page) => (
          <>
            {page.data.length === 0 ? <p className="empty">{t('ledger.empty')}</p> : <JournalEntries transactions={page.data} />}
            <Pager offset={offset} limit={PAGE} shown={page.data.length} onChange={setOffset} />
          </>
        )}
      </Loaded>
    </Card>
  );
}

function Accounts() {
  const i18n = useI18n();
  const { t } = i18n;
  const directory = useDirectory();
  const accounts = useResource('ledger:accounts', (api) => api.ledgerAccounts());
  const ordered = (rows: readonly AccountDto[]) =>
    CURRENCIES.map((currency) => ({
      currency,
      rows: rows.filter((row) => row.currency === currency).sort((a, b) => Number(a.customerId !== null) - Number(b.customerId !== null) || a.id.localeCompare(b.id)),
    }));
  return (
    <Card flush>
      <Loaded resource={accounts} rows={12}>
        {(rows) => (
          <TableScroll label={t('ledger.accounts')}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('ledger.account')}</th>
                  <th scope="col">{t('common.id')}</th>
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
              {ordered(rows).map((group) => (
                <tbody key={group.currency}>
                  <tr className="row-group">
                    <th scope="rowgroup" colSpan={5}>
                      {group.currency}
                    </th>
                  </tr>
                  {group.rows.map((row) => {
                    const label = accountLabel(i18n, row.id, directory.data);
                    return (
                      <tr key={row.id}>
                        <td className="cell-name">
                          {label.name}
                          {row.customerId && <span className="cell-sub">{label.owner}</span>}
                        </td>
                        <td>
                          <Mono>{row.id.length > 32 ? `${row.id.slice(0, 30)}…` : row.id}</Mono>
                        </td>
                        <td className="cell-num">
                          <Money amount={row.debits} currency={row.currency} />
                        </td>
                        <td className="cell-num">
                          <Money amount={row.credits} currency={row.currency} />
                        </td>
                        <td className="cell-num">
                          <Money amount={row.balance} currency={row.currency} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </TableScroll>
        )}
      </Loaded>
    </Card>
  );
}

function TrialBalanceView({ trial }: { trial: TrialBalanceDto }) {
  const { t, amount } = useI18n();
  return (
    <>
      <div className={trial.balanced ? 'trial-hero is-balanced' : 'trial-hero is-unbalanced'}>
        <span className="trial-hero-label">{t('ledger.net')}</span>
        <span className="trial-hero-value">{trial.balanced ? amount(0) : '≠ 0'}</span>
        <span className="trial-hero-state">
          <Icon name={trial.balanced ? 'check' : 'alert'} />
          {t(trial.balanced ? 'trial.balanced' : 'trial.unbalanced')}
        </span>
        <p className="trial-hero-text">{t('ledger.explainBalanced')}</p>
      </div>
      <TableScroll label={t('ledger.trialBalance')}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('common.currency')}</th>
              <th scope="col" className="cell-num">
                {t('ledger.debits')}
              </th>
              <th scope="col" className="cell-num">
                {t('ledger.credits')}
              </th>
              <th scope="col" className="cell-num">
                {t('ledger.net')}
              </th>
            </tr>
          </thead>
          <tbody>
            {trial.currencies.map((row) => (
              <tr key={row.currency} className={row.net === 0 ? undefined : 'row-alert'}>
                <th scope="row">{row.currency}</th>
                <td className="cell-num">
                  <Money amount={row.debits} currency={row.currency} />
                </td>
                <td className="cell-num">
                  <Money amount={row.credits} currency={row.currency} />
                </td>
                <td className="cell-num">
                  <Money amount={row.net} currency={row.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </>
  );
}

function TrialBalance() {
  const trial = useResource('trial-balance', (api) => api.trialBalance());
  return (
    <Card flush>
      <Loaded resource={trial} rows={4}>
        {(data) => <TrialBalanceView trial={data} />}
      </Loaded>
    </Card>
  );
}

export function LedgerPage({ tab }: { tab: LedgerTab }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('ledger.title')} />
      <nav className="tabs" aria-label={t('ledger.title')}>
        {LEDGER_TABS.map((value) => (
          <a key={value} href={hrefFor({ page: 'ledger', tab: value })} aria-current={value === tab ? 'page' : undefined}>
            {t(TAB_LABELS[value])}
          </a>
        ))}
      </nav>
      {tab === 'journal' && <Journal />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'trial-balance' && <TrialBalance />}
    </>
  );
}
