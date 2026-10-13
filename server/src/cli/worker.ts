import { loadConfig } from '../config.js';
import { createRuntime } from '../runtime.js';
import { startWorker } from '../worker.js';
import { createLogger, onShutdown, runCommand } from './shared.js';

const INTERVAL_MS = 60_000;

runCommand('worker', async () => {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  const runtime = createRuntime(config, logger);
  const worker = startWorker({ engine: runtime.engine, clock: runtime.clock, intervalMs: INTERVAL_MS, logger });
  logger.info({ intervalMs: INTERVAL_MS, testClock: config.testClock }, 'worker started');
  onShutdown(async () => {
    await worker.stop();
    await runtime.close();
  });
  return Promise.resolve();
});
