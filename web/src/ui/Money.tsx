import type { Currency } from '@ledgerline/core';
import { useI18n } from '../i18n/i18n';

/** An amount in minor units, with tabular figures so columns line up. */
export function Money({ amount, currency, className }: { amount: number; currency: Currency; className?: string }) {
  const { money } = useI18n();
  return <span className={['num', amount < 0 ? 'num-negative' : '', className ?? ''].join(' ').trim()}>{money(amount, currency)}</span>;
}
