import { useSyncExternalStore } from 'react';
import type { InvoiceStatus } from '@ledgerline/core';

export const LEDGER_TABS = ['journal', 'accounts', 'trial-balance'] as const;
export type LedgerTab = (typeof LEDGER_TABS)[number];

export const INVOICE_FILTERS = ['open', 'paid', 'uncollectible'] as const satisfies readonly InvoiceStatus[];
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

/** Every page of the dashboard. Routes live in the hash so GitHub Pages can serve any of them. */
export type Route =
  | { page: 'overview' }
  | { page: 'customers' }
  | { page: 'customer'; id: string }
  | { page: 'invoices'; status: InvoiceFilter | null }
  | { page: 'invoice'; id: string }
  | { page: 'ledger'; tab: LedgerTab }
  | { page: 'webhooks' }
  | { page: 'not-found' };

const isOneOf = <T extends string>(values: readonly T[], value: string | null): value is T =>
  value !== null && (values as readonly string[]).includes(value);

export function parseRoute(hash: string): Route {
  const [path = '', search = ''] = hash.replace(/^#/, '').split('?');
  const query = new URLSearchParams(search);
  const [section = '', id] = path.split('/').filter(Boolean).map(decodeURIComponent);
  switch (section) {
    case '':
      return { page: 'overview' };
    case 'customers':
      return id === undefined ? { page: 'customers' } : { page: 'customer', id };
    case 'invoices': {
      if (id !== undefined) return { page: 'invoice', id };
      const status = query.get('status');
      return { page: 'invoices', status: isOneOf(INVOICE_FILTERS, status) ? status : null };
    }
    case 'ledger': {
      const tab = id ?? null;
      return { page: 'ledger', tab: isOneOf(LEDGER_TABS, tab) ? tab : 'journal' };
    }
    case 'webhooks':
      return { page: 'webhooks' };
    default:
      return { page: 'not-found' };
  }
}

export function hrefFor(route: Route): string {
  switch (route.page) {
    case 'overview':
    case 'not-found':
      return '#/';
    case 'customers':
      return '#/customers';
    case 'customer':
      return `#/customers/${encodeURIComponent(route.id)}`;
    case 'invoices':
      return route.status ? `#/invoices?status=${route.status}` : '#/invoices';
    case 'invoice':
      return `#/invoices/${encodeURIComponent(route.id)}`;
    case 'ledger':
      return `#/ledger/${route.tab}`;
    case 'webhooks':
      return '#/webhooks';
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = () => window.location.hash;

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, readHash));
}
