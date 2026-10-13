import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, type TestApp } from '../helpers/app.js';
import { testStores } from '../helpers/stores.js';

describe.each(testStores())('HTTP: billing flow through the API on %s', (_name, open) => {
  let t: TestApp;
  let close: () => Promise<void>;
  beforeEach(async () => {
    const { store, close: closeStore } = await open();
    close = closeStore;
    t = await createTestApp({ store, testClock: true, now: new Date('2026-02-01T00:00:00Z') });
  });
  afterEach(async () => {
    await t.app.close();
    await close();
  });

  const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
    t.app.inject({ method: 'POST', url, payload, headers: { ...auth, ...headers } });
  const get = (url: string) => t.app.inject({ method: 'GET', url, headers: auth });

  it('subscribes, prorates an upgrade, bills renewals and exposes the ledger and metrics', async () => {
    const customer = await post(
      '/v1/customers',
      { name: 'Wayfarer Maps', email: 'finance@wayfarer.example.com', currency: 'EUR' },
      { 'idempotency-key': 'cus-wayfarer' },
    );
    expect(customer.statusCode).toBe(201);
    const { id: customerId } = customer.json<{ id: string }>();
    const replay = await post(
      '/v1/customers',
      { name: 'Wayfarer Maps', email: 'finance@wayfarer.example.com', currency: 'EUR' },
      { 'idempotency-key': 'cus-wayfarer' },
    );
    expect(replay.json<{ id: string }>().id).toBe(customerId);

    const card = await post(`/v1/customers/${customerId}/payment-methods`, { card: { number: '4242 4242 4242 4242', expMonth: 12, expYear: 2029 } });
    expect(card.statusCode).toBe(201);
    expect(card.json()).toMatchObject({ brand: 'visa', last4: '4242', isDefault: true });
    expect(card.json()).not.toHaveProperty('providerToken');

    const subscription = await post('/v1/subscriptions', { customerId, planId: 'plan_starter_monthly' }, { 'idempotency-key': 'sub-wayfarer' });
    expect(subscription.statusCode).toBe(201);
    const { id: subscriptionId } = subscription.json<{ id: string }>();
    expect(subscription.json()).toMatchObject({ status: 'trialing', trialEnd: '2026-02-15T00:00:00.000Z' });

    const advanced = await post('/v1/test-clock/advance', { days: 21 });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toMatchObject({ from: '2026-02-01T00:00:00.000Z', to: '2026-02-22T00:00:00.000Z' });
    expect(advanced.json<{ days: unknown[] }>().days).toHaveLength(21);

    const preview = await post(`/v1/subscriptions/${subscriptionId}/plan-change/preview`, { planId: 'plan_team_monthly' });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      effect: 'invoice_now',
      credit: 675,
      charge: 2175,
      net: 1500,
      lines: [
        { kind: 'proration_credit', amount: -675, periodStart: '2026-02-22T00:00:00.000Z' },
        { kind: 'proration_charge', amount: 2175 },
      ],
    });
    expect((await get(`/v1/subscriptions/${subscriptionId}`)).json()).toMatchObject({ planId: 'plan_starter_monthly' });

    const change = await post(`/v1/subscriptions/${subscriptionId}/plan-change`, { planId: 'plan_team_monthly' });
    expect(change.statusCode).toBe(200);
    expect(change.json()).toMatchObject({ subscription: { planId: 'plan_team_monthly' }, invoice: { kind: 'proration', total: 1500, status: 'paid' } });

    const invoices = await get(`/v1/invoices?subscriptionId=${subscriptionId}`);
    const [latest] = invoices.json<{ data: Array<{ id: string; number: string }> }>().data;
    const detail = await get(`/v1/invoices/${latest!.id}`);
    expect(detail.json()).toMatchObject({
      number: 'LL-2026-000002',
      lines: [{ description: 'Unused time on Starter' }, { description: 'Remaining time on Team' }],
      payments: [{ attempt: 1, status: 'succeeded' }],
    });

    const trial = await get('/v1/ledger/trial-balance');
    expect(trial.json()).toEqual({ balanced: true, currencies: [{ currency: 'EUR', debits: 4800, credits: 4800, net: 0 }] });
    const accounts = await get(`/v1/ledger/accounts?customerId=${customerId}`);
    expect(accounts.json<{ data: Array<{ id: string; balance: number }> }>().data.map((a) => a.id).sort()).toEqual([
      `customer_credit:${customerId}`,
      `receivable:${customerId}`,
    ]);
    const journal = await get('/v1/ledger/journal?kind=invoice_finalized');
    expect(journal.json<{ data: Array<{ entries: unknown[] }> }>().data).toHaveLength(2);

    const metrics = await get('/v1/metrics');
    expect(metrics.json()).toMatchObject({
      mrr: [
        { currency: 'RUB', amount: 0 },
        { currency: 'EUR', amount: 2900 },
      ],
      subscriptions: { active: 1 },
    });

    const cancel = await post(`/v1/subscriptions/${subscriptionId}/cancel`, {});
    expect(cancel.json()).toMatchObject({ cancelAtPeriodEnd: true });
    const resume = await post(`/v1/subscriptions/${subscriptionId}/resume`, {});
    expect(resume.json()).toMatchObject({ cancelAtPeriodEnd: false });

    const clock = await get('/v1/test-clock');
    expect(clock.json()).toEqual({ enabled: true, now: '2026-02-22T00:00:00.000Z' });
    const events = await get('/v1/webhook-events');
    expect(events.statusCode).toBe(200);
  });

  it('manages cards, retries a past-due invoice with a new default card and refunds it', async () => {
    const created = await post(
      '/v1/customers',
      { name: 'Gristmill Tools', email: 'ap@gristmill.example.com', currency: 'RUB' },
      { 'idempotency-key': 'cus-gristmill' },
    );
    const { id: customerId } = created.json<{ id: string }>();
    const declined = await post(`/v1/customers/${customerId}/payment-methods`, { card: { number: '4000000000000002', expMonth: 3, expYear: 2030 } });
    const subscription = await post('/v1/subscriptions', { customerId, planId: 'plan_business_monthly' }, { 'idempotency-key': 'sub-gristmill' });
    expect(subscription.json()).toMatchObject({ status: 'past_due' });
    const { id: subscriptionId } = subscription.json<{ id: string }>();

    const spare = await post(`/v1/customers/${customerId}/payment-methods`, {
      card: { number: '4242424242424242', expMonth: 3, expYear: 2030 },
      makeDefault: false,
    });
    expect(spare.json()).toMatchObject({ isDefault: false });
    expect((await get(`/v1/subscriptions/${subscriptionId}`)).json()).toMatchObject({ status: 'past_due' });

    const { id: spareId } = spare.json<{ id: string }>();
    const switched = await post(`/v1/customers/${customerId}/payment-methods/${spareId}/default`, {});
    expect(switched.json()).toMatchObject({ defaultPaymentMethodId: spareId });
    expect((await get(`/v1/subscriptions/${subscriptionId}`)).json()).toMatchObject({ status: 'active' });

    const customer = await get(`/v1/customers/${customerId}`);
    expect(customer.json()).toMatchObject({
      creditBalance: 0,
      paymentMethods: expect.arrayContaining([
        expect.objectContaining({ id: declined.json<{ id: string }>().id, isDefault: false }),
        expect.objectContaining({ id: spareId, isDefault: true }),
      ]),
    });

    const [invoice] = (await get(`/v1/invoices?subscriptionId=${subscriptionId}`)).json<{ data: Array<{ id: string }> }>().data;
    const detail = await get(`/v1/invoices/${invoice!.id}`);
    expect(detail.json<{ payments: Array<{ trigger: string; status: string }> }>().payments.map((p) => [p.trigger, p.status])).toEqual([
      ['initial', 'failed'],
      ['payment_method_updated', 'succeeded'],
    ]);
    const refund = await post(`/v1/invoices/${invoice!.id}/refund`, {});
    expect(refund.json()).toMatchObject({ status: 'paid', amountRefunded: 990_000 });
    expect((await get('/v1/ledger/trial-balance')).json()).toMatchObject({ balanced: true });
  });

  it('validates query parameters and plan changes', async () => {
    expect((await get('/v1/invoices?limit=0')).statusCode).toBe(400);
    expect((await get('/v1/invoices?status=lost')).statusCode).toBe(400);
    expect((await get('/v1/customers?limit=500')).json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect((await post('/v1/test-clock/advance', { days: 0 })).statusCode).toBe(400);
    expect((await post('/v1/test-clock/advance', { to: '2020-01-01T00:00:00Z' })).json()).toMatchObject({ error: { code: 'invalid_argument' } });
  });

  it('answers text the database cannot store with a validation error', async () => {
    const lookups = ['/v1/customers/cus_%00', '/v1/invoices/in_%00', '/v1/subscriptions/sub_%00', '/v1/invoices?customerId=cus_%00', '/v1/ledger/journal?accountId=receivable%00'];
    for (const url of lookups) {
      const response = await get(url);
      expect([url, response.statusCode]).toEqual([url, 400]);
      expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
    }
    const customer = await post('/v1/customers', { name: 'Nul\u0000 Labs', email: 'ap@nul.example.com', currency: 'EUR' }, { 'idempotency-key': 'cus-nul' });
    expect(customer.statusCode).toBe(400);
    expect((await get('/v1/customers')).json<{ data: unknown[] }>().data).toEqual([]);
  });

  it('moves the test clock at most 400 days in one request, however the target is given', async () => {
    const far = await post('/v1/test-clock/advance', { to: '2027-03-09T00:00:00Z' });
    expect(far.statusCode).toBe(422);
    expect(far.json()).toMatchObject({ error: { code: 'invalid_argument' } });
    expect((await post('/v1/test-clock/advance', { days: 300, hours: 24 * 101 })).statusCode).toBe(422);
    expect((await get('/v1/test-clock')).json()).toEqual({ enabled: true, now: '2026-02-01T00:00:00.000Z' });
    expect((await post('/v1/test-clock/advance', { to: '2027-03-08T00:00:00Z' })).statusCode).toBe(200);
  });
});
