# MIS-409 source-scope implementation — September 11, 2026

This implementation extends the deployed contact workspace candidate with the approved source corrections.

## Visual acceptance contract

MIS-409 uses **faithful selected-board** mode: `01-contact-workspace-v3.png`, `02-focused-editor-v3.png`, and `03-enrollments-workspace.png` are implementation and comparison authority for their named states. Their composition, hierarchy, typography, spacing, flat divider-led sections, underline tabs, identity treatment, editor framing, and enrollment-table density must be retained; fictional board data must not replace truthful product data or supported states.

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
