import type { BillingEngine } from '@ledgerline/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Clock } from '../clock.js';
import { bearerAuth } from './auth.js';
import type { ApiContext } from './context.js';
import { registerErrorHandling } from './errors.js';
import { customerRoutes } from './routes/customers.js';
import { invoiceRoutes } from './routes/invoices.js';
import { ledgerRoutes } from './routes/ledger.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { testClockRoutes } from './routes/test-clock.js';
import { webhookRoutes } from './routes/webhooks.js';

export interface AppOptions {
  engine: BillingEngine;
  apiKey: string;
  webhookSecrets: readonly string[];
  clock: Clock;
  testClockEnabled: boolean;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 64 * 1024 });
  const context: ApiContext = { engine: options.engine, clock: options.clock, testClockEnabled: options.testClockEnabled };
  registerErrorHandling(app);

  app.get('/health', () => ({ status: 'ok' }));

  await app.register((scope) => webhookRoutes(scope, context, { secrets: options.webhookSecrets }));

  await app.register(
    async (v1) => {
      v1.addHook('onRequest', bearerAuth(options.apiKey));
      v1.get('/plans', async () => ({ data: await options.engine.listPlans() }));
      customerRoutes(v1, context);
      subscriptionRoutes(v1, context);
      invoiceRoutes(v1, context);
      ledgerRoutes(v1, context);
      testClockRoutes(v1, context);
      return Promise.resolve();
    },
    { prefix: '/v1' },
  );

  await app.ready();
  return app;
}
