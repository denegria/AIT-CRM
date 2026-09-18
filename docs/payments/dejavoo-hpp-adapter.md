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

Production:

- `DEJAVOO_PROD_API_KEY`
- `DEJAVOO_PROD_SECRET_KEY`
- `DEJAVOO_PROD_CLOUDPOS_TPN`
- `DEJAVOO_PROD_ECOM_TOKEN`
- `DEJAVOO_PRODUCTION_IO_ENABLED=true`

The production enable flag is an additional fail-closed release gate. The
shared `AIT_CRM_EXTERNAL_IO_DISABLED` kill switch blocks both environments.

## Provider contract

- Authenticate with API key, secret key, and a 30-minute expiry. Do **not** send
  a `scope` header; Dejavoo assigns the account's complete scope set.
- Create checkout through `POST /api/v3/external-payment-transaction` using a
  fixed USD amount in integer minor units and the existing payment-request
  merchant reference.
- Query status through `GET /v1/queryPaymentStatus` using the same merchant
  reference plus the TPN-bound Ecom token.
- Treat browser redirects as navigation only. MIS-417 must verify status
  server-to-server before recording money.

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
