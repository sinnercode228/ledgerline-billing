import { customerDetailDto, paymentMethodDto } from '@ledgerline/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { currency, id, idempotencyKey, idParams, pageQuery, parse } from '../validation.js';

const newCustomer = z.object({
  // PostgreSQL text cannot hold NUL, and no other control character belongs in a name.
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\p{Cc}]*$/u, 'control characters are not allowed'),
  email: z.email().max(320),
  currency,
});

const newPaymentMethod = z.object({
  card: z.object({
    number: z.string().regex(/^[\d -]{12,23}$/, 'card number must be digits'),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2000).max(2100),
  }),
  makeDefault: z.boolean().optional(),
});

export function customerRoutes(app: FastifyInstance, { engine, clock }: ApiContext): void {
  app.post('/customers', async (request, reply) => {
    const key = idempotencyKey(request);
    const input = parse(newCustomer, request.body);
    const customer = await engine.createCustomer(input, await clock.now(), { idempotencyKey: key });
    return reply.status(201).send(customer);
  });

  app.get('/customers', async (request) => {
    const page = parse(pageQuery, request.query);
    return { data: await engine.listCustomers(page), ...page };
  });

  app.get('/customers/:id', async (request) => {
    const { id: customerId } = parse(idParams, request.params);
    const customer = await engine.getCustomer(customerId);
    return customerDetailDto(customer, await engine.listPaymentMethods(customerId), await engine.ledgerAccounts({ customerId }));
  });

  app.post('/customers/:id/payment-methods', async (request, reply) => {
    const { id: customerId } = parse(idParams, request.params);
    const input = parse(newPaymentMethod, request.body);
    const method = await engine.attachPaymentMethod(customerId, input.card, await clock.now(), { makeDefault: input.makeDefault });
    const customer = await engine.getCustomer(customerId);
    return reply.status(201).send(paymentMethodDto(method, customer.defaultPaymentMethodId));
  });

  app.post('/customers/:id/payment-methods/:paymentMethodId/default', async (request) => {
    const params = parse(z.object({ id, paymentMethodId: id }), request.params);
    return engine.setDefaultPaymentMethod(params.id, params.paymentMethodId, await clock.now());
  });
}
