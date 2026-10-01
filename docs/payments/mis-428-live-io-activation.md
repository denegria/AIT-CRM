# MIS-428 production HPP activation and penny smoke

This Git-triggered release reloads AIT CRM Production with the production-only
`DEJAVOO_PRODUCTION_IO_ENABLED=true` Vercel setting. It does not change code,
schema, public prices, or provider secrets. The five `DEJAVOO_PROD_*` HPP
settings were already installed. UAT/Preview keeps its separate sandbox setup.

## Controlled first transaction

1. Confirm the Production deployment is Ready at this commit and the public
   Dejavoo callback rejects an invalid credential with HTTP 401.
2. In the AIT USA Collections scope, select the Contact created from the live
   orientation form. Create one **account-credit** payment request for **$0.01**,
   with that Contact as student and payer and a QA note. Do not modify course
   catalog prices or create a registration to manufacture the test amount.
3. Create one secure Dejavoo Hosted Payment Page link. The named payer enters
   their own card on the provider page. Do not handle or store card details.
4. Check provider outcome, callback delivery, payment-request state, one
   verified provider transaction, one unapplied $0.01 credit, and receipt.
   A return redirect alone is not proof of payment. Do not retry an ambiguous
   HPP creation or charge without reconciliation.
5. Leave the penny as unapplied credit pending an explicit accounting decision.
   This smoke does not prove public registration, placement, enrollment, or
   fulfillment; those stay on the separate production QA checklist.

## Rollback

If the callback or reconciliation path fails, disable/remove only the
Production `DEJAVOO_PRODUCTION_IO_ENABLED` setting and trigger a new reviewed
Git build to load it. Preserve payment/provider records for reconciliation;
do not delete or overwrite them. Use the existing `AIT_CRM_EXTERNAL_IO_DISABLED`
kill switch only if the wider outbound-payment path must be stopped.

## 2026-10-01 attempted activation and rollback

- The Production-only flag loaded in the Ready deployment at `ac45319`.
- One staff account-credit request for $0.01 was created for the confirmed
  live-site Contact. The first HPP-link creation returned HTTP 502. CRM recorded
  `DEJAVOO_AUTHENTICATION_FAILED` and an **uncertain** hosted attempt; no
  checkout URL was returned and no card was entered. The adapter's stored
  error does not distinguish token authentication from HPP endpoint rejection.
- Do not retry this payment request or create another HPP link until the live
  credential/merchant authorization boundary is diagnosed and the original
  merchant reference is reconciled with Dejavoo.
- The Production-only enable flag was removed in Vercel. This subsequent Git
  build reloads the fail-closed configuration. The financial record remains
  intact for investigation; neither UAT nor other provider settings changed.

## 2026-10-01 controlled retry after live credential reload

- Alvaro re-entered the four production Dejavoo values in Vercel and redeployed
  the unchanged CRM commit. The new Production deployment is Ready. The four
  `DEJAVOO_PROD_*` credentials and callback authorization header are scoped to
  Production; the live-I/O flag remains absent until this controlled activation.
- The original $0.01 account-credit request remains `pending` with an
  `uncertain` hosted attempt. CRM has no verified provider transaction for the
  Contact. No HPP URL was returned and no card was entered. A read-only provider
  lookup did not conclusively reconcile the old reference. Preserve that
  request, and do not retry it: the service deliberately rejects a second link
  attempt on the same request.
- Alvaro explicitly requested one retry with the newly loaded production keys
  and cannot access the provider portal. Use a **new, separately traceable**
  $0.01 account-credit request for the same Contact, with a QA note and a new
  idempotency key. Make one HPP creation call only. If no valid checkout URL is
  returned, stop, record the result, and disable live I/O again. If a URL is
  returned, give it privately to Alvaro for human card entry; no automated
  card submission. Verify provider status and CRM reconciliation before
  claiming payment success.

### Retry result and fail-closed rollback

- CRM Production loaded the flag in the Ready `fceff50` deployment after green
  staging and production CI. A new, separate $0.01 account-credit request was
  created for the same Contact: `7550d242-812f-4da7-915d-fd4e442aea5a`,
  merchant reference `PAY_D84AB6DBD96CA35603A6DA4EC8DF`. The original
  uncertain request was not reused.
- Exactly one hosted-link attempt for the new request returned HTTP 502 with
  `DEJAVOO_PROVIDER_REJECTED`. No checkout URL was returned; no card was
  entered. This differs from the first attempt's authentication error but does
  not identify whether token authentication or HPP payload/merchant validation
  produced the rejection. Do not retry the second request.
- Remove the Production-only live-I/O flag and trigger a reviewed Git build to
  reload fail-closed configuration. Preserve both financial requests and all
  provider evidence. Determine the provider's specific response/status at the
  outbound stage before another HPP creation attempt.

## 2026-10-01 $1.00 diagnostic attempt and rollback

- Alvaro authorized a new $1.00 attempt. The reviewed `c9a29a5` release added
  bounded provider diagnostics to hosted-attempt metadata without storing raw
  provider payloads, secrets, card data, or checkout URLs. Staging and Production
  CI passed, and both deployments were Ready before the Production call.
- A new account-credit request for the same Contact was created:
  `4ef23e7e-dcef-47f5-955e-0746592c885e`, merchant reference
  `PAY_5C02B629CF9E98C6E49BC58DEA89`. Exactly one HPP creation call returned
  CRM HTTP 502 with `DEJAVOO_PROVIDER_REJECTED`; no checkout URL or card entry.
- The saved Dejavoo diagnostic identifies the actual boundary: HPP-stage HTTP
  400, `merchantAuthentication.transactionReferenceId` —
  `Invalid transaction reference id`. This $1.00 rejection rules out a one-cent
  minimum as the cause of this attempt. The reference format must be corrected
  and validated before any further live link creation. Preserve all three
  payment requests; do not retry an existing request.
- The Production-only live-I/O flag was removed in Vercel. This Git-triggered
  build reloads fail-closed configuration; verify deployment Ready, CI green,
  and the public auth/callback safeguards before closing the incident window.

## 2026-10-01 $1.00 hyphenated-reference retest and rollback

- Alvaro approved promoting staged commit `9d25244` and one new $1.00 hosted
  link attempt. Production CI passed, deployment was Ready, and the public
  session/Collections/invalid-callback safeguards returned 200/401/401.
- New account-credit request `b8876f4e-7b80-437b-9f7d-367dad77bb28` used
  merchant reference `PAY-93EA247C37FD3484311E83DFAAC7`. Exactly one hosted
  link call returned CRM HTTP 502 / `DEJAVOO_PROVIDER_REJECTED`, with no
  checkout URL or card entry. Saved Dejavoo diagnostic: HPP-stage HTTP 400,
  `merchantAuthentication.transactionReferenceId` —
  `invalid transaction reference id`.
- The hyphen-only hypothesis is disproven. Do not retry this or the three older
  uncertain requests, and do not infer that reference characters are the sole
  problem. Ask Dejavoo to inspect both rejected $1 references and confirm the
  live HPP transaction-reference contract and merchant/TPN binding before any
  further provider call.
- The Production-only live-I/O flag was removed. Revert the speculative `PAY-`
  / `PORTAL-` generators and HPP underscore guard while keeping safe provider
  diagnostics. This Git-triggered build must be verified Ready with green CI
  and public auth/callback safeguards before closeout.
