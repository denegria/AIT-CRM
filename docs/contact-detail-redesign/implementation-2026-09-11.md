# MIS-409 source-scope implementation — September 11, 2026

This implementation extends the deployed contact workspace candidate with the approved source corrections.

## Visual acceptance contract at delivery

This source-scope slice originally used the selected v3 boards for the named editor and enrollment states. That visual authority was superseded on September 11 by the deployed compact two-rail revision and on September 12 by the continuation contract in `references/design-acceptance-contract.md`. The old Record composition must not be reintroduced.

## Contract delivered

- Missing bootstrap attribution no longer falls back to rotating fixture/sample source labels.
- `contactSource` writes only `contacts.sourceLabel`, including for legacy contacts without an inquiry.
- `inquirySource` writes only the exact selected lead's `sourceName`; multiple-active and stale/unauthorized opportunity checks remain server-owned.
- AIT USA's legacy ambiguous `source` request is treated as contact-only for safety. AIT Signs retains its established `source` compatibility path.
- Explicitly cleared inquiry source is persisted as an empty editable value so technical ingestion provenance is not silently reintroduced. Rows that predate editable source attribution (`sourceName IS NULL`) may still expose their stored `sourceType` as legacy read evidence.
- Original submission/import events and technical `sourceType`/source-key provenance are not rewritten. No schema migration, data backfill, artificial inquiry creation or CRM data write is included.

## Verification scope

Focused tests cover contact-only and inquiry-only draft serialization, omission versus clear, no-inquiry legacy contacts, corrected-vs-technical source precedence, and multiple/closed inquiry bootstrap selection. The full repository validation remains the acceptance gate; authenticated staging QA and deployment are handled by the parent lane.

## Independent acceptance corrections

- Wrapped Contact edit click handlers so React click events cannot become an editor scope.
- Save responses now refresh the legacy `sourceLabel` display alias alongside `contactSource`, including explicit clears; opening the editor preserves empty values rather than falling back to stale attribution.
- Added four direct PATCH-route checks for isolated contact/inquiry corrections and clears; inquiry writes exercise the selected-opportunity locked writer and leave technical provenance unchanged.
- Live staging browser access was restored by the owner's senior-coordinator login. Source changes require verification on the new deployment; regular-role live coverage and persisted live save/reload checks must not be inferred from read-only UI checks.

## September 12 continuation status

The source-scope corrections above and compact workspace revision are present on staging head `28e02a9` (compact implementation `d303e58`). GitHub CI and the Vercel deployment completed successfully. Authenticated acceptance and the correction loop were interrupted before closeout, so MIS-409 remains In Progress and production remains untouched.

Alvaro subsequently approved the governing continuation in `compact-preview-revision-2026-09-11.md`:

1. increase the compact workspace scale and usable width;
2. add the exact role-scoped Inquiries list/detail surface and inquiry-owned placement summary;
3. specialize AIT USA manual entry as one **Add inquiry** / **Add prospective student** save with safe exact-identity reuse and ambiguous-match review;
4. preserve every existing operational workflow and treat AIT Signs only as a shared-component regression gate;
5. validate, independently review, deploy to staging and complete authenticated browser QA before requesting any production promotion.

This continuation was specified but not implemented at the time of this documentation sync. It authorizes no schema migration, CRM data write, provider send or production deployment.
