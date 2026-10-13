import type { Customer } from '../customer.js';
import { BillingError } from '../errors.js';
import type { Invoice } from '../invoice.js';
import type { Plan } from '../plans.js';
import type { Lock, StoreTx } from '../ports/store.js';
import type { Subscription } from '../subscription.js';

function found<T>(row: T | null, what: string, id: string): T {
  if (row === null) throw new BillingError('not_found', `${what} ${id} not found`, { id });
  return row;
}

export const requireCustomer = async (tx: StoreTx, id: string, lock?: Lock): Promise<Customer> =>
  found(await tx.getCustomer(id, lock), 'customer', id);

export const requireSubscription = async (tx: StoreTx, id: string, lock?: Lock): Promise<Subscription> =>
  found(await tx.getSubscription(id, lock), 'subscription', id);

export const requireInvoice = async (tx: StoreTx, id: string, lock?: Lock): Promise<Invoice> =>
  found(await tx.getInvoice(id, lock), 'invoice', id);

export const requirePlan = async (tx: StoreTx, id: string): Promise<Plan> => found(await tx.getPlan(id), 'plan', id);
