import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { accountDto } from '../serialize.js';
import { id, pageQuery, parse } from '../validation.js';

const POSTING_KINDS = [
  'invoice_finalized',
  'payment_succeeded',
  'downgrade_credit',
  'credit_applied',
  'write_off',
  'refund',
  'overpayment_credit',
  'reversal',
] as const;

const journalQuery = pageQuery.extend({
  accountId: z.string().min(1).max(100).optional(),
  invoiceId: id.optional(),
  kind: z.enum(POSTING_KINDS).optional(),
});

export function ledgerRoutes(app: FastifyInstance, { engine, clock }: ApiContext): void {
  app.get('/ledger/accounts', async (request) => {
    const { customerId } = parse(z.object({ customerId: id.optional() }), request.query);
    const rows = await engine.ledgerAccounts({ customerId });
    return { data: rows.map(accountDto) };
  });

  app.get('/ledger/journal', async (request) => {
    const query = parse(journalQuery, request.query);
    return { data: await engine.journal(query), limit: query.limit, offset: query.offset };
  });

  app.get('/ledger/trial-balance', () => engine.trialBalance());

  app.get('/metrics', async (request) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }), request.query);
    return engine.metrics(await clock.now(), { revenueDays: days });
  });

  app.get('/webhook-events', async (request) => {
    const page = parse(pageQuery, request.query);
    return { data: await engine.listWebhookEvents(page), ...page };
  });
}
