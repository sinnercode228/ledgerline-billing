import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe } from 'vitest';
import { createPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { PgStore } from '../../src/store/pg-store.js';

const url = process.env.LEDGERLINE_TEST_DATABASE_URL;

/** Integration tests need a real PostgreSQL; they are skipped when LEDGERLINE_TEST_DATABASE_URL is unset. */
export function describeWithDatabase(name: string, body: () => void): void {
  if (url) describe(name, body);
  else describe.skip(name, body);
}

export interface TestDatabase {
  pool: pg.Pool;
  store: PgStore;
  schema: string;
  close(): Promise<void>;
}

/** Every test gets its own freshly migrated schema, dropped afterwards. */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!url) throw new Error('LEDGERLINE_TEST_DATABASE_URL is not set');
  const schema = `ledgerline_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(url, { schema, max: 12 });
  await runMigrations(pool);
  return {
    pool,
    store: new PgStore(pool),
    schema,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
