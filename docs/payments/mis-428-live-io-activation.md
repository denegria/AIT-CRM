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
