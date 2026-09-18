# Dejavoo callback reconciliation

`POST /api/payments/dejavoo/callback` is a server-only notification and
reconciliation boundary. A browser redirect never marks a payment paid.

## Trust boundary

1. The exact `Authorization` header selects one explicitly configured Dejavoo
   environment.
2. The raw JSON body is size-limited, hashed, and reduced to an allowlisted
   audit payload. Card fields, tokens, and consumer identifiers are discarded.
3. The callback transaction reference locates an existing payment request that
   is already bound to `dejavoo` and the selected environment.
4. The server queries Dejavoo payment status with the environment's configured
   TPN and Ecom token.
5. Only a successful status whose reference, merchant, amount, currency, and
   provider transaction id all match may create verified financial state.

## Exactly-once behavior

Reconciliation uses a request-scoped Postgres advisory lock and one database
transaction. It records or reuses the provider event, creates or reuses the
provider transaction, applies deterministic allocation keys, creates one
receipt, records one CRM activity event, updates registration payment metadata,
and completes the payment request atomically.

Repeated callback bodies are keyed by their SHA-256 hash. Pending and provider
outage outcomes remain replayable. Reordered terminal failures cannot regress a
completed payment. Tuition prepayment remains the verified transaction's
unallocated balance until a later charge consumes it.

## Failure visibility

- Pending or unknown status: event remains `received`, request remains pending.
- Retryable provider failure: event becomes `failed` with a safe error code;
  the same callback can reconcile later.
- Amount, currency, merchant, reference, or transaction conflict: event becomes
  `failed` and a `financial.payment_reconciliation_attention` timeline event is
  created for operator review. No money is recorded.

## Validation

```bash
npm run test:payment-reconciliation
npm run test:billing-ledger
npm run test:dejavoo
```

The focused suites are fixture-only and make no provider or database requests.
