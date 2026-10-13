import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Compares digests so the comparison is constant-time and independent of the key length. */
export function bearerAuth(apiKey: string): (request: FastifyRequest) => Promise<void> {
  const expected = digest(apiKey);
  return async (request) => {
    const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '');
    if (!match?.[1] || !timingSafeEqual(digest(match[1]), expected)) {
      throw new HttpError(401, 'unauthorized', 'Send the API key as "Authorization: Bearer <key>"');
    }
  };
}
