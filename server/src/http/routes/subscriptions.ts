import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiContext } from '../context.js';
import { id, idempotencyKey, idParams, pageQuery, parse } from '../validation.js';

const newSubscription = z.object({ customerId: id, planId: id });
const planChange = z.object({ planId: id });
const listQuery = pageQuery.extend({
  customerId: id.optional(),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled']).optional(),
});

export function subscriptionRoutes(app: FastifyInstance, { engine, clock }: ApiContext): void {
  app.post('/subscriptions', async (request, reply) => {
    const key = idempotencyKey(request);
    const input = parse(newSubscription, request.body);
    return reply.status(201).send(await engine.createSubscription(input, await clock.now(), { idempotencyKey: key }));
  });

  app.get('/subscriptions', async (request) => {
    const query = parse(listQuery, request.query);
    return { data: await engine.listSubscriptions(query), limit: query.limit, offset: query.offset };
  });

  app.get('/subscriptions/:id', async (request) => engine.getSubscription(parse(idParams, request.params).id));

  app.post('/subscriptions/:id/plan-change/preview', async (request) => {
    const { id: subscriptionId } = parse(idParams, request.params);
    const { planId } = parse(planChange, request.body);
    return engine.previewPlanChange(subscriptionId, planId, await clock.now());
  });

  app.post('/subscriptions/:id/plan-change', async (request) => {
    const { id: subscriptionId } = parse(idParams, request.params);
    const { planId } = parse(planChange, request.body);
    return engine.changePlan(subscriptionId, planId, await clock.now());
  });

  app.post('/subscriptions/:id/cancel', async (request) => {
    return engine.cancelAtPeriodEnd(parse(idParams, request.params).id, await clock.now());
  });

  app.post('/subscriptions/:id/resume', async (request) => {
    return engine.resume(parse(idParams, request.params).id, await clock.now());
  });
}
