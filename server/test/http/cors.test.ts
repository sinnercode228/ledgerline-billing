import { afterEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, type TestApp } from '../helpers/app.js';

const DASHBOARD = 'https://dashboard.example.com';

describe('HTTP: cross-origin access for the dashboard', () => {
  let t: TestApp | undefined;
  afterEach(() => t?.app.close());

  it('answers the preflight for an allowed origin, including the headers the dashboard sends', async () => {
    t = await createTestApp({ corsOrigins: [DASHBOARD] });
    const preflight = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/customers',
      headers: {
        origin: DASHBOARD,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, idempotency-key',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(DASHBOARD);
    expect(String(preflight.headers['access-control-allow-headers']).toLowerCase()).toContain('idempotency-key');

    const list = await t.app.inject({ method: 'GET', url: '/v1/plans', headers: { ...auth, origin: DASHBOARD } });
    expect(list.statusCode).toBe(200);
    expect(list.headers['access-control-allow-origin']).toBe(DASHBOARD);
  });

  it('gives other origins no access headers', async () => {
    t = await createTestApp({ corsOrigins: [DASHBOARD] });
    const response = await t.app.inject({ method: 'GET', url: '/v1/plans', headers: { ...auth, origin: 'https://elsewhere.example.com' } });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows no origin unless configured', async () => {
    t = await createTestApp();
    const response = await t.app.inject({ method: 'GET', url: '/v1/plans', headers: { ...auth, origin: DASHBOARD } });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
