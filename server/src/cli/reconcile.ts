import { requireDatabaseUrl } from '../config.js';
import { reconcileDatabase } from '../reconcile.js';
import { runCommand } from './shared.js';

runCommand('reconcile', async () => {
  process.exitCode = await reconcileDatabase(requireDatabaseUrl(process.env), (line) => console.log(line));
});
