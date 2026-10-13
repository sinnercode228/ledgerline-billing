import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { HttpApi } from '../src/api/http-client';

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('HttpApi', () => {
  it('sends the API key and only the query parameters that are set', async () => {
    const fetch = fakeFetch(200, { data: [], limit: 20, offset: 40 });
    const api = new HttpApi({ baseUrl: 'https://api.example.com/', apiKey: 'lk_test_key', fetch });
    await api.invoices({ customerId: 'cus_1', status: undefined, limit: 20, offset: 40 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/invoices?customerId=cus_1&limit=20&offset=40');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer lk_test_key');
  });

  it('posts JSON bodies and unwraps list envelopes the API puts around plain arrays', async () => {
    const post = fakeFetch(200, { id: 'sub_1', cancelAtPeriodEnd: true });
    await new HttpApi({ baseUrl: 'https://api.example.com', apiKey: 'k', fetch: post }).cancelAtPeriodEnd('sub_1');
    const [url, init] = post.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/subscriptions/sub_1/cancel');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');

    const accounts = fakeFetch(200, { data: [{ id: 'revenue:EUR' }] });
    const rows = await new HttpApi({ baseUrl: 'https://api.example.com', apiKey: 'k', fetch: accounts }).ledgerAccounts();
    expect(rows).toEqual([{ id: 'revenue:EUR' }]);
  });

  it('turns an error body into an ApiError with the status and code', async () => {
    const fetch = fakeFetch(422, { error: { code: 'interval_mismatch', message: 'plan changes keep the billing interval' } });
    const api = new HttpApi({ baseUrl: 'https://api.example.com', apiKey: 'k', fetch });
    const failure = api.previewPlanChange('sub_1', 'plan_team_yearly');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 422, code: 'interval_mismatch', message: 'plan changes keep the billing interval' });
  });

  it('tells the app when the key is refused', async () => {
    const onUnauthorized = vi.fn();
    const api = new HttpApi({ baseUrl: 'https://api.example.com', apiKey: 'wrong', fetch: fakeFetch(401, { error: { code: 'unauthorized', message: 'no' } }), onUnauthorized });
    await expect(api.plans()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('reports a server it cannot reach as a network error', async () => {
    const unreachable = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = new HttpApi({ baseUrl: 'https://api.example.com', apiKey: 'k', fetch: unreachable });
    await expect(api.clock()).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
});
