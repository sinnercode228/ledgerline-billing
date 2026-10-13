import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

/** Arbitrary but fixed key so concurrent migrators (several containers starting at once) take turns. */
const MIGRATION_LOCK = 72_418_506;

/**
 * Applies every migrations/NNN_name.sql that has not run yet, each in its own
 * transaction, in file name order. Returns the names it applied.
 */
export async function runMigrations(pool: pg.Pool, directory: URL = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((row) => row.name));
    const applied: string[] = [];
    for (const name of files) {
      if (done.has(name)) continue;
      const sql = await readFile(new URL(name, directory), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      applied.push(name);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
