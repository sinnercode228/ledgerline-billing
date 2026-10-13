import { SIGNATURE_HEADER, verifySignature, type SignatureFailure } from '@ledgerline/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { HttpError } from '../errors.js';
import { parse } from '../validation.js';

const event = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  created: z.number().int(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const FAILURES: Record<SignatureFailure, [string, string]> = {
  missing_header: ['signature_missing', 'Payrail-Signature header is missing'],
  malformed_header: ['signature_malformed', 'Payrail-Signature header is malformed'],
  timestamp_out_of_tolerance: ['signature_expired', 'Payrail-Signature timestamp is outside the allowed window'],
  no_matching_signature: ['signature_invalid', 'Payrail-Signature does not match the payload'],
};

export interface WebhookOptions {
  secrets: readonly string[];
  /** Signatures are checked against real time, even when billing runs on the test clock. */
  wallClock?: () => Date;
}

/**
 * Registered in its own plugin so the raw body parser applies here only: the
 * signature covers the exact bytes Payrail sent, not a re-serialized object.
 */
export async function webhookRoutes(app: FastifyInstance, { engine, clock }: ApiContext, options: WebhookOptions): Promise<void> {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (_request, body, done) => done(null, body));

  app.post('/webhooks/payrail', async (request) => {
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const header = request.headers[SIGNATURE_HEADER];
    const verification = await verifySignature({
      header: typeof header === 'string' ? header : undefined,
      payload: new Uint8Array(raw),
      secrets: options.secrets,
      now: options.wallClock?.() ?? new Date(),
    });
    if (!verification.ok) {
      const [code, message] = FAILURES[verification.reason];
      request.log.warn({ reason: verification.reason }, 'rejected Payrail webhook');
      throw new HttpError(400, code, message);
    }

    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid_json', 'webhook body is not JSON');
    }
    const result = await engine.receiveProviderEvent(parse(event, json), await clock.now());
    return { received: true, duplicate: result.duplicate, outcome: result.outcome };
  });
  return Promise.resolve();
}
