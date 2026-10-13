import { clockAdvanceDto, DAY_MS } from '@ledgerline/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { HttpError } from '../errors.js';
import { parse } from '../validation.js';

const HOUR_MS = DAY_MS / 24;

const advanceBody = z
  .object({
    days: z.number().int().min(0).max(400).optional(),
    hours: z.number().int().min(0).max(24 * 400).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((body) => (body.to === undefined) !== (body.days === undefined && body.hours === undefined), {
    message: 'send either "to" or "days"/"hours"',
  })
  .refine((body) => body.to !== undefined || (body.days ?? 0) + (body.hours ?? 0) > 0, { message: 'advance by at least one hour' });

export function testClockRoutes(app: FastifyInstance, { engine, clock, testClockEnabled }: ApiContext): void {
  // One advance at a time: two overlapping walks would interleave their days.
  let running: Promise<unknown> = Promise.resolve();

  app.get('/test-clock', async () => ({ enabled: testClockEnabled, now: testClockEnabled ? await clock.now() : null }));

  app.post('/test-clock/advance', async (request) => {
    if (!testClockEnabled) {
      throw new HttpError(404, 'test_clock_disabled', 'Start the server with LEDGERLINE_TEST_CLOCK=1 to use the test clock');
    }
    const body = parse(advanceBody, request.body);
    const advance = running.then(async () => {
      const from = await clock.now();
      const to = body.to ? new Date(body.to) : new Date(from.getTime() + (body.days ?? 0) * DAY_MS + (body.hours ?? 0) * HOUR_MS);
      return engine.advanceClock(to);
    });
    running = advance.catch(() => undefined);
    return clockAdvanceDto(await advance);
  });
}
