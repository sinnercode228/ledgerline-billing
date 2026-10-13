import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, type TestApp } from '../helpers/app.js';

describe('HTTP: authentication, validation and error shape', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.app.close());

  it('requires the bearer API key on every /v1 route', async () => {
    const missing = await t.app.inject({ method: 'GET', url: '/v1/plans' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });

    const wrong = await t.app.inject({ method: 'GET', url: '/v1/plans', headers: { authorization: 'Bearer lk_test_wrong_key_wrong_key_wrong_key' } });
    expect(wrong.statusCode).toBe(401);
    const basic = await t.app.inject({ method: 'GET', url: '/v1/plans', headers: { authorization: 'Basic Zm9vOmJhcg==' } });
    expect(basic.statusCode).toBe(401);

    const ok = await t.app.inject({ method: 'GET', url: '/v1/plans', headers: auth });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: unknown[] }>().data).toHaveLength(5);
  });

  it('leaves the health check and the webhook endpoint to their own checks', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const webhook = await t.app.inject({ method: 'POST', url: '/webhooks/payrail', payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(webhook.statusCode).toBe(400);
    expect(webhook.json()).toMatchObject({ error: { code: 'signature_missing' } });
  });

  it('demands an Idempotency-Key on create endpoints', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: auth,
      payload: { name: 'Borealis Analytics', email: 'billing@borealis.example.com', currency: 'RUB' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'idempotency_key_required' } });
  });

  it('rejects invalid bodies with the failing fields', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { ...auth, 'idempotency-key': 'cus-001' },
      payload: { name: '', email: 'not-an-email', currency: 'USD' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; details: { issues: Array<{ path: string }> } } }>();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.issues.map((i) => i.path).sort()).toEqual(['currency', 'email', 'name']);
  });

  it('answers malformed JSON, unknown routes and unknown ids in the same error format', async () => {
    const malformed = await t.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { ...auth, 'idempotency-key': 'cus-002', 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: 'invalid_json' } });

    const route = await t.app.inject({ method: 'GET', url: '/v1/nothing-here', headers: auth });
    expect(route.statusCode).toBe(404);
    expect(route.json()).toMatchObject({ error: { code: 'route_not_found' } });

    const customer = await t.app.inject({ method: 'GET', url: '/v1/customers/cus_missing', headers: auth });
    expect(customer.statusCode).toBe(404);
    expect(customer.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('maps domain errors to stable codes and statuses', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { ...auth, 'idempotency-key': 'cus-003' },
      payload: { name: 'Kettle & Co', email: 'ap@kettle.example.com', currency: 'EUR' },
    });
    const customer = created.json<{ id: string }>();

    const conflict = await t.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { ...auth, 'idempotency-key': 'cus-003' },
      payload: { name: 'Someone else', email: 'ap@kettle.example.com', currency: 'EUR' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'idempotency_conflict' } });

    const noCard = await t.app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: { ...auth, 'idempotency-key': 'sub-001' },
      payload: { customerId: customer.id, planId: 'plan_business_monthly' },
    });
    expect(noCard.statusCode).toBe(422);
    expect(noCard.json()).toMatchObject({ error: { code: 'payment_method_required' } });

    const badCard = await t.app.inject({
      method: 'POST',
      url: `/v1/customers/${customer.id}/payment-methods`,
      headers: auth,
      payload: { card: { number: '4111111111111111', expMonth: 12, expYear: 2030 } },
    });
    expect(badCard.statusCode).toBe(422);
    expect(badCard.json()).toMatchObject({ error: { code: 'card_not_supported' } });
  });

  it('hides the test clock unless it is enabled', async () => {
    const response = await t.app.inject({ method: 'POST', url: '/v1/test-clock/advance', headers: auth, payload: { days: 1 } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'test_clock_disabled' } });
    const status = await t.app.inject({ method: 'GET', url: '/v1/test-clock', headers: auth });
    expect(status.json()).toEqual({ enabled: false, now: null });
  });
});
