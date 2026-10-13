import { BillingEngine, FakePayrail, type Logger } from '@ledgerline/core';
import type pg from 'pg';
import { storedClock, systemClock, type Clock } from './clock.js';
import type { Config } from './config.js';
import { createPool } from './db/pool.js';
import { relayWebhooks } from './payrail/relay.js';
import { PgStore } from './store/pg-store.js';

export interface Runtime {
  pool: pg.Pool;
  engine: BillingEngine;
  provider: FakePayrail;
  clock: Clock;
  close(): Promise<void>;
}

/** Wires the engine to PostgreSQL and the bundled Payrail stand-in. */
export function createRuntime(config: Config, logger: Logger): Runtime {
  const pool = createPool(config.databaseUrl);
  const provider = new FakePayrail();
  const engine = new BillingEngine({ store: new PgStore(pool), provider, dunning: config.dunning, logger });
  const stopRelay = config.payrailWebhookUrl
    ? relayWebhooks(provider, { url: config.payrailWebhookUrl, secret: config.webhookSecrets[0]!, logger })
    : () => Promise.resolve();
  return {
    pool,
    engine,
    provider,
    clock: config.testClock ? storedClock(engine) : systemClock,
    async close() {
      await stopRelay();
      await pool.end();
    },
  };
}
