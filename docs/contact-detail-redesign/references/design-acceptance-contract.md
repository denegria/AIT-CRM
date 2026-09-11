# MIS-409 S1 design acceptance contract

## Workflow and interaction model

AIT USA coordinators need one readable contact workspace: identify the person once, see the next available work without a second profile summary, and maintain each operational resource directly in its tab. The selected model is a compact identity header, a next-work band, and random-access tabs. `Record` is the default overview; Activity, Conversations, Enrollments, Receipts, and conditionally applicable Work Orders retain their existing working surfaces and actions.

## Direction and invariants

Reference mode is **inspiration**. The fictional v3 boards govern the white/navy/blue visual language, restrained dividers, compact desktop density, one identity header, one local tab row, and direct in-tab operations. Production data, authorization, route state, and existing forms remain authoritative.

- Header has one identity and one `Edit contact` action.
- Record has `Contact & preferences` and one resolved inquiry state: Current inquiry, Last inquiry (closed), quiet no-active inquiry, or explicit conflict.
- Contact and inquiry source values are displayed separately only when the existing payload supplies distinct values; S1 does not claim the legacy coupled save is independent.
- No repeated profile sidebar, review grid, gateway-only resource links, fabricated student badge/history, or forced inquiry creation.
- AIT Signs keeps its current people, financial, and work-order vocabulary and surfaces.

## Locked behavior and non-goals

Existing IDs, route/query context, permissions, dirty/error state, archive flow, lifecycle reasons, and current forms remain unchanged. S1 does not change server semantics, source write scope, schema, migrations, or test data; scoped editor replacements are S3 work.

## Viewports and evidence

Primary viewport: 1440×1000 CSS px. Regression: compact desktop (1024×768), bounded narrow layout (768×900), and keyboard tab navigation. Required closeout evidence includes focused rendering and real loader-payload selection coverage, plus authenticated staging browser QA. Local fixture evidence is useful but does not replace authenticated staging acceptance.

## Director review corrections

- `hasLeadStatus` means a selected record exists, not that it is active. Closed-only history is labeled Last inquiry (closed); conflict wins over all other states. Existing history editing remains reachable through the shared form.
- Change owner observes the existing assignment policy; general CRM write access alone is insufficient.
- Keep one header Edit contact action, not a duplicate in the contact section.
- Read learning/student locations through the canonical helpers, including legacy address fallback for student location.
- The new Inquiry source display does not use the legacy loader's generic source fallback, which can contain a sample label. Removing that loader fallback globally remains the later source-fix slice.
- The next-work fallback says No next action recorded; it does not assert there are no scheduled tasks without querying them.
- Existing shared form sections and coupled source writes remain S1 limitations, not independent contact/inquiry mutation semantics. Scoped editors follow in S3.
- Inquiry Edit opens General, where lifecycle and ownership live. The retained form is explicitly titled Edit contact & inquiry until S3 separates its saves.
- Legacy/no-selected-inquiry and conflict records retain assigned coordinator and student location in Contact & preferences. Permission-gated cleanup provenance remains available as a collapsed Record disclosure.
