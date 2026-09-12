# MIS-409 design acceptance contract — September 12 continuation

## Workflow and problem

AIT USA employees need to manage a person across repeated admissions interest and actual course history without a large Record page or a second manual creation step. The common single-inquiry case must remain immediate; returning students need exact inquiry history without overwriting earlier source, owner, status or placement context.

## Chosen interaction model

Keep the deployed compact two-rail structure: collapsible global icon rail, persistent Contact/current-or-latest-inquiry preview and a wide random-access operational workspace. Activity stays the default. Add one top-level Inquiries list/detail destination; selected inquiry details use compact sections, not nested sub-tabs. AIT USA manual entry remains one combined Contact + Inquiry save.

## Reference classification and visual direction

Reference mode is **inspiration**. The deployed compact staging workspace at `28e02a9` and the owner's September 12 screenshots establish the accepted structure and density direction. The implementation must intentionally increase the current rendering approximately 10–15% and use the available right-side width. Earlier v3 Record artwork is superseded and is not fidelity authority.

Locked visual invariants:

- 64px global icon rail; approximately 232px overlay menu without content reflow;
- approximately 292–304px persistent Contact preview on primary desktop;
- flat, compact surfaces with restrained dividers and no oversized Record composition;
- generally 14–15px body text, meaningful muted labels at least 13px, 22–24px principal headings, approximately 15px tabs and 36–40px common controls;
- Activity, Inquiries, Conversations, Enrollments, Receipts and conditional Work Orders remain one readable tab row when space permits;
- no large unused right gutter at 1440px and above; no CSS zoom/transform or document-wide overflow.

## Locked behavior and data ownership

- Contact owns identity, channels/restrictions, contact source and durable person-level fields.
- Inquiry owns lifecycle, owner, program/preferences, inquiry source and exact placement association.
- Enrollment owns actual course/level participation. Normal course progression does not create inquiries.
- The preview shows the active inquiry, otherwise latest closed; a selector appears only when multiple inquiries exist.
- The preview selector and Inquiries detail share one selected inquiry ID. Editors remain bound to the ID they opened with; dirty edits require explicit discard before selection changes, and saving rechecks authorization and stale state.
- Inquiries list exact permitted lead records and target exact IDs. Multiple-active conflicts block ambiguous writes. Subsequent events in the same sole active cycle reuse that inquiry; genuinely new intent follows the existing active-inquiry policy and never silently creates another active record.
- Placement is a compact inquiry section. AIT USA remains authoritative; CRM exposes only privacy-safe state/level/update and an authorized employee-review link.
- Pipeline **Add inquiry** and Contacts **Add prospective student** share one combined form. Preserve atomic Contact + Opportunity creation and perform identity revalidation under the shared ingestion locking convention. Exact permitted identity attaches a new inquiry after confirmation; ambiguous or inaccessible matches return a generic review result without identity disclosure or insertion. Double-submit and uncertain-response replay are idempotent.
- Reopen remains a permissioned correction with a reason, not a primary creation action.
- Contact and inquiry source saves remain independent. Activity/provenance is not rewritten.
- Follow-up/outreach, Conversations, Enrollment/history, Receipts, conditional Work Orders, archive/request approval, permissions, loading/error states and deep-link return behavior remain reachable.
- AIT Signs is regression-only and retains its existing vocabulary and operational surfaces.

## Non-goals

No Record tab revival, nested inquiry sub-tabs, top-level Placement tab, schema migration, data backfill, provider send, permission expansion, automatic identity merge, production data write, production promotion, AIT Signs redesign or new inquiry for every course level.

## Viewports, content growth and evidence

Primary: 1440×1000 CSS px at 100% zoom. Regression: 1280×900, 1024×768, 768×900 and 390px navigation/overflow smoke. Use fixtures for one/no/multiple/closed/conflicting inquiries, long names/sources, several placement events and multiple enrollment rows. The common one-inquiry state must not gain an extra required click.

Closeout requires render-path tests; focused inquiry/identity/RBAC tests including concurrent identity races, replay, inaccessible exact matches, same-cycle active-inquiry reuse and stale selected-inquiry writes; full validation; independent visual review; matching-viewport staging screenshots; exact deployment/CI identity; authenticated role coverage; residual differences; and explicit production untouched status.
