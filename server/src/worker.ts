import type { BillingEngine, Logger } from '@ledgerline/core';
import type { Clock } from './clock.js';

export interface Worker {
  /** Completed runs so far. */
  readonly runs: number;
  /** Stops scheduling and resolves once the run in progress has finished. */
  stop(): Promise<void>;
}

/**
 * Runs due work on a fixed interval. Runs never overlap within a process;
 * several processes may run side by side because claims skip locked rows.
 */
export function startWorker(options: { engine: BillingEngine; clock: Clock; intervalMs: number; logger: Logger }): Worker {
  const { engine, clock, logger } = options;
  let runs = 0;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    try {
      const now = await clock.now();
      const report = await engine.runDueWork(now);
      const busy = report.trialsEnded + report.renewals + report.retries + report.canceled + report.recoveredPayments;
      if (busy > 0 || report.errors.length > 0) logger.info({ at: now.toISOString(), ...report }, 'due work done');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'due work run failed');
    } finally {
      runs += 1;
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      current = tick().then(schedule);
    }, options.intervalMs);
  };

  current = tick().then(schedule);

  return {
    get runs() {
      return runs;
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}
