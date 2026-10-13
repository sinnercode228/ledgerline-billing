import { loadConfig } from '../config.js';
import { buildApp } from '../http/app.js';
import { createRuntime } from '../runtime.js';
import { createLogger, onShutdown, runCommand } from './shared.js';

runCommand('serve', async () => {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  if (config.devMode) logger.warn('LEDGERLINE_DEV=1: development keys are allowed, do not expose this server');
  const runtime = createRuntime(config, logger);
  const app = await buildApp({
    engine: runtime.engine,
    apiKey: config.apiKey,
    webhookSecrets: config.webhookSecrets,
    clock: runtime.clock,
    testClockEnabled: config.testClock,
    corsOrigins: config.corsOrigins,
    logger: { level: config.logLevel },
  });
  onShutdown(async () => {
    await app.close();
    await runtime.close();
  });
  await app.listen({ host: config.host, port: config.port });
});
