import { BillingError } from '../errors.js';
import type { StoreTx } from '../ports/store.js';

/**
 * Returns the id created by an earlier request with the same key, or null
 * when the key is new. The key stays locked until the caller's transaction
 * ends, so a concurrent duplicate waits and then sees the stored result.
 */
export async function findReplay(tx: StoreTx, scope: string, key: string, fingerprint: string): Promise<string | null> {
  const record = await tx.lockIdempotencyKey(scope, key);
  if (!record) return null;
  if (record.fingerprint !== fingerprint) {
    throw new BillingError('idempotency_conflict', 'this Idempotency-Key was already used with a different request');
  }
  return record.resourceId;
}

export async function rememberResult(
  tx: StoreTx,
  input: { scope: string; key: string; fingerprint: string; resourceId: string; now: Date },
): Promise<void> {
  await tx.saveIdempotencyKey({
    scope: input.scope,
    key: input.key,
    fingerprint: input.fingerprint,
    resourceId: input.resourceId,
    createdAt: input.now,
  });
}
