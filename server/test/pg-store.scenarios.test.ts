import { defineStoreScenarios } from '@ledgerline/core/testing';
import { createTestDatabase, describeWithDatabase } from './helpers/database.js';

describeWithDatabase('PostgreSQL', () => {
  defineStoreScenarios('PgStore', async () => {
    const db = await createTestDatabase();
    return { store: db.store, close: db.close };
  });
});
