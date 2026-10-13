import { isBillingError, type BillingErrorCode } from '@ledgerline/core';
import type { FastifyError, FastifyInstance } from 'fastify';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export function errorBody(code: string, message: string, details?: Record<string, unknown>): ErrorBody {
  return { error: details ? { code, message, details } : { code, message } };
}

const STATUS_BY_CODE: Partial<Record<BillingErrorCode, number>> = {
  not_found: 404,
  idempotency_conflict: 409,
  duplicate_invoice: 409,
  duplicate_key: 409,
  invalid_transition: 409,
  // The engine balances every posting itself; reaching the database check is a bug.
  unbalanced_transaction: 500,
};

const FASTIFY_ERRORS: Record<string, [number, string]> = {
  FST_ERR_CTP_INVALID_JSON_BODY: [400, 'invalid_json'],
  FST_ERR_CTP_EMPTY_JSON_BODY: [400, 'invalid_json'],
  FST_ERR_CTP_INVALID_MEDIA_TYPE: [415, 'unsupported_media_type'],
  FST_ERR_CTP_BODY_TOO_LARGE: [413, 'payload_too_large'],
};

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }
    if (isBillingError(error)) {
      const status = STATUS_BY_CODE[error.code] ?? 422;
      if (status >= 500) {
        request.log.error({ err: error }, 'billing invariant violated');
        return reply.status(status).send(errorBody('internal_error', 'Something went wrong on our side'));
      }
      return reply.status(status).send(errorBody(error.code, error.message));
    }
    const known = FASTIFY_ERRORS[error.code];
    if (known) {
      return reply.status(known[0]).send(errorBody(known[1], error.message));
    }
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.status(error.statusCode).send(errorBody('bad_request', error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(errorBody('internal_error', 'Something went wrong on our side'));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorBody('route_not_found', `${request.method} ${request.url.split('?')[0]} does not exist`)),
  );
}
