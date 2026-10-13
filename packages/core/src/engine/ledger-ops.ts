import type { Customer } from '../customer.js';
import type { IdGenerator } from '../ids.js';
import { assertBalanced, customerCreditAccount, toJournalTransaction, type JournalTransaction, type Posting } from '../ledger.js';
import type { StoreTx } from '../ports/store.js';

export async function post(tx: StoreTx, posting: Posting, now: Date, ids: IdGenerator): Promise<JournalTransaction> {
  assertBalanced(posting);
  await tx.ensureLedgerAccounts(posting.lines.map((line) => line.account));
  const transaction = toJournalTransaction(posting, ids('jt'), now);
  await tx.insertJournalTransaction(transaction);
  return transaction;
}

/** Credit the customer can spend; the credit account is a liability, so a credit balance is negative. */
export async function availableCredit(tx: StoreTx, customer: Customer): Promise<number> {
  const balance = await tx.getAccountBalance(customerCreditAccount(customer.id, customer.currency).id);
  return balance < 0 ? -balance : 0;
}
