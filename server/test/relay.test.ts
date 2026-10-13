import { BillingEngine, FakePayrail, MemoryStore, PLAN_CATALOG, silentLogger } from '@ledgerline/core';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../src/clock.js';
import { buildApp } from '../src/http/app.js';
import { relayWebhooks } from '../src/payrail/relay.js';
import { API_KEY, WEBHOOK_SECRET } from './helpers/app.js';

describe('Payrail webhook relay', () => {
  it('signs every event and posts it to the webhook endpoint in order', async () => {
    const now = new Date('2026-04-01T09:00:00Z');
    const provider = new FakePayrail({ mode: 'async', now: () => now });
    const engine = new BillingEngine({ store: new MemoryStore(), provider });
    await engine.syncPlans(PLAN_CATALOG);
    const app = await buildApp({ engine, apiKey: API_KEY, webhookSecrets: [WEBHOOK_SECRET], clock: fixedClock(now), testClockEnabled: false, logger: false });

    const statuses: number[] = [];
    const stop = relayWebhooks(provider, {
      url: 'http://ledgerline.internal/webhooks/payrail',
      secret: WEBHOOK_SECRET,
      logger: silentLogger,
      fetch: async (url, init) => {
        expect(url).toBe('http://ledgerline.internal/webhooks/payrail');
        const response = await app.inject({
          method: 'POST',
          url: '/webhooks/payrail',
          headers: init?.headers as Record<string, string>,
          payload: init?.body as string,
        });
        statuses.push(response.statusCode);
        return new Response(response.body, { status: response.statusCode });
      },
    });

    const customer = await engine.createCustomer({ name: 'Lumen Forms', email: 'ap@lumen.example.com', currency: 'EUR' }, now);
    await engine.attachPaymentMethod(customer.id, { number: '4242424242424242', expMonth: 6, expYear: 2030 }, now);
    const subscription = await engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, now);
    await stop();

    expect(statuses).toEqual([200]);
    const [invoice] = await engine.listInvoices({ subscriptionId: subscription.id });
    expect(invoice!.status).toBe('paid');
    await app.close();
  });
});
