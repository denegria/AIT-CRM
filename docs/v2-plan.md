# AIT CRM V2 Plan

V2 should make AIT CRM the system that reliably drives follow-up. The money feature is WhatsApp/Messenger-powered follow-up, but it needs a clean CRM control plane underneath it: ownership, status, permissions, tasks, timeline, opt-out state, and auditability.

## Decision

Build V2 with a short architecture-prep lane, then two connected product milestones:

1. **V2 Prep:** extract reusable V1 mechanics that V2 will depend on, without changing product behavior.
2. **V2.0 Ops Core:** make the CRM operationally trustworthy for assignment, follow-up, reporting, and admin control.
3. **V2.1 Comms Engine:** add WhatsApp and Messenger as first-class conversation/follow-up channels on top of the shared CRM workflow state.

Do not create a separate V2 social-monitoring phase. WhatsApp and Messenger should absorb inbound replies, outbound follow-up, conversation history, and agent-assisted triage for V2. Broader social monitoring outside this lane is V3.

## Current Baseline

V1/V1.1 has:

- Postgres-backed organizations, business units, users, roles, permissions, memberships, contacts, leads, work orders, notes, activity events, files metadata, and import review tables.
- Auth/session and server-owned RBAC foundations.
- Website lead ingestion through /api/webhooks/website-leads.
- Facebook Lead Ads and Page Messenger event handling through /api/webhooks/facebook-leads.
- AIT USA Wix ingestion proven end-to-end.
- AIT Signs import review and promotion workflow.
- V1 handoff/runbook docs and production validation scripts.

Known constraints:

- File/attachment storage is blocked until an R2/S3-compatible bucket and env/access posture are approved.
- WordPress/Divi ingestion replacement remains deferred.
- WhatsApp/Messenger outbound sending must respect Meta policy, template approval, 24-hour messaging windows, consent, opt-out, and rate/failure handling.
- Several V1 routes intentionally shipped fast and now contain reusable mechanics that should be extracted before V2 builds on them: webhook/provider adapters, import-review operations, business-unit access helpers, and multi-write CRM mutation patterns.

## V2 Goals

- Operators can see exactly who owns each lead/contact and what should happen next.
- Follow-up work is queryable, assignable, due-date driven, and visible across dashboard, contacts, and contact detail.
- Every important action lands on the contact timeline.
- WhatsApp and Messenger conversations are linked to contacts/leads and visible in the CRM.
- Automated sequences can create/schedule/send follow-ups with guardrails.
- Agent assistance suggests classification, summaries, next actions, and reply drafts without silently overriding humans.
- Managers can see stale leads, overdue follow-ups, unassigned work, response time, and conversion performance.

## V2 Non-Goals

- No broad social listening across LinkedIn/TikTok/X/etc. in V2.
- No browser-login scraping of social accounts.
- No QuickBooks replacement.
- No custom accounting ledger.
- No uncontrolled outbound messaging before templates, opt-out, quiet hours, owner routing, and audit trail exist.
- No WordPress/Divi form rescue unless explicitly reprioritized.

## Architecture Direction

Keep the same action/service split:

- Routes/actions own auth, permissions, organization/business-unit scoping, domain rules, state transitions, and user-facing errors.
- Services own reusable mechanics and provider boundaries, such as Meta Graph, WhatsApp Cloud API, message normalization, sequence scheduling, and delivery result parsing.
- Services must expose composable capability blocks with explicit inputs and structured outputs. Avoid god services such as a single messaging service that validates policy, mutates CRM state, calls providers, and classifies errors all at once.
- Extract services when mechanics repeat across 2+ callers or cross a provider/SDK boundary. Keep one-off domain rules in the action/route until repetition proves the need.

Recommended new internal modules:

- src/lib/crm/* for shared access, scoping, payload, activity, and transactional CRM write mechanics.
- src/lib/import-review/* for shared API/CLI import-review mechanics.
- src/lib/ingestion/* for provider-neutral inbound lead/import mechanics.
- src/lib/tasks/* for task/follow-up mechanics.
- src/lib/conversations/* for provider-neutral conversation/message mechanics.
- src/lib/messaging/providers/* for WhatsApp and Messenger adapters.
- src/lib/automation/* for follow-up sequence scheduling and idempotent job execution.

Do not scale the current one-shot bootstrap/client-state pattern into V2 tasks, timelines, and conversations. V2 read models should have explicit API/service contracts so follow-up queues and conversations can grow without loading the whole CRM state blob.

Recommended background execution:

- Start with Postgres-backed scheduled jobs plus Vercel Cron for the first automation MVP.
- Keep every job idempotent with explicit status transitions and provider message IDs.
- Re-evaluate Trigger.dev before complex branching sequences, heavy retry needs, or higher message volume.

## Linear Issue Format

Keep V2 issues consistent with the V1 Linear pattern:

- Title prefix: [AIT CRM V2.0] or [AIT CRM V2.1].
- Description sections: Context, Objective, Scope, Action/service boundary, Acceptance criteria, Validation, Dependencies/blocked.
- Use the existing Mission Control labels:
  - Feature or Improvement.
  - Needs Full Model or Model: 5.4 Mini OK.
  - Complexity: Mini, Complexity: Standard, Complexity: Complex, or Complexity: High Risk.
- Use priority to reflect delivery order and risk:
  - High: required for the V2 spine or security/compliance-sensitive.
  - Medium: important but can follow the spine.
  - Low: blocked, docs-only, or optional polish.
- Owner lane is planning metadata, not necessarily a Linear label:
  - Builder: implementation.
  - Sentry: QA/verification.
  - Giuseppe: planning/review/external setup.
  - Titan/Security: optional second-pass for auth, permissions, provider secrets, or outbound-message safety.

## Issue Label Index

- V2-PRE-001 Shared CRM Access Helpers: Priority High; labels Improvement, Needs Full Model, Complexity: Standard; owner lane Builder.
- V2-PRE-002 Transactional CRM Write Helpers: Priority High; labels Improvement, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-PRE-003 Import Review Service Parity: Priority High; labels Improvement, Needs Full Model, Complexity: Standard; owner lane Builder.
- V2-PRE-004 Website Lead Ingestion Service: Priority High; labels Improvement, Needs Full Model, Complexity: Complex; owner lane Builder plus Sentry review.
- V2-PRE-005 Meta Webhook And Graph Client Adapter: Priority High; labels Improvement, Needs Full Model, Complexity: High Risk; owner lane Builder plus Sentry/Titan review.
- V2-PRE-006 Facebook Lead Ads Ingestion Service: Priority High; labels Improvement, Needs Full Model, Complexity: Complex; owner lane Builder plus Sentry review.
- V2-PRE-007 Messenger Inbound Ingestion Service: Priority High; labels Improvement, Needs Full Model, Complexity: Complex; owner lane Builder plus Sentry review.
- V2-001 Task And Follow-Up Schema: Priority High; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-002 Task Service And API: Priority High; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-003 Follow-Up Queue UI: Priority High; labels Feature, Needs Full Model, Complexity: Standard; owner lane Builder.
- V2-004 Contact Detail Timeline Upgrade: Priority High; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-005 Ownership And Assignment Rules: Priority High; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-006 Lifecycle Status Hardening: Priority Medium; labels Improvement, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-007 Product Admin For Users, Roles, And Business Units: Priority High; labels Feature, Needs Full Model, Complexity: High Risk; owner lane Builder plus Sentry/Titan review.
- V2-008 Custom Fields MVP: Priority Medium; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-009 Manager Reporting MVP: Priority Medium; labels Feature, Needs Full Model, Complexity: Standard; owner lane Builder.
- V2-010 Attachments MVP: Priority Medium while blocked; labels Feature, Needs Full Model, Complexity: High Risk; owner lane Builder plus Sentry/Titan review.
- V2-011 Provider-Neutral Conversation Schema: Priority High; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-012 Conversation UI On Contact Detail: Priority Medium; labels Feature, Needs Full Model, Complexity: Standard; owner lane Builder.
- V2-013 Messenger Inbound Upgrade: Priority High; labels Feature, Needs Full Model, Complexity: High Risk; owner lane Builder plus Sentry/Titan review.
- V2-014 WhatsApp Inbound Webhook: Priority High; labels Feature, Needs Full Model, Complexity: High Risk; owner lane Builder plus Sentry/Titan review.
- V2-015 Message Template Registry: Priority High; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder.
- V2-016 Manual Outbound Sending With Approval Guardrails: Priority High; labels Feature, Needs Full Model, Complexity: High Risk; owner lane Builder plus Sentry/Titan review.
- V2-017 Follow-Up Sequence MVP: Priority High; labels Feature, Needs Full Model, Complexity: High Risk; owner lane Builder plus Sentry/Titan review.
- V2-018 Agent Triage And Draft Replies: Priority Medium; labels Feature, Needs Full Model, Complexity: Complex; owner lane Builder plus Sentry review.
- V2-019 Comms Observability And Runbook: Priority Medium; labels Improvement, Needs Full Model, Complexity: Standard; owner lane Builder/Sentry/Giuseppe.

## V2 Prep Architecture Slices

These slices should preserve V1 behavior while making the codebase easier to review and reuse. They are intentionally split by boundary instead of grouped into one refactor ticket.

### V2-PRE-001: Shared CRM Access Helpers

Linear metadata:

- Title: [AIT CRM V2 Prep] Shared CRM access helpers
- Priority: High
- Labels: Improvement, Needs Full Model, Complexity: Standard
- Owner lane: Builder
- Dependencies: none

Objective: centralize repeated organization, business-unit, UUID, and access helper mechanics used by CRM routes.

Scope:

- Add focused helpers under src/lib/crm/* for UUID validation, business-unit access checks, business-unit resolution, contact access checks, and common CRM payload conversion where it is duplicated.
- Update contacts, work-orders, bootstrap, and business-unit routes only where helpers remove current duplication.
- Preserve route-owned permission checks and user-facing error wording.

Action/service boundary:

- Routes keep auth, permission choice, operation intent, and response status.
- Helpers provide reusable mechanics with explicit session, organization, and business-unit inputs; they must not read request/session globals.

Acceptance:

- Existing CRM APIs keep the same success/error behavior.
- V2 task/conversation slices can reuse the same access helpers without importing route files.
- No helper silently widens business-unit access.

Validation:

- npm run lint
- npm run build
- npm run verify:rbac when database env is available

### V2-PRE-002: Transactional CRM Write Helpers

Linear metadata:

- Title: [AIT CRM V2 Prep] Transactional CRM write helpers
- Priority: High
- Labels: Improvement, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-PRE-001 preferred

Objective: make existing multi-write CRM mutations atomic and reusable before automation starts writing follow-up state.

Scope:

- Introduce focused write helpers for common CRM mutations such as create contact with lead, update contact with lead/note changes, create/update/delete work order with activity event, and business-unit change with activity event.
- Wrap current multi-write operations in transactions where partial writes would leave inconsistent CRM state.
- Keep payloads and event messages compatible with V1.

Action/service boundary:

- Routes decide whether the current user can perform the mutation and which transition is allowed.
- Write helpers own the actual grouped database operations and return structured rows/results.

Acceptance:

- A failed secondary write rolls back the full related mutation.
- Activity events remain present for the same user-visible actions.
- No new broad service decides permissions on behalf of routes.

Validation:

- npm run lint
- npm run build
- focused failure-path tests or a documented local transaction smoke

### V2-PRE-003: Import Review Service Parity

Linear metadata:

- Title: [AIT CRM V2 Prep] Import review service parity
- Priority: High
- Labels: Improvement, Needs Full Model, Complexity: Standard
- Owner lane: Builder
- Dependencies: none

Objective: make the import-review UI/API and CLI use the same batch selection, row loading, and status-update mechanics.

Scope:

- Extract import-review mechanics from src/app/api/import-review/route.js and scripts/review-ait-signs-staging.mjs into src/lib/import-review/*.
- Align batch resolution rules so operator review batches and pending/needs_review rows are handled consistently.
- Keep both API record-id updates and CLI sheet/row updates, but route them through one shared service contract.

Action/service boundary:

- API route owns auth/RBAC/admin-token compatibility and HTTP responses.
- CLI owns command parsing/output.
- Import-review service owns batch resolution, summary loading, row loading, and status updates.

Acceptance:

- API and CLI summaries return equivalent counts for the same batch.
- Approve/reject through CLI and API update normalized records and review items consistently.
- Existing V1 operator commands continue to work.

Validation:

- npm run lint
- npm run build
- DATABASE_URL-backed dry smoke for summary and one non-destructive sample read when env is available

### V2-PRE-004: Website Lead Ingestion Service

Linear metadata:

- Title: [AIT CRM V2 Prep] Website lead ingestion service
- Priority: High
- Labels: Improvement, Needs Full Model, Complexity: Complex
- Owner lane: Builder plus Sentry review
- Dependencies: V2-PRE-001 and V2-PRE-002 preferred

Objective: extract website-form parsing, verification, normalization, audit, duplicate handling, and persistence into reusable ingestion mechanics.

Scope:

- Move website lead mechanics out of src/app/api/webhooks/website-leads/route.js into src/lib/ingestion/website-leads.js or equivalent focused modules.
- Preserve supported secret locations, Wix { data: ... } unwrapping, audit redaction, form field preservation, duplicate externalId handling, and CRM contact/lead creation behavior.
- Add fixtures for plain JSON, Wix-wrapped JSON, body-secret auth, duplicate externalId, and audit redaction.

Action/service boundary:

- Route owns HTTP parsing entrypoint, configuration checks, secret policy, and response status.
- Ingestion service owns reusable normalization/audit/persistence mechanics with explicit organization, business-unit, and body inputs.

Acceptance:

- Production Wix/AIT USA behavior remains compatible.
- Secret-like fields are still redacted from import/audit storage.
- The service can be reused by future non-Wix website form adapters.

Validation:

- npm run lint
- npm run build
- fixture tests for normalize/auth/audit behavior

### V2-PRE-005: Meta Webhook And Graph Client Adapter

Linear metadata:

- Title: [AIT CRM V2 Prep] Meta webhook and Graph client adapter
- Priority: High
- Labels: Improvement, Needs Full Model, Complexity: High Risk
- Owner lane: Builder plus Sentry/Titan review
- Dependencies: none

Objective: isolate Meta webhook verification, signature checking, page-token lookup, business-unit map parsing, and Graph API calls behind a provider adapter.

Scope:

- Extract Meta verify-token handling, app-secret signature validation, Page token lookup, Page business-unit mapping, Graph lead fetch, and Messenger profile fetch into src/lib/messaging/providers/meta.js or equivalent.
- Keep provider adapter free of CRM persistence and request/session globals.
- Add signed-payload and Graph failure fixtures.

Action/service boundary:

- Route owns HTTP GET/POST responses and provider config missing errors.
- Provider adapter owns Meta-specific mechanics and structured provider results.
- CRM ingestion services decide how provider results affect CRM/import state.

Acceptance:

- Facebook webhook verification and signed POST validation keep current behavior.
- Graph API failures return structured reasons without throwing raw provider noise into routes.
- Page token/business-unit mapping can be reused by V2 WhatsApp/Messenger work.

Validation:

- npm run lint
- npm run build
- provider fixture tests for signature, token lookup, and failed Graph responses

### V2-PRE-006: Facebook Lead Ads Ingestion Service

Linear metadata:

- Title: [AIT CRM V2 Prep] Facebook Lead Ads ingestion service
- Priority: High
- Labels: Improvement, Needs Full Model, Complexity: Complex
- Owner lane: Builder plus Sentry review
- Dependencies: V2-PRE-001, V2-PRE-002, V2-PRE-005

Objective: extract Facebook Lead Ads event flattening, idempotency, normalization, import audit, and CRM lead creation from the webhook route.

Scope:

- Move Lead Ads-specific logic from src/app/api/webhooks/facebook-leads/route.js into src/lib/ingestion/facebook-lead-ads.js or equivalent.
- Preserve leadgen event keys, duplicate leadgen handling, import batch/source row/normalized record/review item writes, and activity event behavior.
- Keep the route responsible for parsing the provider webhook and dispatching returned event results.

Action/service boundary:

- Route owns HTTP auth/config, webhook dispatch, and response shape.
- Lead Ads ingestion service owns idempotent event storage, Graph field normalization, CRM contact/lead writes, and import audit mechanics.

Acceptance:

- Duplicate leadgen IDs are skipped as before.
- Successful Graph fetch still creates/updates contact, creates lead, logs activity, and records promoted import audit.
- Failed Graph fetch still preserves source/audit rows and marks review needed.

Validation:

- npm run lint
- npm run build
- provider/event fixture tests for duplicate, success, and Graph failure paths

### V2-PRE-007: Messenger Inbound Ingestion Service

Linear metadata:

- Title: [AIT CRM V2 Prep] Messenger inbound ingestion service
- Priority: High
- Labels: Improvement, Needs Full Model, Complexity: Complex
- Owner lane: Builder plus Sentry review
- Dependencies: V2-PRE-001, V2-PRE-002, V2-PRE-005

Objective: extract current Messenger inbound capture into a reusable service that V2 conversations can build on.

Scope:

- Move Messenger event flattening, spam/review classification, message idempotency, profile fetch handling, contact/lead creation/linking, activity logging, and import audit writes into src/lib/ingestion/messenger-inbound.js or equivalent.
- Preserve current Page self-message ignore behavior, duplicate message handling, review classification, and linked-message behavior.
- Return a structured result that can later feed conversation/message tables.

Action/service boundary:

- Route owns provider webhook dispatch and HTTP response aggregation.
- Messenger ingestion service owns idempotent storage and CRM/import mechanics.
- V2 conversation services should later consume this structured result rather than re-parsing provider payloads.

Acceptance:

- Existing Messenger inbound lead/link behavior remains compatible.
- Review-worthy or failed-profile events remain visible in import review instead of disappearing.
- The service result exposes enough fields for V2 conversation creation without requiring route internals.

Validation:

- npm run lint
- npm run build
- fixture tests for ignore, duplicate, promote, linked-message, and review paths

## Proposed Data Model Additions

Exact naming can change during implementation, but V2 needs these concepts:

- tasks: assignable work items linked to organization, business unit, contact, lead, work order, type, status, priority, due date, owner, completed timestamp, and source.
- task_events: audit trail for task creation, assignment, due-date changes, completion, snooze, cancellation, and automation actions.
- lead_status_history: lifecycle/status transitions with actor, reason, and timestamps.
- conversation_channels: provider account/page/phone configuration per organization/business unit.
- conversations: one thread per contact/provider/channel identity where possible.
- conversation_participants: contact/user/provider identities attached to a conversation.
- messages: inbound/outbound messages with provider IDs, direction, body, attachments metadata, status, delivery errors, template ID, and timestamps.
- message_templates: approved internal template registry mapped to WhatsApp/Messenger provider templates where required.
- follow_up_sequences: sequence definitions by business unit/source/lifecycle trigger.
- follow_up_sequence_steps: scheduled step offsets, channel preference, template, fallback behavior, and approval requirements.
- sequence_enrollments: contact/lead enrollment state, next run time, pause/stop reason, and owner.
- communication_preferences: consent, opt-out, quiet hours, preferred language, preferred channel, and do-not-contact flags.
- custom_field_definitions and custom_field_values: org/business-unit scoped custom fields for contacts/leads/work orders.

## V2.0 Ops Core Slices

These are intentionally small enough to review independently.

### V2-001: Task And Follow-Up Schema

Linear metadata:

- Title: [AIT CRM V2.0] Task and follow-up schema
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: none

Objective: add the durable task/follow-up tables and constants.

Scope:

- Add Drizzle tables for tasks and task_events.
- Support task types: first outreach, follow-up, appointment, document request, payment follow-up, manual reminder.
- Support statuses: open, in_progress, snoozed, completed, canceled.
- Link tasks to contact, lead, business unit, owner, and creator.

Action/service boundary:

- Schema only; do not introduce route behavior in this slice.
- Shared constants/types may live with task mechanics, but no task status business flow should be hidden in schema helpers.

Acceptance:

- Migration generated and applied locally.
- Seed/bootstrap path can create sample tasks without localStorage-only assumptions.
- Permission checks prevent cross-organization task access.

Validation:

- npm run db:generate
- npm run lint
- focused route/service tests if the slice adds API behavior

### V2-002: Task Service And API

Linear metadata:

- Title: [AIT CRM V2.0] Task service and API
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-001

Objective: expose safe task CRUD and status transitions.

Scope:

- Add service helpers for create, assign, complete, snooze, cancel, and list.
- Add API route(s) scoped by organization/business unit/user permission.
- Emit task_events and activity_events for important changes.

Action/service boundary:

- API routes/actions own auth, permission checks, business-unit scoping, allowed transitions, and user-facing errors.
- Task service owns reusable mechanics: insert/update tasks, append task events, append activity events, and return structured results.
- Do not let the service infer the current user or bypass explicit organization/business-unit inputs.

Acceptance:

- Operators can create and update follow-up tasks through API.
- Every status transition leaves an audit event.
- Unauthorized users cannot access another business unit's task data.

Validation:

- API/unit tests for permission boundaries and transitions.
- npm run verify:rbac when database env is available.

### V2-003: Follow-Up Queue UI

Linear metadata:

- Title: [AIT CRM V2.0] Follow-up queue UI
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: Standard
- Owner lane: Builder
- Dependencies: V2-001, V2-002

Objective: create the operator surface for due work.

Scope:

- Add a follow-up queue view with filters for owner, business unit, due today, overdue, unassigned, and task type.
- Add quick actions: assign, complete, snooze, open contact.
- Surface due work on the dashboard.

Action/service boundary:

- UI calls the task API; it must not duplicate task transition rules client-side.
- Client state owns filters, sort, and optimistic affordances only after API success/failure paths are clear.

Acceptance:

- Operators can clear daily follow-up work without opening multiple pages first.
- Mobile/tablet layout remains usable and dense.
- Empty states distinguish no tasks from missing permission.

Validation:

- npm run lint
- npm run build
- browser smoke at desktop and mobile widths

### V2-004: Contact Detail Timeline Upgrade

Linear metadata:

- Title: [AIT CRM V2.0] Contact detail timeline upgrade
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-001, V2-002

Objective: make contact detail the source of truth for history.

Scope:

- Consolidate notes, activity events, task events, lead status changes, inbound messages, and outbound messages into one timeline contract.
- Add filters by event type.
- Preserve existing V1 website/import detail visibility.

Action/service boundary:

- Timeline route/action owns viewer permissions and record visibility.
- Timeline service owns provider-neutral event aggregation/normalization across notes, activity events, task events, status history, and messages.
- Do not mutate source records from the timeline read service.

Acceptance:

- A user can understand a contact's history without checking imports, notes, and messages separately.
- Timeline entries show actor/source, timestamp, business unit, and linked records where available.

Validation:

- API contract tests for timeline query scoping.
- Browser smoke on a contact with notes/imports/tasks/messages.

### V2-005: Ownership And Assignment Rules

Linear metadata:

- Title: [AIT CRM V2.0] Ownership and assignment rules
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-001, V2-002, V2-004

Objective: turn unassigned CRM work into managed queues.

Scope:

- Add owner filters and quick-assign actions for leads/contacts/tasks.
- Define default assignment behavior for new website/Facebook/Messenger/WhatsApp leads.
- Keep historical imported leads unassigned unless a rule explicitly opts in.

Action/service boundary:

- Actions own who is allowed to assign, which status/source can be auto-assigned, and whether historical records are eligible.
- Assignment service owns reusable mechanics for applying an owner, recording assignment events, and returning before/after state.
- Do not auto-assign historical imports by default.

Acceptance:

- Managers can find unassigned work.
- New leads can be assigned manually or through a simple deterministic rule.
- Assignment changes are visible on the timeline.

Validation:

- Tests for assignment rule behavior.
- Browser smoke for quick assign and owner filters.

### V2-006: Lifecycle Status Hardening

Linear metadata:

- Title: [AIT CRM V2.0] Lifecycle status hardening
- Priority: Medium
- Labels: Improvement, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-004, V2-005

Objective: make status transitions explicit and reportable.

Scope:

- Normalize lead lifecycle statuses and current stages.
- Add transition helpers and status history.
- Prevent invalid or permissionless status changes.

Action/service boundary:

- Actions own allowed transition rules, actor permission, and user-facing rejection reasons.
- Status service owns reusable mechanics for persisting the status change and status history event.
- Do not rewrite all pipeline UI in this slice unless required by the normalized transition contract.

Acceptance:

- Status movement is consistent across Contacts, Kanban, contact detail, and API.
- Reports can trust lifecycle data.

Validation:

- Unit/API tests for allowed and rejected transitions.
- Existing Kanban/contact browser smoke.

### V2-007: Product Admin For Users, Roles, And Business Units

Linear metadata:

- Title: [AIT CRM V2.0] Product admin users, roles, and business units
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: High Risk
- Owner lane: Builder plus Sentry/Titan review
- Dependencies: existing auth/RBAC foundation

Objective: make admin control usable without DB scripts.

Scope:

- Improve user management, role assignment, and business-unit membership screens.
- Add permission-safe create/update/deactivate flows.
- Keep managed role guardrails from V1.1 hardening.

Action/service boundary:

- Admin routes/actions own authorization, managed-role constraints, membership visibility, and cross-organization rejection.
- User/role service owns reusable mechanics for creating users, deactivating users, assigning roles, and changing memberships.
- Do not let service functions choose default permissions without explicit action-layer input.

Acceptance:

- Admins can manage users and memberships from the app.
- Non-admins cannot mutate user/role state.

Validation:

- RBAC tests.
- Browser smoke as admin and non-admin where available.

### V2-008: Custom Fields MVP

Linear metadata:

- Title: [AIT CRM V2.0] Custom fields MVP
- Priority: Medium
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-004, V2-007 preferred

Objective: allow business-unit-specific fields without schema churn.

Scope:

- Add custom field definitions and values for contacts/leads first.
- Support text, number, date, select, boolean, and long text.
- Render fields in contact detail and forms.

Action/service boundary:

- Actions own field visibility, edit permission, and validation policy per record type/business unit.
- Custom field service owns schema/value CRUD mechanics, type coercion, and structured validation output.
- Do not build a generic module/collection builder.

Acceptance:

- AIT-specific fields can be added without code changes.
- Values obey organization/business-unit scoping.

Validation:

- API tests for field validation and scoping.
- Browser smoke for creating/editing field values.

### V2-009: Manager Reporting MVP

Linear metadata:

- Title: [AIT CRM V2.0] Manager reporting MVP
- Priority: Medium
- Labels: Feature, Needs Full Model, Complexity: Standard
- Owner lane: Builder
- Dependencies: V2-001 through V2-006

Objective: expose the operational metrics that make follow-up accountable.

Scope:

- Add reports for unworked leads, overdue follow-ups, no-owner records, response time, conversion by source/stage, and owner workload.
- Keep financial reporting secondary.

Action/service boundary:

- Reporting route/action owns viewer permissions and business-unit scope.
- Reporting service owns reusable query builders for stale leads, overdue tasks, no-owner records, response time, conversion, and workload.
- Do not introduce new workflow mutations from reporting screens.

Acceptance:

- A manager can identify neglected leads and overloaded owners quickly.
- Reports respect business-unit permissions.

Validation:

- Query tests for key counts.
- Browser smoke for reporting filters.

### V2-010: Attachments MVP

Linear metadata:

- Title: [AIT CRM V2.0] Attachments MVP
- Priority: Medium while blocked
- Labels: Feature, Needs Full Model, Complexity: High Risk
- Owner lane: Builder plus Sentry/Titan review
- Dependencies: R2/S3-compatible bucket and env/access decision

Objective: enable files once object storage is approved.

Scope:

- Wire file uploads/downloads to R2/S3-compatible storage.
- Use existing files metadata table or migrate it if needed.
- Enforce record-level permissions and signed URL expiry.

Action/service boundary:

- Upload/download routes own auth, record-level permission checks, MIME/size policy, and signed URL authorization.
- Storage service owns provider mechanics: key generation, upload, delete, signed URL creation, and structured provider errors.
- Do not store raw file bytes in Postgres.

Acceptance:

- Users can attach files to contacts/leads/work orders.
- Raw files never live in Postgres.
- Unauthorized users cannot fetch files by guessing IDs.

Blocked on:

- Bucket provider decision.
- Bucket name/account.
- Access key/secret or equivalent env setup.
- Max upload size and allowed MIME policy.

Validation:

- Upload/download API tests.
- Browser smoke for attach/download/delete.

## V2.1 WhatsApp + Messenger Comms Engine Slices

### V2-011: Provider-Neutral Conversation Schema

Linear metadata:

- Title: [AIT CRM V2.1] Provider-neutral conversation schema
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-004 preferred

Objective: create the internal conversation/message model before outbound adapters.

Scope:

- Add conversation/channel/message tables and provider identity fields.
- Map messages to organization, business unit, contact, lead, provider, and direction.
- Store provider message IDs and delivery status for idempotency.

Action/service boundary:

- Schema only; avoid provider-specific business logic here.
- Shared normalization constants may be introduced, but provider SDK calls belong in provider services.

Acceptance:

- Messenger and WhatsApp can both map into the same internal model.
- Duplicate provider events do not create duplicate messages.

Validation:

- Migration and idempotency tests.
- Inbound fixture tests for Messenger and WhatsApp shapes.

### V2-012: Conversation UI On Contact Detail

Linear metadata:

- Title: [AIT CRM V2.1] Conversation UI on contact detail
- Priority: Medium
- Labels: Feature, Needs Full Model, Complexity: Standard
- Owner lane: Builder
- Dependencies: V2-011, V2-004

Objective: let operators read and manage conversations inside the CRM.

Scope:

- Add conversation panel/tab on contact detail.
- Show channel badges, message direction, status, timestamp, and linked task/sequence context.
- No external outbound sending in this slice.

Action/service boundary:

- UI reads conversation APIs and renders state; it does not send external messages in this slice.
- Conversation read route/action owns permissions; conversation service owns aggregation and provider-neutral formatting.

Acceptance:

- Existing inbound Messenger events become visible as conversation history after migration/wiring.
- Operators can distinguish inbound, outbound, failed, and pending messages.

Validation:

- Browser smoke with sample conversation data.
- npm run build

### V2-013: Messenger Inbound Upgrade

Linear metadata:

- Title: [AIT CRM V2.1] Messenger inbound conversation upgrade
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: High Risk
- Owner lane: Builder plus Sentry/Titan review
- Dependencies: V2-011

Objective: formalize existing Page Messenger webhook behavior into the conversation model.

Scope:

- Update /api/webhooks/facebook-leads Messenger event handling to write conversations/messages.
- Preserve existing lead/contact creation/linking behavior.
- Add fixtures for Meta Page message webhook shapes.

Action/service boundary:

- Webhook route owns signature/verification posture, page-to-business-unit routing, idempotency key extraction, and user-facing/loggable error classification.
- Messenger service owns payload normalization and Graph/Page-specific mechanics.
- Conversation service owns find/create contact lead conversation message mechanics.
- Do not weaken the existing Facebook webhook security posture.

Acceptance:

- Inbound Messenger messages create or link contact/lead/conversation/message records.
- Replayed webhook events are idempotent.
- Business-unit routing still works through Page mapping.

Validation:

- Webhook fixture tests.
- Signed/unsigned webhook security tests.

### V2-014: WhatsApp Inbound Webhook

Linear metadata:

- Title: [AIT CRM V2.1] WhatsApp inbound webhook
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: High Risk
- Owner lane: Builder plus Sentry/Titan review
- Dependencies: V2-011, Meta/WhatsApp webhook setup values

Objective: receive WhatsApp Cloud API inbound messages safely.

Scope:

- Add WhatsApp webhook verification and event route.
- Normalize inbound messages into conversations/messages.
- Link or create contacts using phone identity and business-unit routing.

Action/service boundary:

- Webhook route owns verification, signature checks where available, business-unit routing, idempotency, and error classification.
- WhatsApp service owns payload normalization and WhatsApp Cloud API event mechanics.
- Conversation service owns provider-neutral persistence.
- Do not add outbound WhatsApp sending in this slice.

Acceptance:

- WhatsApp inbound text messages appear on the contact conversation timeline.
- Unknown senders create reviewable leads instead of disappearing.
- Signature/verification posture is documented and tested.

Validation:

- Webhook verification tests.
- Inbound fixture tests.

### V2-015: Message Template Registry

Linear metadata:

- Title: [AIT CRM V2.1] Message template registry
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder
- Dependencies: V2-011

Objective: manage approved follow-up copy and provider template mapping.

Scope:

- Add template registry for business unit, channel, language, purpose, approval state, and provider template IDs.
- Support variable definitions and preview rendering.
- Do not send messages yet.

Action/service boundary:

- Template routes/actions own who can create/approve/use templates and which business unit/language/channel they apply to.
- Template service owns variable parsing, preview rendering, provider-template mapping, and structured validation.
- Do not call WhatsApp or Messenger send APIs in this slice.

Acceptance:

- Operators/admins can define templates for first outreach and follow-up.
- WhatsApp templates can map to provider-approved template names/IDs.
- Invalid variables are caught before use.

Validation:

- Template rendering tests.
- Browser smoke for template create/edit/preview.

### V2-016: Manual Outbound Sending With Approval Guardrails

Linear metadata:

- Title: [AIT CRM V2.1] Manual outbound sending with guardrails
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: High Risk
- Owner lane: Builder plus Sentry/Titan review
- Dependencies: V2-011, V2-012, V2-015, provider env/test accounts

Objective: send messages manually before automation.

Scope:

- Add provider adapters for Messenger and WhatsApp outbound send.
- Add manual send action from conversation UI.
- Enforce consent, opt-out, quiet hours, business-unit permission, provider template rules, and 24-hour windows.
- Record pending/sent/failed statuses and provider IDs.

Action/service boundary:

- Send action owns permission checks, consent/opt-out policy, quiet-hour policy, template/window rules, owner routing, and user-facing blocked reasons.
- Provider services own sendWhatsAppMessage/sendMessengerMessage mechanics and return structured delivery results.
- Conversation/message service owns recording pending/sent/failed message state.
- Do not auto-send sequence messages in this slice.

Acceptance:

- A permitted operator can send a template/manual reply through configured channels.
- Blocked sends show clear reasons.
- All sends are visible in the timeline and message audit trail.

Validation:

- Adapter tests with mocked provider responses.
- Permission/compliance tests.
- Manual staging smoke only after provider env is configured.

### V2-017: Follow-Up Sequence MVP

Linear metadata:

- Title: [AIT CRM V2.1] Follow-up sequence MVP
- Priority: High
- Labels: Feature, Needs Full Model, Complexity: High Risk
- Owner lane: Builder plus Sentry/Titan review
- Dependencies: V2-001, V2-002, V2-011, V2-015, V2-016

Objective: automate scheduled follow-up from CRM events.

Scope:

- Add sequence definitions, steps, enrollments, and scheduler job.
- Initial triggers: new lead, no response after X hours, proposal sent, stale opportunity.
- Start with human approval required for outbound sends unless explicitly disabled per business unit.

Action/service boundary:

- Enrollment/actions own trigger eligibility, owner routing, opt-out/stop conditions, approval requirement, and user-facing state.
- Automation service owns sequence step scheduling, due step lookup, idempotent execution, and structured run results.
- Sending still flows through the guarded manual/outbound send action or a policy-equivalent send action.
- Do not bypass consent or quiet-hour rules for automation.

Acceptance:

- New eligible leads can enroll in a sequence.
- Steps create tasks and/or draft messages at the right due time.
- Completed/replied/opted-out contacts stop or pause the sequence.
- Job runs are idempotent.

Validation:

- Time-based scheduler tests.
- Opt-out/reply/owner-routing tests.
- Cron smoke in staging/preview.

### V2-018: Agent Triage And Draft Replies

Linear metadata:

- Title: [AIT CRM V2.1] Agent triage and draft replies
- Priority: Medium
- Labels: Feature, Needs Full Model, Complexity: Complex
- Owner lane: Builder plus Sentry review
- Dependencies: V2-011, V2-012, V2-015

Objective: assist operators without silently acting on customers.

Scope:

- Classify inbound messages by intent and urgency.
- Extract missing contact/project details.
- Suggest next action and draft reply.
- Require human approval before sending in V2.

Action/service boundary:

- Triage action owns which conversations can be analyzed, what context is allowed, and how suggestions are exposed.
- AI/triage service owns classification, extraction, summary, and draft generation with structured outputs.
- Do not write AI suggestions as confirmed contact facts without an explicit user action.
- Do not send AI-generated replies automatically in V2.

Acceptance:

- Inbound conversations show a useful summary, intent, and suggested next step.
- Draft replies use business-unit templates and contact context.
- AI output is stored as suggestion metadata, not as confirmed truth.

Validation:

- Golden fixture tests for common intents.
- Safety tests for opt-out and sensitive requests.

### V2-019: Comms Observability And Runbook

Linear metadata:

- Title: [AIT CRM V2.1] Comms observability and runbook
- Priority: Medium
- Labels: Improvement, Needs Full Model, Complexity: Standard
- Owner lane: Builder/Sentry/Giuseppe
- Dependencies: V2-013 through V2-017

Objective: make provider integrations supportable.

Scope:

- Add delivery/retry/failure dashboards or admin views.
- Add provider health checks and webhook event logs with sensitive fields redacted.
- Extend production runbook for WhatsApp/Messenger setup, template approval, webhook verification, replay/debug, and rollback.

Action/service boundary:

- Admin/observability routes own viewer permissions and redaction policy.
- Provider services own health checks, provider status parsing, retry state, and structured failure records.
- Runbook updates must document exact env names, provider setup steps, and rollback/debug commands without exposing secrets.

Acceptance:

- A failed send or webhook can be diagnosed without reading raw provider dashboards first.
- Secrets and customer message contents are not leaked in logs.

Validation:

- Redaction tests.
- Runbook review.

## Recommended First Build Order

Start here:

1. V2-PRE-001 Shared CRM Access Helpers
2. V2-PRE-002 Transactional CRM Write Helpers
3. V2-PRE-003 Import Review Service Parity
4. V2-PRE-004 Website Lead Ingestion Service
5. V2-PRE-005 Meta Webhook And Graph Client Adapter
6. V2-PRE-006 Facebook Lead Ads Ingestion Service
7. V2-PRE-007 Messenger Inbound Ingestion Service
8. V2-001 Task And Follow-Up Schema
9. V2-002 Task Service And API
10. V2-003 Follow-Up Queue UI
11. V2-004 Contact Detail Timeline Upgrade
12. V2-011 Provider-Neutral Conversation Schema

This order keeps V1 stable while turning the fast-shipped mechanics into reusable modules first. Then the product gets a real follow-up spine before external sending begins. Once those are in place, WhatsApp and Messenger become adapters attached to trusted CRM state.

## External Setup Checklist

Before V2.1 staging smoke tests:

- Meta app configured for the correct business.
- Facebook Page IDs and Page access tokens mapped per business unit.
- Facebook App Secret configured and signature validation required.
- WhatsApp Business Account and phone number ID selected.
- WhatsApp webhook verify token and app secret configured.
- WhatsApp message templates submitted/approved for first outreach and follow-up.
- Consent/opt-out language approved.
- Quiet-hour policy approved.
- Provider test recipient numbers/accounts available.

Before V2-010:

- R2/S3-compatible bucket selected.
- Production/staging env names defined.
- Access keys configured in deployment environment.
- Upload size/MIME/retention policy approved.

## Review And Validation Gates

Every slice should include:

- A narrow branch/PR.
- Migration review when schema changes.
- Permission/scoping tests for organization and business unit boundaries.
- npm run lint.
- npm run build for UI/API slices.
- Browser smoke for user-facing screens.
- Provider fixture tests for webhook/adapter slices.
- Production runbook updates when env or external setup changes.

## Open Decisions

- Pick the first supported WhatsApp provider path: direct Meta WhatsApp Cloud API unless a client account constraint forces another provider.
- Confirm whether Messenger outbound should be enabled for all connected Pages or only specific business units first.
- Decide whether follow-up sequences default to draft-only or can auto-send approved templates after an initial burn-in period.
- Decide the initial quiet-hour window and timezone source.
- Decide whether file storage should be included in V2.0 or handled as a parallel unblock once the bucket exists.
