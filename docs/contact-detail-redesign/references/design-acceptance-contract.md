# MIS-409 S1 design acceptance contract

## Workflow and interaction model

AIT USA coordinators need one readable contact workspace: identify the person once, see the next available work without a second profile summary, and maintain each operational resource directly in its tab. The selected model is a compact identity header, a next-work band, and random-access tabs. `Record` is the default overview; Activity, Conversations, Enrollments, Receipts, and conditionally applicable Work Orders retain their existing working surfaces and actions.

## Direction and invariants

Reference mode is **inspiration**. The fictional v3 boards govern the white/navy/blue visual language, restrained dividers, compact desktop density, one identity header, one local tab row, and direct in-tab operations. Production data, authorization, route state, and existing forms remain authoritative.

- Header has one identity and one `Edit contact` action.
- Record has `Contact & preferences` and one resolved inquiry state: Current inquiry, Last inquiry (closed), quiet no-active inquiry, or explicit conflict.
- Contact and inquiry source values are displayed and saved through explicit entity scopes. Contact source uses `contacts.sourceLabel`; inquiry source uses the selected lead's editable `sourceName`. Technical `sourceType` remains provenance and is only a legacy read fallback when `sourceName` was never specified.
- No repeated profile sidebar, review grid, gateway-only resource links, fabricated student badge/history, or forced inquiry creation.
- AIT Signs keeps its current people, financial, and work-order vocabulary and surfaces.

## Locked behavior and non-goals

Existing IDs, route/query context, permissions, dirty/error state, archive flow, lifecycle reasons, and current forms remain unchanged. The source-scope extension adds named request fields without a schema migration or data backfill; all other scoped editor replacements remain later work.

## Viewports and evidence

Primary viewport: 1440×1000 CSS px. Regression: compact desktop (1024×768), bounded narrow layout (768×900), and keyboard tab navigation. Required closeout evidence includes focused rendering and real loader-payload selection coverage, plus authenticated staging browser QA. Local fixture evidence is useful but does not replace authenticated staging acceptance.

## Director review corrections

- `hasLeadStatus` means a selected record exists, not that it is active. Closed-only history is labeled Last inquiry (closed); conflict wins over all other states. Existing history editing remains reachable through the shared form.
- Change owner observes the existing assignment policy; general CRM write access alone is insufficient.
- Keep one header Edit contact action, not a duplicate in the contact section.
- Read learning/student locations through the canonical helpers, including legacy address fallback for student location.
- Missing attribution is not replaced with a sample label. An explicitly cleared editable source remains unknown; legacy rows with no editable `sourceName` may still display their stored technical source provenance.
- The next-work fallback says No next action recorded; it does not assert there are no scheduled tasks without querying them.
- Contact and inquiry source saves are independently scoped in S1. Contact-only saves cannot mutate inquiry fields; inquiry-only saves cannot mutate contact source. Inquiry Edit opens the inquiry-scoped form, where lifecycle, ownership and inquiry source live.
- Legacy/no-selected-inquiry and conflict records retain assigned coordinator and student location in Contact & preferences. Permission-gated cleanup provenance remains available as a collapsed Record disclosure.
