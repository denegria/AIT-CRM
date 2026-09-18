# Dejavoo SPIn terminal checkout

`src/lib/payments/providers/dejavoo-spin.js` is the server-only boundary for
Dejavoo SPIn REST terminal operations. The Collections route owns staff RBAC,
AIT USA business-unit scope, payment-request eligibility, and whether a
terminal operation may start. The adapter owns provider transport and response
normalization only. Verified results flow through the same reconciliation,
allocation, receipt, and fulfillment invariants as hosted payments.

## Environment contract

| Environment | Base URL | Required variables |
| --- | --- | --- |
| UAT | `https://test.spinpos.net` | `DEJAVOO_UAT_SPIN_TPN`, `DEJAVOO_UAT_SPIN_REGISTER_ID`, `DEJAVOO_UAT_SPIN_AUTH_KEY` |
| Production | `https://spinpos.net` | `DEJAVOO_PROD_SPIN_TPN`, `DEJAVOO_PROD_SPIN_REGISTER_ID`, `DEJAVOO_PROD_SPIN_AUTH_KEY`, `DEJAVOO_SPIN_PRODUCTION_IO_ENABLED=true` |

The Auth Key is secret. TPN and Register ID are terminal identifiers and still
remain server-only. Never use environment-unqualified fallback names. The
shared `AIT_CRM_EXTERNAL_IO_DISABLED` kill switch blocks all SPIn network I/O.

Production remains disabled unless its dedicated gate is explicitly enabled.
That gate is necessary but not sufficient for a production release.

## Operations

- `POST /v2/Payment/Sale` starts one fixed USD sale using the amount and
  reference already stored on the authoritative payment request.
- `POST /v2/Payment/Status` checks an existing attempt by the same reference.
- A mutating Sale call is never retried automatically.
- A read-only Status call may retry one transient provider failure.
- HPP and SPIn cannot both be attempted on the same payment request.
- A second Sale is blocked after any terminal attempt. Staff must use **Check
  terminal status** or create a new payment request after a verified final
  non-payment result.

The CRM persists only safe provider codes, status, correlation ID, and stable
transaction references. Auth Key, full provider payloads, card data, and
receipt bodies are never written to payment metadata or activity logs.

## Outcome policy

| Result | CRM behavior | Operator action |
| --- | --- | --- |
| Approved and status-verified | Reconcile exactly once, allocate, issue receipt, activate fulfillment | Hand receipt to payer |
| Declined/canceled | Record final non-payment result; do not mutate ledger | Use a new request for another card attempt; record another method only if money was actually received |
| Timeout/disconnect/unknown | Keep request pending; record no money | Do not charge again; use **Check terminal status** |
| Reference/amount/environment mismatch | Record review-required event; no ledger mutation | Escalate and compare the exact payment request with provider status |
| Provider outage | Keep request pending; record no money | Retry status after service recovery; never retry Sale blindly |

## Recovery runbook

1. Open Collections and select the exact payment request.
2. If a terminal attempt exists, use **Check terminal status**. Do not create an
   HPP link, record a manual payment, or start another terminal sale while the
   outcome is unknown.
3. If status is still unknown, preserve the request as pending and use its
   correlation ID for support. Correlation IDs are safe; terminal credentials
   and raw provider payloads are not.
4. If the terminal shows an approved transaction but CRM reports a mismatch,
   stop. Do not force-complete the request. Verify reference, amount, UAT/live
   environment, and TPN before replaying status.
5. If credentials may be exposed, enable the external-I/O kill switch, rotate
   the Auth Key in iPOSpays, replace the environment-scoped secret, verify the
   terminal connection in SPIn Proxy troubleshooting, then re-enable I/O only
   after a read-only status check.

## Validation

```bash
npm run test:dejavoo-spin
node --test src/app/api/collections/route.test.js src/app/collections/page.test.js
```

The automated suite uses fixtures only. Live UAT acceptance additionally
requires an online SPIn Cloud-enabled terminal or provider simulator and a
human-present card interaction. Never use production credentials or a real
customer card for staging proof.
