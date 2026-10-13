import { DAY_MS } from '../calendar.js';
import { BillingError } from '../errors.js';
import type { EngineContext } from './context.js';
import { runDueWork, type DueWorkReport } from './due-work.js';

export interface ClockAdvance {
  from: Date;
  to: Date;
  days: Array<{ at: Date; report: DueWorkReport }>;
}

/**
 * Moves the stored clock forward one day at a time, running due work at each
 * step, so a renewal that fails on day 3 is retried on day 4 before anything
 * that happens on day 5. The clock is saved after every step.
 */
export async function advanceClock(
  ctx: EngineContext,
  to: Date,
  onDay?: (at: Date, report: DueWorkReport) => Promise<void> | void,
): Promise<ClockAdvance> {
  const from = await ctx.store.run((tx) => tx.getClock());
  if (!from) throw new BillingError('clock_not_set', 'set the test clock before advancing it');
  if (to < from) throw new BillingError('invalid_argument', 'the test clock only moves forward');
  const days: ClockAdvance['days'] = [];
  let current = from;
  while (current < to) {
    const at = new Date(Math.min(current.getTime() + DAY_MS, to.getTime()));
    const report = await runDueWork(ctx, at);
    await ctx.store.run((tx) => tx.setClock(at));
    days.push({ at, report });
    await onDay?.(at, report);
    current = at;
  }
  return { from, to, days };
}
