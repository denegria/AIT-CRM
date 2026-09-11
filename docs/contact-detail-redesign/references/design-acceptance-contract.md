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

Primary viewport: 1440×1000 CSS px. Regression: compact desktop (1024×768), bounded narrow layout (768×900), and keyboard tab navigation. Required closeout evidence is focused static/render-contract coverage plus local browser QA where the environment permits; fixture evidence is distinct from authenticated staging evidence.
