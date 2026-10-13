import { describe, expect, it } from 'vitest';
import { customerDetailDto, invoiceDetailDto } from '../src/api/representations.js';
import { BillingWorld } from '../src/testing/world.js';
import { MemoryStore } from '../src/memory/memory-store.js';

describe('API representations', () => {
  it('shows customer credit as a positive amount and never the provider token', async () => {
    const world = await BillingWorld.create(new MemoryStore(), new Date('2026-04-01T10:00:00Z'));
    const { customer } = await world.customer('Saltmarsh Media', 'EUR', 'succeeds');
    const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
    await world.advanceDays(10);
    await world.engine.changePlan(subscription.id, 'plan_team_monthly', world.now);

    const detail = customerDetailDto(
      await world.engine.getCustomer(customer.id),
      await world.engine.listPaymentMethods(customer.id),
      await world.engine.ledgerAccounts({ customerId: customer.id }),
    );
    expect(detail.creditBalance).toBeGreaterThan(0);
    expect(detail.creditBalance).toBe(-(await world.balance(`customer_credit:${customer.id}`)));
    expect(detail.paymentMethods).toMatchObject([{ last4: '4242', isDefault: true }]);
    expect(JSON.stringify(detail)).not.toContain('tok_');
  });

  it('lists an invoice with its payment attempts, without idempotency keys', async () => {
    const world = await BillingWorld.create(new MemoryStore(), new Date('2026-04-01T10:00:00Z'));
    const { customer } = await world.customer('Tundra Freight Ops', 'RUB', 'declined');
    const subscription = await world.engine.createSubscription({ customerId: customer.id, planId: 'plan_business_monthly' }, world.now);
    await world.advanceDays(1);
    const [invoice] = await world.engine.listInvoices({ subscriptionId: subscription.id });
    const { invoice: stored, payments } = await world.engine.getInvoice(invoice!.id);

    const detail = invoiceDetailDto(stored, payments);
    expect(detail.payments.map((p) => [p.attempt, p.trigger, p.status, p.failureCode])).toEqual([
      [1, 'initial', 'failed', 'card_declined'],
      [2, 'scheduled_retry', 'failed', 'card_declined'],
    ]);
    expect(JSON.stringify(detail)).not.toContain('idempotency');
  });
});
