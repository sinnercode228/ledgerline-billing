import type { Currency } from '@ledgerline/core';
import { useI18n } from '../i18n/i18n';

/**
 * An amount in minor units, with tabular figures so columns line up.
 * `bare` leaves the symbol out where a heading already names the currency.
 */
export function Money({ amount, currency, bare = false, className }: { amount: number; currency: Currency; bare?: boolean; className?: string }) {
  const i18n = useI18n();
  return (
    <span className={['num', amount < 0 ? 'num-negative' : '', className ?? ''].join(' ').trim()}>{bare ? i18n.amount(amount) : i18n.money(amount, currency)}</span>
  );
}
