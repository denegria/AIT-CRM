# MIS-409 source-scope implementation — September 11, 2026

This implementation extends the deployed contact workspace candidate with the approved source corrections.

## Contract delivered

- Missing bootstrap attribution no longer falls back to rotating fixture/sample source labels.
- `contactSource` writes only `contacts.sourceLabel`, including for legacy contacts without an inquiry.
- `inquirySource` writes only the exact selected lead's `sourceName`; multiple-active and stale/unauthorized opportunity checks remain server-owned.
- AIT USA's legacy ambiguous `source` request is treated as contact-only for safety. AIT Signs retains its established `source` compatibility path.
- Explicitly cleared inquiry source is persisted as an empty editable value so technical ingestion provenance is not silently reintroduced. Rows that predate editable source attribution (`sourceName IS NULL`) may still expose their stored `sourceType` as legacy read evidence.
- Original submission/import events and technical `sourceType`/source-key provenance are not rewritten. No schema migration, data backfill, artificial inquiry creation or CRM data write is included.

## Verification scope

Focused tests cover contact-only and inquiry-only draft serialization, omission versus clear, no-inquiry legacy contacts, corrected-vs-technical source precedence, and multiple/closed inquiry bootstrap selection. The full repository validation remains the acceptance gate; authenticated staging QA and deployment are handled by the parent lane.
