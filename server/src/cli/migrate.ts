import { BillingEngine, FakePayrail, PLAN_CATALOG } from '@ledgerline/core';
import { requireDatabaseUrl } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { PgStore } from '../store/pg-store.js';
import { runCommand } from './shared.js';

runCommand('migrate', async () => {
  const pool = createPool(requireDatabaseUrl(process.env), { max: 2 });
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length > 0 ? `applied ${applied.join(', ')}` : 'schema is up to date');
    await new BillingEngine({ store: new PgStore(pool), provider: new FakePayrail() }).syncPlans(PLAN_CATALOG);
    console.log(`plan catalog synced (${PLAN_CATALOG.length} plans)`);
  } finally {
    await pool.end();
  }
});
