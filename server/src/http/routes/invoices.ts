import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { paymentDto } from '../serialize.js';
import { id, idParams, pageQuery, parse } from '../validation.js';

const listQuery = pageQuery.extend({
  customerId: id.optional(),
  subscriptionId: id.optional(),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']).optional(),
});

export function invoiceRoutes(app: FastifyInstance, { engine, clock }: ApiContext): void {
  app.get('/invoices', async (request) => {
    const query = parse(listQuery, request.query);
    return { data: await engine.listInvoices(query), limit: query.limit, offset: query.offset };
  });

  app.get('/invoices/:id', async (request) => {
    const { invoice, payments } = await engine.getInvoice(parse(idParams, request.params).id);
    return { ...invoice, payments: payments.map(paymentDto) };
  });

  app.post('/invoices/:id/refund', async (request) => engine.refundInvoice(parse(idParams, request.params).id, await clock.now()));
}
