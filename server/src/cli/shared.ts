import { pino, type Logger } from 'pino';
import { ConfigError } from '../config.js';

export function createLogger(level = process.env.LEDGERLINE_LOG_LEVEL ?? 'info'): Logger {
  return pino({ level });
}

/** Runs a command, printing configuration problems plainly and exiting non-zero on failure. */
export function runCommand(name: string, command: () => Promise<void>): void {
  command().catch((error: unknown) => {
    if (error instanceof ConfigError) {
      console.error(`${name}: ${error.message}`);
    } else {
      console.error(`${name} failed:`, error);
    }
    process.exit(1);
  });
}

export function onShutdown(handler: () => Promise<void>): void {
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      handler().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error('shutdown failed:', error);
          process.exit(1);
        },
      );
    });
  }
}
