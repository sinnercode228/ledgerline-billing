import { CURRENCIES } from '@ledgerline/core';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from './errors.js';

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    throw new HttpError(400, 'validation_failed', 'The request is not valid', { issues });
  }
  return result.data;
}

export function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(key)) {
    throw new HttpError(400, 'idempotency_key_required', 'Send a unique Idempotency-Key header (1-255 visible characters)');
  }
  return key;
}

// Ids reach PostgreSQL as text, which cannot hold a NUL byte; refusing odd
// characters here answers 400 instead of failing inside the query.
export const id = z.string().regex(/^[\w-]{1,64}$/, 'an id is 1-64 letters, digits, "_" or "-"');
export const accountId = z.string().regex(/^[\w:-]{1,100}$/, 'an account id is 1-100 letters, digits, "_", ":" or "-"');
export const idParams = z.object({ id });

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const currency = z.enum(CURRENCIES);
