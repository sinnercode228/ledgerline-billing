import { describe, expect, it } from 'vitest';
import { hrefFor, parseRoute, type Route } from '../src/app/routes';

describe('hash routes', () => {
  it('reads every page from the hash and writes it back the same way', () => {
    const routes: Route[] = [
      { page: 'overview' },
      { page: 'customers' },
      { page: 'customer', id: 'cus_0a1b2c' },
      { page: 'invoices', status: null },
      { page: 'invoices', status: 'open' },
      { page: 'invoice', id: 'in_9f8e' },
      { page: 'ledger', tab: 'journal' },
      { page: 'ledger', tab: 'trial-balance' },
      { page: 'webhooks' },
    ];
    for (const route of routes) expect(parseRoute(hrefFor(route))).toEqual(route);
  });

  it('opens the overview for an empty hash and reports unknown paths', () => {
    expect(parseRoute('')).toEqual({ page: 'overview' });
    expect(parseRoute('#/')).toEqual({ page: 'overview' });
    expect(parseRoute('#/ledger')).toEqual({ page: 'ledger', tab: 'journal' });
    expect(parseRoute('#/invoices?status=bogus')).toEqual({ page: 'invoices', status: null });
    expect(parseRoute('#/nowhere')).toEqual({ page: 'not-found' });
  });

  it('keeps ids intact when they need escaping', () => {
    expect(parseRoute(hrefFor({ page: 'customer', id: 'cus a/b' }))).toEqual({ page: 'customer', id: 'cus a/b' });
  });
});
