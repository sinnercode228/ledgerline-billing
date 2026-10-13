# Ledgerline

[![CI](https://github.com/sinnercode228/ledgerline-billing/actions/workflows/ci.yml/badge.svg)](https://github.com/sinnercode228/ledgerline-billing/actions/workflows/ci.yml)

Русская версия: [README.ru.md](README.ru.md)

Ledgerline is subscription billing in TypeScript: plans with trials, renewals on the anchor day, proration when a plan changes, invoice numbers without gaps, dunning, and a double-entry ledger that every movement of money is posted to. The billing engine is one package with no runtime dependencies. On the server it runs behind a Fastify API on PostgreSQL; in the demo the same engine runs in the browser on an in-memory store. Payments go to Payrail, a payment provider I made up and simulate in-process; there is no adapter for a real provider in this repository.

Ledgerline, Payrail and every customer in the demo and the seed are made up; the code and the tests are real.

Demo: https://sinnercode228.github.io/ledgerline-billing/. On the first visit the page runs the engine through 182 days of history from a fixed seed, ending at 09:00 UTC today, and keeps the result in localStorage. Press "+1 week" in the top bar first. The strip under it says what the week did: Riverbend Logistics, past due when you arrive, gets its last two retries and is written off, and the trial of Gristmill Tools ends on a card that declines. Then open Riverbend's invoice from Customers: it lists the four attempts and the two journal transactions. "Reset" in the sidebar starts over.

![Invoice LL-2026-000056 of Riverbend Logistics in the demo: four declined attempts on 11, 12, 14 and 16 October, the write-off, and the journal with the invoice posting and the bad-debt posting](docs/screenshots/invoice-written-off.png)

Stack: TypeScript 5.9 on Node 22, Fastify 5, zod 4, `pg` with plain SQL, PostgreSQL 16; React 19 and Vite 7 for the dashboard; Vitest 4 and fast-check for the tests.

## One subscription from trial to write-off

I ran this through the HTTP API with `LEDGERLINE_TEST_CLOCK=1` on a freshly migrated database without the seed. The test clock is a stored "now" that only moves forward. `POST /v1/test-clock/advance` moves it one day at a time and runs due work at every step ([`test-clock.ts`](packages/core/src/engine/test-clock.ts)), so a renewal that fails on one day is retried on the next before anything later happens. I moved the clock to 17 December 2026, 09:00 UTC, first, to get round dates; the other routes are in [`docs/api.md`](docs/api.md).

```sh
api() { local path=$1; shift; curl -s -H "Authorization: Bearer $LEDGERLINE_API_KEY" -H 'content-type: application/json' "http://localhost:3000$path" "$@"; }
api /v1/test-clock/advance -d '{"to":"2026-12-17T09:00:00Z"}' > /dev/null
CUS=$(api /v1/customers -H 'Idempotency-Key: cus-1' -d '{"name":"Borealis Analytics","email":"billing@borealis.example.com","currency":"RUB"}' | jq -r .id)
api /v1/customers/$CUS/payment-methods -d '{"card":{"number":"4242 4242 4242 4242","expMonth":12,"expYear":2029}}'
SUB=$(api /v1/subscriptions -H 'Idempotency-Key: sub-1' -d '{"customerId":"'$CUS'","planId":"plan_starter_monthly"}' | jq -r .id)
api /v1/test-clock/advance -d '{"days":14}'   # the trial ends; then {"to": ...} for each later step
```

| Simulated date | What the engine did | Journal: debit / credit |
|---|---|---|
| 17 Dec 2026 | Subscribed to Starter, 990.00 RUB a month with a 14-day trial. Status `trialing`; the billing anchor is the trial end, 31 Dec 09:00. Nothing is invoiced. | nothing |
| 31 Dec | The trial ends. `LL-2026-000001` for 31 Dec – 31 Jan, 990.00, paid by the 4242 card in the same run. | receivable / revenue 990.00; Payrail clearing / receivable 990.00 |
| 31 Jan 2027 | Renewal `LL-2027-000001`: the counter is per year. The period is 31 Jan – 28 Feb, and the one after it 28 Feb – 31 Mar: each boundary is computed from the anchor and clamped to the month, so the day does not drift to the 28th. | the same pair |
| 10 Feb | Upgrade to Team, 2,990.00 a month, with 18 of 28 days left: proration invoice `LL-2027-000002`, 1,285.72, charged at once. | receivable / revenue 1,285.72; clearing / receivable 1,285.72 |
| 10 Feb | A new default card, `4000 0000 0000 0002`, which Payrail declines. | nothing |
| 28 Feb | Renewal `LL-2027-000003`, 2,990.00: `card_declined`. The subscription is `past_due`, `nextRetryAt` is 1 Mar 09:00. | receivable / revenue 2,990.00 |
| 1 and 3 Mar | Attempts 2 and 3, trigger `scheduled_retry`, declined. | nothing |
| 5 Mar | Attempt 4 is declined and the schedule is used up: the invoice becomes `uncollectible`, the subscription `canceled` with `endedAt` 5 Mar. | bad debt / receivable 2,990.00 |

After 5 March the accounts read: revenue 6,255.72 on the credit side, Payrail clearing 3,265.72 and bad debt 2,990.00 on the debit side, the customer's receivable 0. The trial balance has 12,511.44 on each side.

The upgrade as `POST /v1/subscriptions/:id/plan-change/preview` returned it, before anything changed (period fields and plan ids left out):

```json
{
  "effect": "invoice_now", "changeAt": "2027-02-10T09:00:00.000Z",
  "credit": 63642, "charge": 192214, "net": 128572, "creditApplied": 0, "amountDue": 128572,
  "lines": [
    { "kind": "proration_credit", "description": "Unused time on Starter", "amount": -63642 },
    { "kind": "proration_charge", "description": "Remaining time on Team", "amount": 192214 }
  ]
}
```

Amounts are integer kopecks. [`proration.ts`](packages/core/src/proration.ts) works in whole seconds: the period has 2,419,200, and 1,555,200 are left. The credit is floor(99,000 × 1,555,200 / 2,419,200) = 63,642 (exactly 63,642.86), the charge floor(299,000 × 1,555,200 / 2,419,200) = 192,214 (192,214.29). The product goes through `BigInt` in `mulDivFloor` ([`money.ts`](packages/core/src/money.ts)), so it stays exact past 2^53. Both lines are rounded down, so a full period prorates to exactly the price and a credit never exceeds what was paid. `changePlan` computes the same quote again under the subscription and customer locks and applies it, so the invoice carries exactly these two lines. A downgrade goes the other way: the negative net is posted as `downgrade_credit` (revenue / customer credit), and the next invoice spends that credit before it charges the card. In the demo, the plan change dialog shows that split:

![The plan change dialog for Saltmarsh Media: unused time on Starter -€1.50, remaining time on Team €4.83, net €3.33, customer credit -€2.00, charged to the card now €1.33](docs/screenshots/plan-change-preview.png)

Retry days come from `LEDGERLINE_DUNNING_RETRY_DAYS` (default `1,3,5`) and count from the first failure, not from the previous attempt ([`dunning.ts`](packages/core/src/dunning.ts)). Retries started by a new card do not use up the schedule: attaching a card or choosing another default retries every failing invoice at once, with trigger `payment_method_updated` ([`customers.ts`](packages/core/src/engine/customers.ts)). When the schedule runs out, `giveUp` writes off what each open invoice of the subscription still owes and ends the subscription ([`payment-results.ts`](packages/core/src/engine/payment-results.ts#L173-L212)).

## Why the trial balance stays at zero

There are five kinds of account: `receivable:<customer>`, `customer_credit:<customer>`, `revenue:<currency>`, `provider_clearing:<currency>` and `bad_debt:<currency>`. Amounts are signed, debit positive. Every posting the engine makes comes from one `transfer(kind, input, debit, credit)` in [`ledger.ts`](packages/core/src/ledger.ts), two lines of the same amount, or is the mirror image of one (`reversePosting`), and `assertBalanced` checks it once more before it is written. That guards against mistakes in the engine. The database checks again on its own, whatever code writes to it ([`002_ledger_guards.sql`](server/migrations/002_ledger_guards.sql#L7-L50)):

```sql
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entries_check_balanced();
```

The trigger function calls `ledger_assert_balanced`, which counts and sums the transaction's entries and raises `check_violation` with constraint `journal_transaction_balanced` unless there are at least two and they sum to zero. A CHECK cannot look at other rows, and a trigger that fired right away would reject the first entry of every transaction, since nothing balances after one entry. Deferred to COMMIT, entries go in one by one, and if they do not add up the whole transaction rolls back, the invoice and payment rows with it. A second deferred trigger, on `journal_transactions`, catches a header that never got entries. [`ledger-constraints.test.ts`](server/test/ledger-constraints.test.ts) inserts +500 and −400 by hand: both inserts succeed, COMMIT fails with "entries sum to 100", and no entry is left.

The same migration and [`001_schema.sql`](server/migrations/001_schema.sql) add the other rules:

- The ledger is append-only: UPDATE, DELETE and TRUNCATE on both journal tables raise `restrict_violation`. A correction is a mirror transaction with `reversesId` pointing at the original.
- One currency per transaction is structural: an entry carries the currency, with foreign keys on `(transaction_id, currency)` and `(account_id, currency)`.
- Invoice lines cannot be changed, a deferred trigger checks that they sum to the invoice total, and a CHECK keeps `amount_due = total - credit_applied`.
- Payment status only moves forward (`payments_status_forward_only`), and a partial unique index allows one pending payment per invoice.
- Invoice numbers come from a per-year counter row: `INSERT ... ON CONFLICT (year) DO UPDATE SET last_number = invoice_counters.last_number + 1 RETURNING last_number`. The row stays locked until COMMIT, so a concurrent finalization waits and a rollback gives the number back. The scenario "numbers 20 concurrent finalizations without gaps, even when others roll back" runs on both stores.
- One cycle invoice per subscription and period start, a partial unique index since migration 003. Proration invoices are left out of it, because two plan changes can share an instant on the test clock.

`MemoryStore` enforces the same rules at the same moments. It runs every transaction on a `structuredClone` of its state, checks the journal transactions added during it before swapping the copy in, and drops the copy on any error ([`memory-store.ts`](packages/core/src/memory/memory-store.ts)). On top of the fixed scenarios, [`random-walk.ts`](packages/core/src/testing/scenarios/random-walk.ts) runs 240 simulated days on two seeds: plan changes, card swaps, refunds, webhook-only answers, dropped answers, late, repeated and reordered webhooks, two workers at once. After every step [`invariants.ts`](packages/core/src/testing/invariants.ts) compares the documents with the books: the trial balance, each receivable against what the customer's open invoices owe, clearing against payments less refunds, revenue against billed less credits and refunds, bad debt against what uncollectible invoices owe, and every Payrail charge against a local payment.

## One engine on PostgreSQL and in the browser

```mermaid
flowchart TB
    subgraph page["web/ in the browser"]
        UI["React dashboard"]
        DEMO["DemoApi, same JSON as /v1"]
    end
    subgraph node["server/ on Node"]
        API["Fastify /v1 routes"]
        WH["POST /webhooks/payrail"]
        WK["worker, due work every 60 s"]
    end
    UI --> DEMO
    UI -. "VITE_API_URL" .-> API
    DEMO --> ENG["BillingEngine in packages/core, every call takes now"]
    API --> ENG
    WH --> ENG
    WK --> ENG
    ENG --> STORE["Store port"]
    ENG --> PROV["PaymentProvider port"]
    STORE --> MEM["MemoryStore, saved to localStorage"]
    STORE --> PG[("PgStore on PostgreSQL 16")]
    PROV --> FAKE["FakePayrail, in-process; relay.ts posts its signed events to the webhook route"]
```

The engine never reads the wall clock. Every method takes `now`, and the server passes the system time or, with the test clock on, the time stored in the database ([`clock.ts`](server/src/clock.ts)). It reaches storage only through the `Store` port ([`ports/store.ts`](packages/core/src/ports/store.ts)): `run(work)` is one transaction, and the 40 methods of `StoreTx` are what the engine may do inside it. Two of them make several workers safe on PostgreSQL: `claimDueSubscription` takes one due subscription with `FOR UPDATE OF s SKIP LOCKED`, so each period is billed once however many workers run, and `lockIdempotencyKey` takes `pg_advisory_xact_lock`, which also covers a key that has no row yet. Every caller locks in one order, subscription, customer, invoice, payment, as the port's comment requires. [`pg-store.ts`](server/src/store/pg-store.ts) is plain SQL through `pg`, with a typed mapper per row that converts `bigint` columns safely.

`packages/core` has no Node-only imports. ESLint's `no-restricted-imports` rejects `node:*` and the Node built-ins there, its tsconfig has `types: []` and the DOM library, and the webhook signature uses Web Crypto. The dashboard talks to a `LedgerlineApi` interface ([`client.ts`](web/src/api/client.ts)) with two implementations: [`http-client.ts`](web/src/api/http-client.ts) for a server, and [`demo-api.ts`](web/src/demo/demo-api.ts), which calls the engine on a `MemoryStore` with `FakePayrail` and builds its answers with the same representation functions as the server routes. The demo is loaded with a dynamic `import()`, so the build for a server has no demo chunk. The demo world uses a seeded id generator and a seeded random source, so everyone who opens it on the same day gets the same world, id for id; after every change it saves `MemoryStore.dump()` to localStorage ([`world.ts`](web/src/demo/world.ts)).

More from the demo: [the overview after "+1 week"](docs/screenshots/overview-after-a-week.png), [the webhook log](docs/screenshots/webhooks.png), [a past-due subscription on a phone, in Russian](docs/screenshots/phone-past-due-ru.png).

What every store must do is one suite of 34 scenarios in [`packages/core/src/testing/scenarios`](packages/core/src/testing/scenarios). The core runs it on `MemoryStore`; the server runs it on `PgStore` with a freshly migrated schema per test ([`database.ts`](server/test/helpers/database.ts)).

## Payrail webhooks: signatures, duplicates, late answers

A charge is split in two so that no row lock is held during a network call ([`charging.ts`](packages/core/src/engine/charging.ts)). `startPayment` writes a `pending` payment with the key `ledgerline:<invoice id>:attempt:<n>` inside the billing transaction. After COMMIT, `executeCharge` sends it to Payrail with that key and applies the answer in a new transaction. If the call fails, the outcome is unknown and the payment stays pending. At the end of every due-work run a recovery sweep asks again, with the same key, about payments still pending 10 minutes after Payrail was last asked, and Payrail returns the original payment instead of charging twice. `FakePayrail` derives payment ids from the key, so the API process and the worker agree on them.

The API answer, a webhook and the sweep all end in `applyPaymentResult` ([`payment-results.ts`](packages/core/src/engine/payment-results.ts#L59-L98)). Status only moves forward, pending → failed → succeeded: the same outcome twice changes nothing, a failure after a success is stored as `stale_payment_update`, and a success after a failure is applied. In the run above Payrail answered every charge at once, and the relay ([`relay.ts`](server/src/payrail/relay.ts)) then delivered the same seven outcomes as signed webhooks; all seven were stored as `duplicate_payment_update`.

`Payrail-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]`: each `v1` is HMAC-SHA256 of `<t>.<raw body>` ([`signature.ts`](packages/core/src/payrail/signature.ts)). The route registers its own content-type parser that keeps the body as a Buffer, so the HMAC covers the bytes Payrail sent, not re-serialized JSON ([`webhooks.ts`](server/src/http/routes/webhooks.ts)). The timestamp must be within 300 s of the wall clock, the real one even when billing runs on the test clock. Any `v1` may match any secret in `LEDGERLINE_WEBHOOK_SECRET=new,old`, which is how a secret is rotated, and the hex comparison does not stop at the first differing character. A verified event is inserted with a unique `provider_event_id` and processed in the same transaction ([`webhooks.ts`](packages/core/src/engine/webhooks.ts)): a redelivery gets `duplicate: true` and changes nothing, and if processing throws, nothing is stored and the next delivery is handled from scratch.

Here is what happens when Payrail reports, after the write-off, that attempt 4 went through after all. I played Payrail with `openssl`; the ids are from my run, take yours from `GET /v1/invoices/:id`:

```sh
body='{"id":"evt_late_1","type":"payment.succeeded","created":1800000000,"data":{"object":{"object":"payment","id":"pay_d96470687f9d85ecbb117d7b","amount":299000,"currency":"RUB","status":"succeeded","failure_code":null,"metadata":{"invoice_id":"in_b2923273bee385a188672490","attempt":"4"}}}}'
t=$(date +%s); sig=$(printf '%s.%s' "$t" "$body" | openssl dgst -sha256 -hmac "$LEDGERLINE_WEBHOOK_SECRET" | sed 's/^.*= //')
curl -s http://localhost:3000/webhooks/payrail -H 'content-type: application/json' -H "Payrail-Signature: t=$t,v1=$sig" --data-raw "$body"
# {"received":true,"duplicate":false,"outcome":"applied"}; sent again: {"received":true,"duplicate":true,"outcome":null}
# a changed signature: 400 signature_invalid; t older than 300 s: 400 signature_expired
```

The invoice becomes `paid`. The write-off stays in the journal, followed by two new transactions: `payment_succeeded` (clearing / receivable 2,990.00) and a `reversal` (receivable / bad debt 2,990.00) whose `reversesId` points at the write-off. The subscription stays canceled. Customer and subscription creation are idempotent too: `POST /v1/customers` and `POST /v1/subscriptions` require an `Idempotency-Key`, a repeat returns the resource the first request created, and the same key with another body is `409 idempotency_conflict`.

## Known limitations

- **No real payment provider.** `createRuntime` always builds `FakePayrail` ([`runtime.ts`](server/src/runtime.ts)), which keeps its payments in process memory. A real adapter would implement the three methods of `PaymentProvider` ([`ports/provider.ts`](packages/core/src/ports/provider.ts)) and turn the provider's events into the shape `readPaymentObject` reads.
- **Revenue is recognized when an invoice is finalized.** `invoice_finalized` credits revenue directly; there is no deferred revenue account, so a yearly plan counts its whole price as revenue on the day it is invoiced.
- **Plan changes keep the billing interval, and refunds are whole.** Monthly to yearly is `422 interval_mismatch`; cancel and subscribe again instead. A refund returns everything the card paid for one paid invoice, and the subscription keeps running. The invoice state machine has a `void` status that nothing produces.
- **A past-due subscription does not renew while dunning runs.** `claimDueSubscription` picks it up only for retries ([`pg-store.ts`](server/src/store/pg-store.ts#L248-L262)). If its period ends in the meantime, the next period is billed, with its original dates, after the subscription recovers.

## Running it

The fastest way is the [demo](https://sinnercode228.github.io/ledgerline-billing/). [`pages.yml`](.github/workflows/pages.yml) runs the dashboard tests, builds `web/` with `VITE_API_MODE=mock` and `BASE_PATH=/<repo>/`, and copies `index.html` to `404.html`. After `npm ci`, `VITE_API_MODE=mock npm run dev:web` runs the same thing on http://localhost:5173.

With Docker, put the two secrets into `.env` and start the stack:

```sh
printf 'LEDGERLINE_API_KEY=%s\nLEDGERLINE_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose up --build
```

[`docker-compose.yml`](docker-compose.yml) starts PostgreSQL 16, runs `migrate` and then `seed`, which skips a database that already has customers, then the API on http://localhost:3000 and a separate `worker`. The test clock is on unless `.env` sets `LEDGERLINE_TEST_CLOCK`. The image holds the API only; run the dashboard with `npm ci && npm run dev:web` and paste the key from `.env`.

Locally, with Node 22.12 or newer and PostgreSQL 16:

```sh
git clone https://github.com/sinnercode228/ledgerline-billing.git && cd ledgerline-billing
npm ci
psql postgres://postgres:postgres@localhost:5432/postgres -c 'CREATE DATABASE ledgerline_dev'
cp .env.example .env    # set LEDGERLINE_API_KEY and LEDGERLINE_WEBHOOK_SECRET (openssl rand -hex 32), LEDGERLINE_TEST_CLOCK=1
npm run build:server
npm run migrate         # migrations 001-003 and the plan catalog
npm run seed            # 120 days of history for 13 customers on the test clock
npm run serve           # API on http://localhost:3000
npm run worker          # second terminal: due work every 60 s
npm run dev:web         # third terminal: dashboard on http://localhost:5173, asks for the API key once
```

`npm run seed -- --days 60` seeds another length (1 to 730 days). The npm scripts read `.env` through `node --env-file-if-exists`.

| Variable | Default | Notes |
|---|---|---|
| `LEDGERLINE_DATABASE_URL` | none, required | PostgreSQL connection string |
| `LEDGERLINE_API_KEY` | none, required | bearer key for `/v1`; at least 32 characters, refused if it looks like a placeholder |
| `LEDGERLINE_WEBHOOK_SECRET` | none, required | comma-separated during rotation, `new,old`; each at least 16 characters; the first signs the relay's events |
| `LEDGERLINE_DEV` | `0` | `1` allows missing or weak keys for local work |
| `LEDGERLINE_TEST_CLOCK` | `0` | `1` stores "now" in the database and enables `POST /v1/test-clock/advance`, at most 400 days per request |
| `LEDGERLINE_DUNNING_RETRY_DAYS` | `1,3,5` | days after the first failure, strictly increasing |
| `LEDGERLINE_PAYRAIL_WEBHOOK_URL` | empty | where the fake Payrail's signed events go; empty applies results in-process only |
| `LEDGERLINE_CORS_ORIGINS` | empty | exact browser origins, comma-separated |
| `LEDGERLINE_HOST`, `LEDGERLINE_PORT` | `0.0.0.0`, `3000` | |
| `LEDGERLINE_LOG_LEVEL` | `info` | pino level |
| `LEDGERLINE_TEST_DATABASE_URL` | empty | tests only; the PostgreSQL suites skip without it |

The dashboard build reads `VITE_API_MODE` (`mock` runs the engine in the page), `VITE_API_URL` (default `http://localhost:3000`) and `BASE_PATH`.

## Tests

```sh
psql postgres://postgres:postgres@localhost:5432/postgres -c 'CREATE DATABASE ledgerline_test'
LEDGERLINE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ledgerline_test npm test
npm run lint && npm run typecheck
```

232 Vitest tests in 38 files, counted from Vitest's JSON reporter: 101 in `packages/core` (15 files), 82 in `server` (9 files) and 49 in `web` (14 files). Of those, 68 are the 34 shared scenarios, once on each store, the two random walks included. fast-check property tests cover proration (a full period gives the price, a credit never exceeds what was paid over any sequence of plan changes, lines sum to the total), `mulDivFloor` against the exact rational value, the calendar and the trial balance. Six tests in [`ledger-constraints.test.ts`](server/test/ledger-constraints.test.ts) write rows by hand to check the triggers and keys above. The HTTP tests go through Fastify's `inject` on both stores: auth, validation, `Idempotency-Key`, signatures that are good, expired, tampered or made with the previous secret, the 400-day clock limit and CORS. The web tests run in jsdom: the demo world, the plan change dialog, the clock bar, persistence, i18n and formatting. Without `LEDGERLINE_TEST_DATABASE_URL`, core and server run 131 tests and skip 40.

[`ci.yml`](.github/workflows/ci.yml) runs lint, `tsc -b`, the core and server tests against a `postgres:16-alpine` service and the server build in one job, and the dashboard's lint, typecheck, tests and both builds, for a server and for the demo, in another.

---

Built by Грешный Котик (sinnercode). I take freelance work like this: Telegram [@sinnercode](https://t.me/sinnercode). License: [MIT](LICENSE).
