# MIS-390 Design Acceptance Contract

## Workflow model

- The existing Dashboard and Tasks controls remain the only generic task-edit entry points.
- Each generic mutation carries the `updatedAt` value loaded with that exact task.
- A current edit succeeds once and returns the next task version.
- A stale edit changes nothing and asks the employee to refresh before retrying.
- Exact follow-up completion and cancellation approval keep their existing workflows.

## Interaction and hierarchy

- No new control, dialog, queue, or task framework is introduced.
- Current edits preserve the existing pending, success, and saved states.
- A stale inline edit remains open and renders `This task changed. Refresh the queue and try again.` through the existing error region.
- Dashboard completion remains reload-backed; a rejected stale completion stays open and visible.

## Responsive acceptance

- Desktop basis: 1440 x 900.
- Mobile basis: 390 x 844.
- Existing task cards, inline edit fields, and completion controls must not change size or produce new overflow.

## Accessibility and states

- Existing pending controls remain disabled and expose their current busy status.
- Existing inline error regions continue to announce rejected updates.
- The server returns structured `task_version_required` and `task_stale_write` errors; client text tells the employee to refresh.
- A stale update emits no task event or activity event.

## Non-goals

- New task entities, version columns, or migrations.
- Changes to follow-up outcome logging or next-follow-up creation.
- Changes to cancellation or removal-approval policy.
- Recovery Queue v1.

# AIT CRM Facebook + Assignment Hotfix Acceptance Contract

## Workflow and permissions

- A regular AIT USA Coordinator can edit records already assigned to them, but cannot assign, reassign, or unassign ownership from the UI, direct API calls, or bulk actions.
- A Senior Coordinator or administrator can continue assigning AIT USA Opportunities to eligible regular Coordinators.
- An active Senior Coordinator who belongs to AIT USA can additionally assign an AIT USA Opportunity to themself; that exception does not make other Senior Coordinators, administrators, or Sales Managers eligible assignees.
- Existing ownership-change audit behavior remains intact.

## Interaction and hierarchy

- The current Senior Coordinator appears in AIT USA owner selects as `<Name> (You)`.
- Existing eligible regular Coordinator options remain unchanged.
- Existing legacy owners stay visible while editing their record so the form does not silently discard historical state.
- Contacts and Pipeline filters present `Facebook Lead Ads` and `Facebook Messenger` as separate source choices.
- AIT USA source details identify Facebook Lead Ads as a `Lead form ad`.

## Responsive and accessibility acceptance

- Desktop basis: 1440 x 900. Mobile basis: 390 x 844.
- Existing native select behavior, labels, focus order, and error regions remain unchanged.
- No new modal, warning banner, or horizontal overflow is introduced.

## Non-goals

- Meta token replacement or Meta application configuration changes.
- Automated replay, repair, or deduplication of the 65 preserved failed submissions.
- A new ingestion-degradation warning surface.
- A broader assignment-policy redesign or changes to non-AIT-USA assignment rules.

# MIS-418 Book Fulfillment Acceptance Contract

## Workflow and problem

- A verified $95 registration/book bundle creates one durable fulfillment record that staff can work without reading payment metadata.
- The authoritative policy is fixed: United States in-person students pick up the physical book; United States online students receive digital access and a shipped physical book; students outside the United States receive digital fulfillment.
- The operational worklist exposes paid bundles that still need digital delivery, pickup preparation/completion, or shipment. It is not a generic task inbox and does not move money.

## Interaction model

- `/fulfillment` is a dedicated AIT USA worklist with three action lanes: Digital delivery, Pickup, and Shipment.
- A United States online registration can appear in both Digital delivery and Shipment until both obligations are complete; it remains one fulfillment record.
- Staff may claim an item, add an operational note, mark a pickup ready or picked up, record a shipment with carrier/tracking, or mark digital access delivered.
- The registration-derived fulfillment mode is immutable in the worklist. Staff transitions progress the obligation but cannot silently change pickup, shipment, or digital policy.

## Visual direction and hierarchy

- Product-native CRM styling: compact operational cards, lane counts first, student and age second, then owner/progress and the single next action.
- Shipping addresses appear only inside shipment items and are never rendered in digital or pickup lanes.
- Pending, stale, empty, denied, and mutation-error states remain explicit. Successful mutations refresh the canonical server state.

## Locked behavior, permissions, and state

- Queue reads require CRM access and organization/business-unit scope. Mutations additionally require CRM write access.
- Address snapshots are returned only for authorized shipment-lane reads and are excluded from logs, analytics, URLs, activity messages, and provider/payment payloads.
- Duplicate registrations or callbacks produce at most one fulfillment record per payment request.
- Payment verification activates fulfillment work. Fulfillment-transition failure must not regress or roll back verified payment state.
- Overall completion is derived only when every required digital and physical component is complete.

## Responsive acceptance

- Primary desktop viewport: 1440 x 900. Regression viewport: 390 x 844.
- Lane navigation may scroll horizontally on narrow screens; work cards stack actions below content without horizontal page overflow.
- Long student names, notes, carrier names, tracking references, and address lines wrap or truncate inside the card instead of changing the page width.

## Content growth assumptions

- Lane counts may reach four digits.
- Notes may contain several sentences; the list shows bounded content while preserving the full server value for editing.
- Tracking and address values are treated as untrusted text and rendered as text only.

## Required evidence

- Policy-matrix, idempotency, transition, privacy, and permission tests.
- Full repository tests, lint, and both production builds in the warm lane.
- Rollback-only staging database proof followed by the additive migration, then authenticated staging walkthrough at desktop and mobile widths.

## Non-goals

- Changing the $95 bundle price, tax treatment, payment ledger, or Dejavoo contract.
- Customer-facing registration or portal UI; those remain MIS-421 and MIS-420.
- Shipping-label purchasing, carrier APIs, inventory management, email delivery, or automated fulfillment messages.
- Production deployment or production data writes.

# MIS-419 Staff Checkout and Collections Acceptance Contract

## Workflow and problem

- `/collections` is the AIT USA staff desk for creating a registration checkout and working balances after the request exists. It does not replace the financial-document archive.
- Due, partially paid, and overdue are derived from exact verified allocations and the immutable original due date. A partial payment never extends or rewrites that date.
- Student, payer, enrollment, charge, payment request, transaction, receipt, and fulfillment remain visibly separate records.

## Interaction model

- The primary surface is a queue-detail workspace: balance lanes and search on the left, the selected student's complete commerce trail and next action on the right.
- New checkout is a guided inline composer using the approved server-side catalog. It supports an existing or identity-matched student, a separate payer, section assignment, the locked fulfillment policy, and optional regional tuition prepayment.
- A hosted payment URL is revealed once after an explicit action. CRM persists only the safe provider origin and correlation identifier—not the URL token or card data.
- Manual payments accept only non-card methods and require auditable method, actor, amount, and reference metadata. They share ledger allocation and receipt invariants with verified provider payments without pretending to be Dejavoo.

## Locked behavior and safety

- Reads require financial read access; all checkout, hosted-link, and manual-payment writes require financial write access plus exact AIT USA scope.
- Hosted-link creation never retries automatically. A started, created, or uncertain attempt blocks another provider request until reviewed.
- Duplicate checkout and manual-payment submissions are idempotent. A replay cannot create a second payment request, provider transaction, allocation, or receipt.
- United States in-person students use pickup; United States online students use shipment plus digital delivery; students outside the United States use digital delivery.
- Production provider execution remains fail-closed and production is outside this slice.

## Responsive and state acceptance

- Desktop basis: 1440 x 900. Mobile basis: 390 x 844.
- On mobile, lanes scroll horizontally, the queue precedes detail, forms collapse to one column, and no payment reference or long student identity creates page overflow.
- Loading, empty, denied, provider-uncertain, stale, validation, and mutation failure states are explicit. Successful writes refresh canonical server state.

## Required evidence

- RBAC, queue derivation, exact-money, duplicate/retry, manual-payment, receipt, hosted-link redaction, and registration/ledger regression tests.
- Full repository tests, lint, Turbopack build, and webpack build in the warm lane.
- Authenticated staging walkthrough for desktop and mobile with synthetic data removed afterward.

## Non-goals

- Customer-facing registration or portal payment UI.
- Card entry, terminal integration, refunds, payment-plan scheduling, collections messaging automation, or production deployment.
