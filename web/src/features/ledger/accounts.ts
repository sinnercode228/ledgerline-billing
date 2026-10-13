import type { AccountKind } from '@ledgerline/core';
import type { I18n } from '../../i18n/i18n';
import type { Directory } from '../directory';

const KIND_BY_PREFIX: Record<string, AccountKind> = {
  receivable: 'accounts_receivable',
  customer_credit: 'customer_credit',
  revenue: 'revenue',
  provider_clearing: 'provider_clearing',
  bad_debt: 'bad_debt',
};

/** Account ids are `<kind>:<customer id or currency>`, as docs/api.md lists them. */
export function parseAccountId(accountId: string): { kind: AccountKind | null; owner: string } {
  const split = accountId.indexOf(':');
  return { kind: KIND_BY_PREFIX[accountId.slice(0, split)] ?? null, owner: accountId.slice(split + 1) };
}

export function accountLabel(i18n: I18n, accountId: string, directory: Directory | undefined): { name: string; owner: string } {
  const { kind, owner } = parseAccountId(accountId);
  return {
    name: kind ? i18n.t(`account.${kind}`) : accountId,
    owner: directory?.customers.get(owner)?.name ?? owner,
  };
}
