import { BillingEngine, FakePayrail, MemoryStore, PLAN_CATALOG, signPayload, type Store } from '@ledgerline/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/http/app.js';
import { fixedClock, storedClock, type Clock } from '../../src/clock.js';

export const API_KEY = 'lk_test_6b2f9d14c0a8e7351f2d4c6b8a9e0f13';
export const WEBHOOK_SECRET = 'whsec_test_current_5e1c';
export const OLD_WEBHOOK_SECRET = 'whsec_test_previous_9a7b';
export const auth = { authorization: `Bearer ${API_KEY}` };

export interface TestApp {
  app: FastifyInstance;
  engine: BillingEngine;
  provider: FakePayrail;
  clock: Clock & { set?: (now: Date) => void };
}

export async function createTestApp(
  options: { store?: Store; testClock?: boolean; now?: Date; corsOrigins?: string[] } = {},
): Promise<TestApp> {
  const now = options.now ?? new Date('2026-04-01T09:00:00Z');
  const provider = new FakePayrail({ now: () => now });
  const engine = new BillingEngine({ store: options.store ?? new MemoryStore(), provider });
  await engine.syncPlans(PLAN_CATALOG);
  let clock: TestApp['clock'];
  if (options.testClock) {
    await engine.setClock(now);
    clock = storedClock(engine);
  } else {
    clock = fixedClock(now);
  }
  const app = await buildApp({
    engine,
    apiKey: API_KEY,
    webhookSecrets: [WEBHOOK_SECRET, OLD_WEBHOOK_SECRET],
    clock,
    testClockEnabled: options.testClock ?? false,
    corsOrigins: options.corsOrigins ?? [],
    logger: false,
  });
  return { app, engine, provider, clock };
}

export async function signedWebhook(body: string, options: { secret?: string; timestamp?: number } = {}) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    'content-type': 'application/json',
    'payrail-signature': await signPayload(body, options.secret ?? WEBHOOK_SECRET, timestamp),
  };
}
