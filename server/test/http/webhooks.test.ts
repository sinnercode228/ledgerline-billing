import type { PayrailEvent } from '@ledgerline/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, OLD_WEBHOOK_SECRET, signedWebhook, type TestApp } from '../helpers/app.js';
import { testStores } from '../helpers/stores.js';

describe.each(testStores())('HTTP: Payrail webhooks on %s', (_name, makeStore) => {
  let t: TestApp;
  let close: () => Promise<void>;
  let event: PayrailEvent;
  let invoiceId: string;

  beforeEach(async () => {
    const { store, close: closeStore } = await makeStore();
    close = closeStore;
    t = await createTestApp({ store });
    t.provider.setMode('async');
    const now = await t.clock.now();
    const customer = await t.engine.createCustomer({ name: 'Halcyon Docs', email: 'ap@halcyon.example.com', currency: 'EUR' }, now);
    await t.engine.attachPaymentMethod(customer.id, { number: '4242424242424242', expMonth: 1, expYear: 2031 }, now);
    const subscription = await t.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, now);
    [event] = t.provider.drainEvents() as [PayrailEvent];
    invoiceId = (await t.engine.listInvoices({ subscriptionId: subscription.id }))[0]!.id;
  });
  afterEach(async () => {
    await t.app.close();
    await close();
  });

  const deliver = async (body: string, headers: Record<string, string>) =>
    t.app.inject({ method: 'POST', url: '/webhooks/payrail', payload: body, headers });

  const invoiceStatus = async () => (await t.engine.getInvoice(invoiceId)).invoice.status;

  it('applies a correctly signed event', async () => {
    const body = JSON.stringify(event);
    const response = await deliver(body, await signedWebhook(body));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, duplicate: false, outcome: 'applied' });
    expect(await invoiceStatus()).toBe('paid');
  });

  it('rejects a bad signature and a tampered body without touching state', async () => {
    const body = JSON.stringify(event);
    const wrongSecret = await deliver(body, await signedWebhook(body, { secret: 'whsec_attacker_guess' }));
    expect(wrongSecret.statusCode).toBe(400);
    expect(wrongSecret.json()).toMatchObject({ error: { code: 'signature_invalid' } });

    const tampered = body.replace('"amount":9900', '"amount":1');
    expect(tampered).not.toBe(body);
    expect((await deliver(tampered, await signedWebhook(body))).statusCode).toBe(400);

    const malformed = await deliver(body, { 'content-type': 'application/json', 'payrail-signature': 'v1=deadbeef' });
    expect(malformed.json()).toMatchObject({ error: { code: 'signature_malformed' } });
    expect(await invoiceStatus()).toBe('open');
    expect(await t.engine.listWebhookEvents()).toHaveLength(0);
  });

  it('rejects an expired signature', async () => {
    const body = JSON.stringify(event);
    const response = await deliver(body, await signedWebhook(body, { timestamp: Math.floor(Date.now() / 1000) - 301 }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'signature_expired' } });
    expect(await invoiceStatus()).toBe('open');
  });

  it('accepts the previous secret during rotation', async () => {
    const body = JSON.stringify(event);
    const response = await deliver(body, await signedWebhook(body, { secret: OLD_WEBHOOK_SECRET }));
    expect(response.statusCode).toBe(200);
    expect(await invoiceStatus()).toBe('paid');
  });

  it('verifies the raw bytes, whitespace included', async () => {
    const pretty = `${JSON.stringify(event, null, 2)}\n`;
    const signedPretty = await signedWebhook(pretty);
    const compact = await deliver(JSON.stringify(event), signedPretty);
    expect(compact.statusCode).toBe(400);
    expect(compact.json()).toMatchObject({ error: { code: 'signature_invalid' } });

    const asSigned = await deliver(pretty, signedPretty);
    expect(asSigned.statusCode).toBe(200);
    expect(await invoiceStatus()).toBe('paid');
  });

  it('acknowledges a duplicate delivery without processing it again', async () => {
    const body = JSON.stringify(event);
    const headers = await signedWebhook(body);
    const [first, second] = await Promise.all([deliver(body, headers), deliver(body, headers)]);
    expect([first.json<{ duplicate: boolean }>().duplicate, second.json<{ duplicate: boolean }>().duplicate].sort()).toEqual([false, true]);
    const third = await deliver(body, headers);
    expect(third.statusCode).toBe(200);
    expect(third.json()).toMatchObject({ duplicate: true });

    const events = await t.app.inject({ method: 'GET', url: '/v1/webhook-events', headers: auth });
    expect(events.json<{ data: unknown[] }>().data).toEqual([expect.objectContaining({ providerEventId: event.id, outcome: 'applied' })]);
    const clearing = (await t.engine.ledgerAccounts()).find((a) => a.account.id === 'provider_clearing:EUR');
    expect(clearing?.balance).toBe(9_900);
  });

  it('stores and acknowledges unknown event types, rejects envelopes it cannot read', async () => {
    const unknown = JSON.stringify({ id: 'evt_dispute_1', type: 'dispute.created', created: 1_780_000_000, data: { object: { id: 'dp_1' } } });
    const response = await deliver(unknown, await signedWebhook(unknown));
    expect(response.json()).toEqual({ received: true, duplicate: false, outcome: 'ignored_type' });

    const notJson = 'not json at all';
    expect((await deliver(notJson, await signedWebhook(notJson))).json()).toMatchObject({ error: { code: 'invalid_json' } });
    const noId = JSON.stringify({ type: 'payment.succeeded' });
    expect((await deliver(noId, await signedWebhook(noId))).json()).toMatchObject({ error: { code: 'validation_failed' } });
  });
});
