import { describe, expect, it } from 'vitest';
import { FakePayrail, PAYRAIL_TEST_CARDS } from '../src/payrail/fake-payrail.js';
import { ProviderUnavailableError } from '../src/ports/provider.js';

const now = new Date('2026-05-01T00:00:00Z');
const card = (number: string) => ({ number, expMonth: 12, expYear: 2030 });

describe('fake Payrail', () => {
  it('accepts only the documented test cards', async () => {
    const payrail = new FakePayrail();
    await expect(payrail.tokenizeCard(card(PAYRAIL_TEST_CARDS.succeeds), now)).resolves.toMatchObject({ last4: '4242', brand: 'visa' });
    await expect(payrail.tokenizeCard(card('4111111111111111'), now)).rejects.toMatchObject({ code: 'card_not_supported' });
    await expect(payrail.tokenizeCard(card('4242424242424241'), now)).rejects.toMatchObject({ code: 'card_not_supported' });
    await expect(payrail.tokenizeCard({ ...card(PAYRAIL_TEST_CARDS.succeeds), expYear: 2026, expMonth: 3 }, now)).rejects.toThrow(/expired/);
  });

  it('decides the outcome by card and never charges twice for one idempotency key', async () => {
    const payrail = new FakePayrail();
    const good = await payrail.tokenizeCard(card(PAYRAIL_TEST_CARDS.succeeds), now);
    const poor = await payrail.tokenizeCard(card(PAYRAIL_TEST_CARDS.insufficientFunds), now);
    const request = { amount: 900, currency: 'EUR' as const, idempotencyKey: 'k1', metadata: { invoiceId: 'in_1', attempt: 1 } };

    const first = await payrail.createPayment({ ...request, paymentMethodToken: good.token });
    const again = await payrail.createPayment({ ...request, paymentMethodToken: good.token });
    expect(again).toEqual(first);
    expect(first.status).toBe('succeeded');
    expect(payrail.succeededCharges()).toHaveLength(1);
    await expect(payrail.createPayment({ ...request, amount: 901, paymentMethodToken: good.token })).rejects.toThrow(/different parameters/);

    const failed = await payrail.createPayment({ ...request, idempotencyKey: 'k2', paymentMethodToken: poor.token });
    expect(failed).toMatchObject({ status: 'failed', failureCode: 'insufficient_funds' });
    expect(payrail.drainEvents().map((e) => e.type)).toEqual(['payment.succeeded', 'payment.failed']);
  });

  it('agrees with another instance on ids, as separate processes must', async () => {
    const api = new FakePayrail();
    const worker = new FakePayrail();
    const { token } = await api.tokenizeCard(card(PAYRAIL_TEST_CARDS.succeeds), now);
    const request = { amount: 900, currency: 'EUR' as const, paymentMethodToken: token, idempotencyKey: 'k1', metadata: { invoiceId: 'in_1', attempt: 1 } };
    const charged = await worker.createPayment(request);
    expect(await api.createPayment(request)).toEqual(charged);

    const elsewhere = new FakePayrail();
    const refund = await elsewhere.refundPayment({ providerPaymentId: charged.id, amount: 900, idempotencyKey: 'r1' });
    expect(refund).toMatchObject({ providerPaymentId: charged.id, amount: 900 });
    expect(await elsewhere.refundPayment({ providerPaymentId: charged.id, amount: 900, idempotencyKey: 'r1' })).toEqual(refund);
    await expect(api.refundPayment({ providerPaymentId: 'not-a-payment', amount: 900, idempotencyKey: 'r2' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('can lose a request before or after processing it', async () => {
    const payrail = new FakePayrail();
    const { token } = await payrail.tokenizeCard(card(PAYRAIL_TEST_CARDS.succeeds), now);
    const request = { amount: 900, currency: 'EUR' as const, paymentMethodToken: token, idempotencyKey: 'k1', metadata: { invoiceId: 'in_1', attempt: 1 } };
    payrail.injectFault('unavailable_before_processing');
    await expect(payrail.createPayment(request)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(payrail.succeededCharges()).toHaveLength(0);
    payrail.injectFault('unavailable_after_processing');
    await expect(payrail.createPayment(request)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(payrail.succeededCharges()).toHaveLength(1);
  });
});
