-- Money columns are bigint minor units. Composite foreign keys on
-- (id, currency) make it impossible for a subscription, invoice, payment or
-- ledger entry to carry a currency other than its parent's.

CREATE TABLE plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  interval text NOT NULL CHECK (interval IN ('month', 'year')),
  trial_days integer NOT NULL CHECK (trial_days >= 0)
);

CREATE TABLE plan_prices (
  plan_id text NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency IN ('RUB', 'EUR')),
  amount bigint NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (plan_id, currency)
);

CREATE TABLE customers (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (name <> ''),
  email text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('RUB', 'EUR')),
  default_payment_method_id text,
  created_at timestamptz NOT NULL,
  UNIQUE (id, currency)
);
CREATE INDEX customers_created_idx ON customers (created_at DESC);

CREATE TABLE payment_methods (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers (id),
  provider_token text NOT NULL UNIQUE,
  brand text NOT NULL,
  last4 text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month integer NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, customer_id)
);
CREATE INDEX payment_methods_customer_idx ON payment_methods (customer_id);

-- The default card must belong to the customer.
ALTER TABLE customers ADD CONSTRAINT customers_default_payment_method_fkey
  FOREIGN KEY (default_payment_method_id, id) REFERENCES payment_methods (id, customer_id);

CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  plan_id text NOT NULL REFERENCES plans (id),
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  billing_anchor timestamptz NOT NULL,
  paid_cycles integer NOT NULL CHECK (paid_cycles >= 0),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  trial_end timestamptz,
  cancel_at_period_end boolean NOT NULL,
  canceled_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, currency),
  FOREIGN KEY (customer_id, currency) REFERENCES customers (id, currency),
  CHECK (current_period_end > current_period_start),
  CHECK ((status = 'canceled') = (ended_at IS NOT NULL))
);
CREATE INDEX subscriptions_period_end_idx ON subscriptions (current_period_end) WHERE status IN ('trialing', 'active');
CREATE INDEX subscriptions_customer_idx ON subscriptions (customer_id);

CREATE TABLE invoice_counters (
  year integer PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number > 0)
);

CREATE TABLE invoices (
  id text PRIMARY KEY,
  number text UNIQUE CHECK (number ~ '^LL-[0-9]{4}-[0-9]{6}$'),
  customer_id text NOT NULL REFERENCES customers (id),
  subscription_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cycle', 'proration')),
  status text NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  currency text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  total bigint NOT NULL CHECK (total >= 0),
  credit_applied bigint NOT NULL CHECK (credit_applied BETWEEN 0 AND total),
  amount_due bigint NOT NULL,
  amount_paid bigint NOT NULL CHECK (amount_paid BETWEEN 0 AND amount_due),
  amount_refunded bigint NOT NULL CHECK (amount_refunded BETWEEN 0 AND amount_paid),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  first_failed_at timestamptz,
  next_retry_at timestamptz,
  scheduled_retries integer NOT NULL DEFAULT 0 CHECK (scheduled_retries >= 0),
  created_at timestamptz NOT NULL,
  finalized_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  uncollectible_at timestamptz,
  UNIQUE (id, currency),
  -- The same period of a subscription is never billed twice.
  CONSTRAINT invoices_one_per_period UNIQUE (subscription_id, period_start, kind),
  FOREIGN KEY (subscription_id, currency) REFERENCES subscriptions (id, currency),
  CHECK (period_end > period_start),
  CHECK (amount_due = total - credit_applied),
  CHECK ((status = 'draft') = (number IS NULL))
);
CREATE INDEX invoices_retry_idx ON invoices (next_retry_at) WHERE status = 'open' AND next_retry_at IS NOT NULL;
CREATE INDEX invoices_subscription_idx ON invoices (subscription_id, status);
CREATE INDEX invoices_customer_idx ON invoices (customer_id, created_at DESC);

CREATE TABLE invoice_lines (
  invoice_id text NOT NULL REFERENCES invoices (id),
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('plan', 'proration_credit', 'proration_charge')),
  description text NOT NULL,
  amount bigint NOT NULL,
  plan_id text NOT NULL REFERENCES plans (id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  PRIMARY KEY (invoice_id, position)
);

CREATE TABLE payments (
  id text PRIMARY KEY,
  invoice_id text NOT NULL,
  customer_id text NOT NULL REFERENCES customers (id),
  subscription_id text NOT NULL REFERENCES subscriptions (id),
  attempt integer NOT NULL CHECK (attempt > 0),
  trigger text NOT NULL CHECK (trigger IN ('initial', 'scheduled_retry', 'payment_method_updated')),
  idempotency_key text NOT NULL UNIQUE,
  payment_method_id text REFERENCES payment_methods (id),
  provider_payment_id text UNIQUE,
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_attempt_at timestamptz NOT NULL,
  UNIQUE (invoice_id, attempt),
  FOREIGN KEY (invoice_id, currency) REFERENCES invoices (id, currency)
);
-- One payment in flight per invoice: a retry can never race a pending charge.
CREATE UNIQUE INDEX payments_one_pending_per_invoice ON payments (invoice_id) WHERE status = 'pending';
CREATE INDEX payments_pending_idx ON payments (last_attempt_at) WHERE status = 'pending';

CREATE TABLE ledger_accounts (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('accounts_receivable', 'customer_credit', 'revenue', 'provider_clearing', 'bad_debt')),
  currency text NOT NULL CHECK (currency IN ('RUB', 'EUR')),
  customer_id text,
  name text NOT NULL,
  UNIQUE (id, currency),
  FOREIGN KEY (customer_id, currency) REFERENCES customers (id, currency),
  CHECK ((kind IN ('accounts_receivable', 'customer_credit')) = (customer_id IS NOT NULL))
);

CREATE TABLE journal_transactions (
  id text PRIMARY KEY,
  seq bigserial UNIQUE,
  kind text NOT NULL CHECK (kind IN ('invoice_finalized', 'payment_succeeded', 'downgrade_credit', 'credit_applied',
                                     'write_off', 'refund', 'overpayment_credit', 'reversal')),
  currency text NOT NULL CHECK (currency IN ('RUB', 'EUR')),
  memo text NOT NULL,
  customer_id text REFERENCES customers (id),
  subscription_id text REFERENCES subscriptions (id),
  invoice_id text REFERENCES invoices (id),
  payment_id text REFERENCES payments (id),
  reverses_id text REFERENCES journal_transactions (id),
  posted_at timestamptz NOT NULL,
  UNIQUE (id, currency)
);
CREATE INDEX journal_transactions_posted_idx ON journal_transactions (posted_at DESC, seq DESC);
CREATE INDEX journal_transactions_invoice_idx ON journal_transactions (invoice_id) WHERE invoice_id IS NOT NULL;

-- Debits are positive, credits negative. The entry's currency must equal both
-- its transaction's and its account's, so one transaction has one currency.
CREATE TABLE journal_entries (
  id bigserial PRIMARY KEY,
  transaction_id text NOT NULL,
  account_id text NOT NULL,
  currency text NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0),
  CONSTRAINT journal_entries_transaction_currency_fkey FOREIGN KEY (transaction_id, currency) REFERENCES journal_transactions (id, currency),
  CONSTRAINT journal_entries_account_currency_fkey FOREIGN KEY (account_id, currency) REFERENCES ledger_accounts (id, currency)
);
CREATE INDEX journal_entries_transaction_idx ON journal_entries (transaction_id);
CREATE INDEX journal_entries_account_idx ON journal_entries (account_id);

CREATE TABLE webhook_events (
  id text PRIMARY KEY,
  provider_event_id text NOT NULL UNIQUE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  outcome text CHECK (outcome IN ('applied', 'duplicate_payment_update', 'stale_payment_update', 'unmatched', 'ignored_type', 'malformed')),
  note text
);
CREATE INDEX webhook_events_received_idx ON webhook_events (received_at DESC);

CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  resource_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE test_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  now timestamptz NOT NULL
);
