# Dejavoo HPP adapter

`src/lib/payments/providers/dejavoo.js` is the server-only provider boundary for
Dejavoo Hosted Payment Pages. Routes and actions remain responsible for
authorization, business-unit scope, prices, payment-request state, and whether
checkout is allowed.

## Environment contract

The caller must choose `uat` or `production` explicitly. The adapter never
infers an environment and never falls back to unqualified variable names.

UAT:

- `DEJAVOO_UAT_API_KEY`
- `DEJAVOO_UAT_SECRET_KEY`
- `DEJAVOO_UAT_CLOUDPOS_TPN`
- `DEJAVOO_UAT_ECOM_TOKEN`
- `DEJAVOO_UAT_CALLBACK_AUTH_HEADER`

Production:

- `DEJAVOO_PROD_API_KEY`
- `DEJAVOO_PROD_SECRET_KEY`
- `DEJAVOO_PROD_CLOUDPOS_TPN`
- `DEJAVOO_PROD_ECOM_TOKEN`
- `DEJAVOO_PROD_CALLBACK_AUTH_HEADER`
- `DEJAVOO_PRODUCTION_IO_ENABLED=true`

The production enable flag is an additional fail-closed release gate. The
shared `AIT_CRM_EXTERNAL_IO_DISABLED` kill switch blocks both environments.

For an approved, status-only recovery window, set
`DEJAVOO_PRODUCTION_STATUS_RECHECK_ENABLED=true` instead of the payment I/O
flag. This permits only the `status` adapter capability; checkout-link creation
and ordinary Production callback processing remain disabled. Remove the flag
and reload Production after recovery. Do not enable it for routine operation
until the recovery flow has been reviewed as a permanent product feature.

## Provider contract

- Authenticate with API key, secret key, and a 30-minute expiry. Do **not** send
  a `scope` header; Dejavoo assigns the account's complete scope set.
- Create checkout through `POST /api/v3/external-payment-transaction` using a
  fixed USD amount in integer minor units and the existing payment-request
  merchant reference. New HPP references are deterministic, alphanumeric, and
  at most 20 characters per Dejavoo's detailed HPP request contract. Staff,
  portal, and registration each use a distinct one-letter namespace plus 19
  hexadecimal hash characters. A legacy nonconforming request is blocked before
  provider I/O or a hosted-attempt write; create a new payment request instead.
- Query status through `GET /v1/queryPaymentStatus` using the same merchant
  reference plus the TPN-bound Ecom token. Legacy references remain accepted
  for status queries and callbacks so older requests remain reconcilable.
- Treat browser redirects as navigation only. MIS-417 must verify status
  server-to-server before recording money.
- Configure `postAPI` as `/api/payments/dejavoo/callback` and pass the matching
  environment-qualified callback authorization value as `authHeader`. UAT and
  production callback values must be distinct.

## Existing-callback recovery

An administrator with `FINANCIALS_WRITE` may POST `action:
"recover_hosted_payment"` and `paymentRequestId` to `/api/collections` in the
AIT USA business-unit scope. The action never creates a link or charges a card.
It requires a persisted authenticated `200/Success` callback, then queries
Dejavoo for the current status. A successful status must include response code
200, the same provider transaction ID and amounts as the callback, and the
expected merchant/reference/environment. The existing locked, idempotent
reconciliation service then creates the transaction, receipt, and allocation
exactly once. `Pending` remains pending; a provider/callback conflict requires
manual investigation, not a manual credit. Verify the resulting ledger and
receipt before calling the payment confirmed.

## Retry and secrecy rules

- Authentication and status GET calls may retry once for a network failure,
  timeout, rate limit, or transient provider error.
- HPP creation never retries automatically after the provider request begins.
- Checkout URLs contain a provider transaction token. Return them only to the
  authorized redirect caller; do not log or persist them as ordinary metadata.
- Never log API keys, secret keys, JWTs, Ecom tokens, callback authorization
  headers, provider bodies, or card data.

## Validation

Run the focused contract suite:

```bash
npm run test:dejavoo
```

The suite uses fixtures only. It makes no Dejavoo, database, staging, or
production requests.

## 2026-10-01 status-only recovery closeout

The approved Production recheck of the existing $1.00 Apple Pay reference
returned Dejavoo `Success`. CRM recorded one verified $1.00 provider
transaction, a paid $1.00 receipt, and $1.00 unapplied account credit; no new
checkout or charge was created. The temporary status-recheck flag was removed
from the Production environment. This documentation-only change triggers a
fresh Production build so the running functions also return to fail-closed
mode. The ordinary Production payment-I/O flag remains unset.
