import { checkBooks, readBooks } from '../reconcile.js';
import type { BillingWorld } from './world.js';

/**
 * The reconciliation rules, plus the one only a test can check: every charge
 * the fake Payrail took against a local payment. Returns one line per broken
 * rule so a failing walk names every problem at once.
 */
export async function findInvariantViolations(
  world: BillingWorld,
  options: { capturedLater?: ReadonlySet<string> } = {},
): Promise<string[]> {
  const books = await world.store.run(readBooks, { readOnly: true });
  const problems = checkBooks(books).map((violation) => violation.message);
  const { payments } = books;

  const charged = world.provider.succeededCharges();
  for (const payment of payments.filter((p) => p.status === 'succeeded')) {
    const captured = charged.some((charge) => charge.id === payment.providerPaymentId) || options.capturedLater?.has(payment.providerPaymentId ?? '');
    if (!captured) problems.push(`payment ${payment.id} succeeded without a charge`);
  }
  for (const charge of charged) {
    const local =
      payments.find((p) => p.providerPaymentId === charge.id) ??
      payments.find((p) => p.invoiceId === charge.invoiceId && p.status === 'pending' && p.providerPaymentId === null);
    if (local?.status !== 'succeeded' && local?.status !== 'pending') problems.push(`charge ${charge.id} for ${charge.invoiceId} is not recorded as paid`);
  }
  return problems;
}
