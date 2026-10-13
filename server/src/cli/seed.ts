import { parseArgs } from 'node:util';
import { BillingEngine, countByStatus, FakePayrail, seedDemo } from '@ledgerline/core';
import { requireDatabaseUrl } from '../config.js';
import { createPool } from '../db/pool.js';
import { PgStore } from '../store/pg-store.js';
import { runCommand } from './shared.js';

runCommand('seed', async () => {
  const { values } = parseArgs({ options: { days: { type: 'string', default: '120' } } });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 730) throw new Error('--days must be a whole number between 1 and 730');

  const pool = createPool(requireDatabaseUrl(process.env), { max: 4 });
  try {
    const provider = new FakePayrail();
    const engine = new BillingEngine({ store: new PgStore(pool), provider });
    if ((await engine.listCustomers({ limit: 1 })).length > 0) {
      console.log('database already has customers, nothing to seed');
      return;
    }
    const end = new Date();
    console.log(`running the engine on the test clock for ${days} days up to ${end.toISOString()}`);
    const summary = await seedDemo({
      engine,
      provider,
      end,
      days,
      onDay: (at) => {
        if (at.getUTCDate() === 1) console.log(`  ${at.toISOString().slice(0, 10)}`);
      },
    });
    const byStatus = countByStatus(await engine.listSubscriptions());
    const trial = await engine.trialBalance();
    console.log(`seeded ${summary.customers} customers from ${summary.from.toISOString().slice(0, 10)}`);
    console.log(`subscriptions: ${Object.entries(byStatus).map(([status, count]) => `${status} ${count}`).join(', ')}`);
    console.log(`invoices: ${(await engine.listInvoices()).length}, trial balance ${trial.balanced ? 'balanced' : 'NOT balanced'}`);
  } finally {
    await pool.end();
  }
});
