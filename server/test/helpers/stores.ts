import { MemoryStore, type Store } from '@ledgerline/core';
import { createTestDatabase } from './database.js';

export type StoreCase = [name: string, open: () => Promise<{ store: Store; close: () => Promise<void> }>];

/** MemoryStore always; PgStore on a fresh schema when a test database is configured. */
export function testStores(): StoreCase[] {
  const cases: StoreCase[] = [['MemoryStore', () => Promise.resolve({ store: new MemoryStore(), close: () => Promise.resolve() })]];
  if (process.env.LEDGERLINE_TEST_DATABASE_URL) {
    cases.push([
      'PgStore',
      async () => {
        const db = await createTestDatabase();
        return { store: db.store, close: db.close };
      },
    ]);
  }
  return cases;
}
