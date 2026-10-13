# Ledgerline HTTP API

Base URL `http://localhost:3000`. JSON in, JSON out.

## Conventions

- **Auth.** Every `/v1` route needs `Authorization: Bearer <LEDGERLINE_API_KEY>`. `/health` and `/webhooks/payrail` do not (the webhook is authenticated by its signature).
- **Money** is an integer number of minor units (kopecks, cents) next to a `currency` of `RUB` or `EUR`. `299000` with `RUB` is 2 990.00 RUB.
- **Time** is ISO 8601 in UTC. With `LEDGERLINE_TEST_CLOCK=1`, "now" is the stored test clock, not the wall clock.
- **Lists** take `limit` (1-200, default 50) and `offset`, and return `{ "data": [...], "limit", "offset" }`.
- **Idempotency.** `POST /v1/customers` and `POST /v1/subscriptions` require an `Idempotency-Key` header. Repeating a request with the same key returns the resource created the first time; the same key with a different body is `409 idempotency_conflict`.

## Errors

```json
{ "error": { "code": "payment_method_required", "message": "attach a payment method before subscribing to a plan without a trial" } }
```

| Status | Codes |
| --- | --- |
| 400 | `validation_failed` (with `details.issues[]` of `{ path, message }`), `invalid_json`, `idempotency_key_required`, `signature_missing`, `signature_malformed`, `signature_expired`, `signature_invalid` |
| 401 | `unauthorized` |
| 404 | `not_found`, `route_not_found`, `test_clock_disabled` |
| 409 | `idempotency_conflict`, `invalid_transition`, `duplicate_invoice`, `duplicate_key` |
| 415, 413 | `unsupported_media_type`, `payload_too_large` |
| 422 | `payment_method_required`, `card_not_supported`, `plan_unavailable`, `same_plan`, `interval_mismatch`, `subscription_not_changeable`, `currency_mismatch`, `invalid_argument` |
| 500 | `internal_error` |

## Plans

`GET /v1/plans` lists the catalog: `{ id, name, interval: "month" | "year", trialDays, prices: { RUB?, EUR? } }`.

## Customers

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /v1/customers` | `{ name, email, currency }` | `201` customer |
| `GET /v1/customers` | | list |
| `GET /v1/customers/:id` | | customer with `paymentMethods[]` and `creditBalance` |
| `POST /v1/customers/:id/payment-methods` | `{ card: { number, expMonth, expYear }, makeDefault? }` | `201` payment method |
| `POST /v1/customers/:id/payment-methods/:paymentMethodId/default` | | customer |

A new card becomes the default unless `makeDefault` is `false`. Whenever the default card changes, open invoices of past-due subscriptions are retried right away.

Payrail test cards (any future expiry): `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined, `4000 0000 0000 9995` fails with insufficient funds. Other numbers are `422 card_not_supported`.

## Subscriptions

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /v1/subscriptions` | `{ customerId, planId }` | `201` subscription |
| `GET /v1/subscriptions?customerId&status` | | list |
| `GET /v1/subscriptions/:id` | | subscription |
| `POST /v1/subscriptions/:id/plan-change/preview` | `{ planId }` | proration preview, nothing is changed |
| `POST /v1/subscriptions/:id/plan-change` | `{ planId }` | `{ subscription, preview, invoice }` |
| `POST /v1/subscriptions/:id/cancel` | | subscription with `cancelAtPeriodEnd: true` |
| `POST /v1/subscriptions/:id/resume` | | subscription with `cancelAtPeriodEnd: false` |

Status moves `trialing -> active -> past_due -> active | canceled`. A plan with a trial starts `trialing` and is first charged at `trialEnd`; a plan without one is invoiced and charged on creation and needs a default card. Renewals keep the anchor day of month, clamped to shorter months (Jan 31, Feb 28, Mar 31).

A plan change keeps the billing interval. The preview returns exactly what applying it would do:

```json
{
  "effect": "invoice_now",
  "changeAt": "2026-02-22T00:00:00.000Z",
  "periodStart": "2026-02-15T00:00:00.000Z",
  "periodEnd": "2026-03-15T00:00:00.000Z",
  "credit": 675,
  "charge": 2175,
  "net": 1500,
  "lines": [
    { "kind": "proration_credit", "description": "Unused time on Starter", "amount": -675 },
    { "kind": "proration_charge", "description": "Remaining time on Team", "amount": 2175 }
  ]
}
```

`credit = floor(old price × remaining seconds / period seconds)`, `charge` likewise with the new price. A positive `net` (`invoice_now`) is invoiced and charged at once; a negative one (`customer_credit`) becomes customer credit that the next invoice spends; `trial_switch` changes the plan of a trialing subscription without moving money.

## Invoices

| Method and path | Result |
| --- | --- |
| `GET /v1/invoices?customerId&subscriptionId&status` | list, newest first |
| `GET /v1/invoices/:id` | invoice with `lines[]` and `payments[]` |
| `POST /v1/invoices/:id/refund` | refunds the card payment of a paid invoice; repeating it is harmless |

`status` is `draft`, `open`, `paid`, `void` or `uncollectible`. `number` (`LL-2026-000123`) is assigned when the invoice is finalized, from a per-year counter with no gaps. Amounts: `total` (sum of `lines`), `creditApplied`, `amountDue = total - creditApplied`, `amountPaid`, `amountRefunded`. Dunning fields: `attemptCount`, `firstFailedAt`, `nextRetryAt`, `scheduledRetries`.

A failed payment makes the subscription `past_due` and schedules retries 1, 3 and 5 days after the first failure (`LEDGERLINE_DUNNING_RETRY_DAYS`). After the last one the invoice becomes `uncollectible`, the remainder is written off and the subscription is `canceled`.

## Ledger and metrics

| Method and path | Result |
| --- | --- |
| `GET /v1/ledger/accounts?customerId` | accounts with `debits`, `credits` and `balance` (debits minus credits) |
| `GET /v1/ledger/journal?accountId&invoiceId&kind` | journal transactions with their `entries[]`, newest first |
| `GET /v1/ledger/trial-balance` | `{ balanced, currencies: [{ currency, debits, credits, net }] }` |
| `GET /v1/metrics?days=30` | MRR per currency, subscription counts, churn in the last 30 days, revenue by day |

Accounts: `receivable:<customerId>`, `customer_credit:<customerId>`, `revenue:<currency>`, `provider_clearing:<currency>`, `bad_debt:<currency>`. Entries are signed, debit positive. Journal `kind`: `invoice_finalized`, `payment_succeeded`, `credit_applied`, `downgrade_credit`, `write_off`, `refund`, `overpayment_credit`, `reversal`.

MRR counts active and past-due subscriptions, yearly plans as a twelfth, trials not at all.

## Webhooks

`POST /webhooks/payrail` with the raw JSON body and

```
Payrail-Signature: t=1791877903,v1=5f2c...e1[,v1=...]
```

Each `v1` is hex HMAC-SHA256 of `<t>.<raw body>`. The timestamp must be within 300 seconds of the server's clock, and any `v1` may match any configured secret, so the old and new secret both work during rotation. Responses:

- `200 { "received": true, "duplicate": false, "outcome": "applied" }`. Other outcomes: `duplicate_payment_update`, `stale_payment_update` (for example a failure after a success, which is ignored and recorded), `unmatched`, `ignored_type`, `malformed`.
- `200 { "received": true, "duplicate": true, "outcome": null }` for an event id seen before. It is not processed again.
- `400` with a `signature_*` code, or `invalid_json` / `validation_failed` for a body that is not an event envelope.

`GET /v1/webhook-events` lists stored events with their outcome and note.

## Test clock

Enabled with `LEDGERLINE_TEST_CLOCK=1`; otherwise `POST` answers `404 test_clock_disabled`.

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /v1/test-clock` | | `{ enabled, now }` |
| `POST /v1/test-clock/advance` | `{ days?, hours? }` or `{ to }` | `{ from, to, days: [day report] }` |

The clock moves one day at a time and runs due work at every step, so a renewal that fails on one day is retried on the next before anything later happens. Each day report says what that step did:

```json
{
  "at": "2026-03-15T12:00:00.000Z",
  "trialsEnded": 0, "renewals": 1, "retries": 1,
  "paymentsSucceeded": 1, "paymentsFailed": 1, "writtenOff": 1,
  "canceled": 1, "recoveredPayments": 0, "errors": []
}
```

`canceled` counts subscriptions that ended at their period end and those dunning canceled after the last retry; `writtenOff` counts invoices made uncollectible; `recoveredPayments` counts pending payments asked about again.
