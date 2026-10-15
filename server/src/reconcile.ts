import { reconcile } from '@ledgerline/core';
import { createPool } from './db/pool.js';
import { PgStore } from './store/pg-store.js';

/**
 * Compares the books with the documents in the database at `databaseUrl`,
 * prints each violation and a summary line, and returns the exit code:
 * 1 when anything disagrees, 0 otherwise.
 */
export async function reconcileDatabase(databaseUrl: string, print: (line: string) => void): Promise<number> {
  const pool = createPool(databaseUrl, { max: 1 });
  try {
    const { checked, violations } = await reconcile(new PgStore(pool));
    for (const violation of violations) print(`${violation.rule}: ${violation.message}`);
    const found = violations.length === 0 ? 'no violations' : `${violations.length} violation${violations.length === 1 ? '' : 's'}`;
    print(
      `${found} in ${checked.customers} customers, ${checked.subscriptions} subscriptions, ${checked.invoices} invoices, ` +
        `${checked.payments} payments and ${checked.accounts} accounts`,
    );
    return violations.length === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}
