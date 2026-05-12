# AIT CRM Custom Backend Plan

## Current Decision

AIT CRM should be a custom CRM/business operations system, not a wrapper around an existing CRM.

The backend should be custom enough to own the business rules that matter:

- multi-business operation under one roof
- role-based access for different employee types
- lead ingestion from Facebook, web forms, calls, and future sources
- automated follow-up and communication history
- reliable reporting, attribution, audit trails, and operational workflows

Directus can still be useful as a temporary or optional admin/data tool, but it should not own the core permission model, business-unit model, or automation logic.

## Execution Status

- [x] Final operating model defined: Linear -> Symphony -> Codex -> GitHub -> Giuseppe review
- [x] AIT Signs workbook profile generated from the XLSX
- [x] AIT Signs migration notes drafted from the profile
- [x] AIT Signs schema draft written from the profile
- [x] AIT Signs row-level staging preview drafted
- [x] Plan doc updated with finalized strategy and phases
- [x] Schema and import staging tables drafted in SQL
- [ ] First Postgres-backed CRM entities
- [ ] Real auth and RBAC
- [ ] Facebook Lead Ads ingestion

## Final Operating Model

This is the finalized delivery stack for the project:

- `Linear` is the source of truth for tickets, priorities, acceptance criteria, and phase tracking.
- `GitHub` is the source of truth for code, branches, pull requests, and CI.
- `Giuseppe` / OpenClaw is the director layer that scopes work, sets priorities, reviews output, and decides what is ready.
- `Symphony` is the router/control loop that watches Linear, creates isolated workspaces, and dispatches execution.
- `Codex` is the coding harness that edits code, writes scripts, runs tests, and produces implementation evidence.
- `Google Drive` is a useful optional source for spreadsheets, docs, and source data if the client keeps operational files there.

Working rule:

- Linear ticket -> Symphony routes -> Codex implements -> GitHub records the branch/PR -> Giuseppe reviews -> merge only after validation.

This keeps the work fast without turning the process into a free-for-all.

## Confirmed First Client Context

The first client has four businesses under one roof, in priority order:

1. AIT Signs
2. AIT USA Institute
3. AIT Photo & Video
4. AIT Taxes

Implementation should prioritize AIT Signs first, but the schema must support all four from the beginning so data access, reporting, ingestion, and future automation do not need to be retrofitted later.

Current production data source:

- AIT Signs currently runs on Google Sheets / spreadsheet exports.
- Four CSV exports have been provided for AIT Signs:
  - `Interesados` / prospects
  - `Estimados` / estimates
  - `15 Signs Work Order` / active work orders
  - `Work Order Terminados y Pagado` / completed and paid archive
- The source data is Spanish-first and operationally messy: preamble rows, merged-header artifacts, status legends, blank rows, duplicate people/phones, follow-up notes, payment columns, balances, and lifecycle movement between sheets.
- This data should be treated as a migration product stream, not a simple CSV upload.
- XLSX or direct Google Sheets access is preferred over CSV when available, because formatting, sheet names, formulas, hidden columns, and merged headers may carry meaning that CSV flattens away.

## Terminology Decision

Use `Business Unit` as the durable product/backend term.

For this client, the UI can label business units as `Divisions`, because that is the language they already use. Internally, `business_unit` is better than `division` because it covers several real-world cases:

- separate businesses under one roof
- brands
- departments
- service lines
- locations
- operating units

Avoid using a loose tag for this. A business unit should be a real relational record with an ID, because permissions, reporting, automation, assignment, and roll-up dashboards depend on it.

Recommended naming:

- `organizations`: the customer/account using the CRM
- `business_units`: the separate businesses, divisions, brands, or operating groups under that organization
- `organization_settings.business_unit_label`: lets the UI say `Divisions`, `Businesses`, `Brands`, or another customer-specific label

If accounting/legal separation becomes important later, add `legal_entities` separately. Do not overload `business_units` with tax/legal meaning until needed.

## Core Architecture

Recommended stack:

- Next.js app for the CRM product UI
- Postgres as the source of truth
- Drizzle for schema and migrations
- Custom API/server layer for product behavior
- Custom internal admin pages inside the CRM app
- Durable workflow layer for automations
- SMS/email/voice providers for delivery only
- QuickBooks integration later, after the CRM foundation is proven
- Linear for work tracking and Codex slice coordination
- GitHub for implementation branches, PRs, and review history

Workflow layer options:

- Trigger.dev: best developer speed and good fit for product workflows
- Temporal: best if workflow durability and complexity become serious
- BullMQ + Redis: leanest custom queue option
- n8n: useful for internal ops/prototyping, not recommended as core product brain

V1 should not attempt to replace QuickBooks as the accounting ledger. AIT CRM can own CRM-native commercial workflow, such as estimates, customer/job context, proposal tracking, and invoice visibility, but QuickBooks should remain the accounting source of truth for invoices, payments, bank reconciliation, tax-facing books, and accountant workflows until there is a clear replacement decision.

QuickBooks is V5 scope, not V1. The CRM should be designed so QuickBooks can be connected later, but the first build should not spend implementation time on QuickBooks sync unless a production blocker appears.

Recommended financial posture:

- CRM owns estimate/proposal workflow and business context.
- QuickBooks owns official invoices, payments, reconciliation, and accounting books.
- CRM stores synced invoice/payment snapshots for dashboards and operational visibility.
- Later, CRM may generate invoices into QuickBooks via API if that improves workflow.
- Do not build a full accounting system inside AIT CRM unless accounting itself becomes a product priority.

## Hosting Recommendation

Recommended V1 hosting:

- Vercel: Next.js app, route handlers, server actions, webhooks, preview deployments
- Neon Postgres: managed Postgres database
- Cloudflare R2 or S3-compatible storage: files and attachments
- Trigger.dev later: durable background workflows for V2/V3 automation

Why this is the default recommendation:

- The app is already Next.js, so Vercel is the lowest-friction deploy target.
- Vercel route handlers are enough for V1 API endpoints and Facebook Lead Ads webhooks.
- Neon is a clean managed Postgres fit for serverless Next.js, with connection pooling, branching, autoscaling, and Vercel integration.
- File storage should not live in the database. Use object storage and store metadata in Postgres.
- V1 does not need a separate long-running backend service unless import processing or Facebook/web ingestion become more complex than expected.

Recommended deployment shape:

- `main`/production branch deploys to production.
- Preview deployments are used for PR validation.
- Production database lives in Neon.
- Preview database strategy can start with a shared staging DB, then move to Neon branching when workflow maturity justifies it.
- All secrets live in Vercel/Neon/provider dashboards, never in the repo.

When to choose a different host:

- Choose Render/Fly/Railway if the backend becomes a long-running service with workers, queues, or websocket-heavy behavior.
- Choose Supabase if we want its Auth/Storage/Realtime package more than we want a lean custom backend.
- Choose AWS/GCP only if client/security/compliance requirements justify the added operational load.

V1 recommended default:

- Vercel + Neon + Cloudflare R2

This keeps the architecture simple, production-capable, and easy for Codex agents to reason about.

Recommended ORM decision:

- Use `Drizzle` as the default migration/schema layer.
- Keep the SQL draft aligned with Drizzle table definitions.
- Avoid introducing Prisma unless a later slice proves we need its client ergonomics more than Drizzle's explicitness.

## Authentication Recommendation

Authentication is required before real production access, but it does not need to be the first implementation slice while the product is still being shaped around imported data.

Recommended sequencing:

- Phase 1: data model, import staging, cleanup workflow, and core CRM screens can be built in a controlled/internal environment.
- Phase 1.5: add real authentication, signed-in users, and app-owned authorization before broader user rollout.

Recommended default:

- Auth.js/NextAuth or Better Auth for authentication
- Custom RBAC in Postgres for authorization

Reasoning:

- Auth should prove who the user is.
- Our app should decide what the user can access.
- Business-unit scoping and role permissions are business rules, so they should live in our database and server-side checks.

Do not use Clerk by default for this project. It adds a vendor layer, cost, and operational complexity that are not justified unless speed/polished user management becomes more important than owning the auth path.

If Clerk is used later, treat Clerk as identity only and keep roles/business-unit permissions in Postgres.

## Directus Position

Directus is not a CRM. It is a generic data/admin/API platform.

Directus can save time on:

- admin CRUD screens
- data cleanup
- imports
- file/media browsing
- generated REST/GraphQL APIs
- basic roles and permissions
- operational visibility

But AIT CRM should own:

- CRM domain model
- role and permission behavior
- business-unit visibility rules
- lead ingestion and dedupe
- outreach sequencing
- communication provider logic
- reporting definitions
- audit/activity semantics

If used, Directus should be treated as an accelerator/admin surface over our data, not as the product architecture.

## User Types And Permissions

The production app should replace the current mock role toggle with real RBAC.

V1 should keep the same user types already present in the CRM prototype:

- Administrator: `admin`
- Designer: `designer`
- Account Manager: `account_manager`
- Sales Manager: `sales_manager`

Core tables:

- `users`
- `roles`
- `permissions`
- `user_roles`
- `teams` or `departments`, if needed

Future roles can be added later if the business needs them:

- General Manager
- Sales Rep
- Production/Installer
- Accounting
- Read-only/Auditor

Permissions should be granular and composable:

- view contacts
- edit contacts
- assign leads
- view financials
- edit invoices
- export data
- manage users
- manage business units
- view all business units
- view assigned business units only
- view assigned records only

Access checks should consider:

- organization
- business unit
- role
- explicit assignment
- record ownership
- sensitive field permissions

Example rules:

- Admin sees all business units.
- Sales Manager sees sales activity, assigned teams/leads, and business-unit scoped performance.
- Account Manager sees assigned contacts, customer activity, and account follow-up work.
- Designer sees design/job-related work assigned to them, with restricted financial/settings access.
- Future accounting/production roles can be split out when those workflows become first-class.

## Business Unit Model

Core tables:

- `organizations`
- `business_units`
- `business_unit_memberships`

Most business records should carry:

- `organization_id`
- `business_unit_id`

Examples:

- Contact belongs to an organization and usually a business unit.
- Lead belongs to a business unit for routing and attribution.
- Job/work order belongs to a business unit.
- Estimate/invoice belongs to a business unit for reporting.
- Campaign belongs to a business unit so Facebook/web leads route correctly.
- Messages and calls inherit business unit from the related lead/contact/job when possible.

Some records can be organization-wide:

- users
- roles
- permissions
- global settings
- shared contacts, if the business chooses to allow them
- cross-business reporting

Important rule: model `business_unit_id` as a real foreign key, not as a generic tag.

Recommended default for shared customers:

- Contacts belong to the organization.
- Contacts may have an optional `primary_business_unit_id` for routing/defaults.
- Leads, jobs/work orders, estimates, invoices, campaigns, messages, calls, tasks, and files usually carry `business_unit_id`.
- The same contact can have activity across multiple business units through related records.

This handles the expected case where the same person or company may interact with more than one AIT business, without forcing duplicate contacts or overcomplicating contact ownership.

Files should be business-unit scoped when attached to a business-unit scoped record. Organization-wide files can exist separately when needed. This keeps AIT Signs files separate from AIT Taxes files by default while still allowing shared organization-level documents.

## Custom Fields

Support controlled custom fields inside known entities.

This gives flexibility without becoming a generic no-code database platform.

Core tables:

- `custom_field_definitions`
- `custom_field_values`

Supported scopes:

- contacts
- leads
- jobs/work orders
- estimates
- invoices
- campaigns
- tasks

Supported field types:

- text
- number
- date
- select
- multi-select
- checkbox
- URL
- phone/email where useful

Avoid initial support for user-created arbitrary modules/tables from the UI. Creating entirely new objects like `Permits`, `Vendors`, or `Equipment` with custom relationships, permissions, forms, APIs, imports, and reports is Directus-like low-code platform scope. Add new first-class modules through product development when they become important.

## Core Data Domains

Initial production schema should cover:

- contacts
- leads
- opportunities or pipeline stages
- jobs/work orders
- estimates
- invoices/financial records
- tasks
- calendar events
- campaigns
- lead sources
- messages
- calls
- notes
- files/attachments
- activity timeline
- audit log
- users/roles/permissions
- organizations/business units

## AIT Signs Data Migration

The first real implementation risk is not UI or auth. It is understanding and cleaning the existing AIT Signs data well enough to avoid importing bad history into a new system.

Current source sheets represent a lifecycle:

1. `Interesados`: prospects/leads, mostly Facebook and manual follow-up.
2. `Estimados`: estimates that may or may not be approved.
3. `15 Signs Work Order`: active production work.
4. `Work Order Terminados y Pagado`: completed and paid work/archive.

Migration should use a staged import model:

- `import_batches`: one record per uploaded/exported source file.
- `import_source_rows`: raw parsed rows with original row number, sheet/source name, and untouched values.
- `import_normalized_records`: proposed contacts, leads, estimates, work orders, payments, notes, and follow-ups extracted from source rows.
- `import_review_items`: human review queue for duplicates, uncertain mappings, Spanish notes/statuses, malformed rows, and conflicting financial values.
- final production tables receive only approved/validated records.

Important mapping rules:

- Normalize phones first; use phone as the strongest dedupe signal, but do not auto-merge every matching phone without review.
- Preserve the original Spanish text in notes/activity even when adding normalized English/internal statuses.
- Treat spreadsheet status legends as business vocabulary that needs mapping, not noise.
- Convert repeated follow-up columns into timeline/activity records.
- Convert payment, balance, tax, total, and advance columns into financial snapshots tied to estimates/work orders, not authoritative accounting ledger rows.
- Track source sheet and source row on every imported record for traceability.

The import UX should make cleanup collaborative:

- upload or connect sheet
- preview parsed rows
- map columns
- review proposed records
- flag duplicate contacts/companies
- approve batches in chunks
- show import errors in Spanish-friendly language where useful
- allow rollback/re-run for a batch before production use

Recommended immediate work:

- Build a small parser/profiler for the four provided CSVs.
- Produce a field inventory and lifecycle map.
- Create a proposed normalized schema from the actual data, not from guesses.
- Review unclear Spanish statuses/notes with Alvaro before locking mappings.

## Ingestion And Automation

Lead ingestion should be custom.

Sources:

- Facebook Lead Ads webhooks
- website forms
- Google forms/ads later
- call tracking/AI receptionist later
- CSV/Google Sheets import

V1 ingestion priority:

1. CSV/Google Sheets staged import for existing AIT Signs data.
2. Manual entry and editing for cleaned records.
3. Facebook Lead Ads.
4. Website forms.
5. Phone/AI receptionist later.

Ingestion responsibilities:

- verify webhook signatures
- normalize payloads
- dedupe contacts/leads
- map source to business unit
- preserve attribution
- create timeline/audit events
- trigger follow-up workflow
- support retries and idempotency

Automation responsibilities:

- new lead response sequences
- SMS/email follow-up
- salesperson task assignment
- pause on reply/booked/opt-out
- escalation rules
- reminders
- status changes
- campaign reporting syncs

Every send, reply, bounce, failure, opt-out, status change, and assignment should write back to the CRM activity/audit model.

Automation is not V1.

Current phased intent:

- V1: source-of-truth backend, business units, core CRM data, staged import/cleanup, and manual operations.
- V1.5: authentication, signed-in users, RBAC enforcement, and production access hardening.
- V2: Facebook/web ingestion and automated follow-up basics.
- V3: broader outreach/orchestration and more advanced communication workflows.
- Version 5 / V5: QuickBooks integration.

## Build Estimate

Directus-backed migration:

- 2-5 focused days for basic Postgres/Directus setup, schema, app connection, and localStorage replacement
- lower short-term risk
- higher risk of fighting generic abstractions later

Custom backend/admin MVP:

- 1-2 weeks for a strong foundation if scope is disciplined
- expected scope: schema, migrations, CRUD APIs, RBAC, business units, basic admin pages, imports, audit/activity model
- medium risk
- best long-term fit for business-specific behavior

Serious Directus-lite platform:

- 4-8 weeks
- only worth it if the platform itself becomes reusable across many products

Full Directus parity:

- 6-12+ months
- not recommended

## V1 Execution Plan

### Step 0: Lock Inputs

- Review the four provided AIT Signs CSV exports.
- Prefer XLSX or direct Google Sheets access if available.
- Identify exact fields, sheet lifecycle, dedupe patterns, Spanish status vocabulary, and business-unit separation.
- Confirm hosting accounts and access: Vercel, Neon, Cloudflare/AWS or R2, and Meta/Facebook.
- Defer QuickBooks account/access questions to V5 unless a near-term blocker appears.

### Step 1: Data Profiling And Migration Design

- Build a read-only CSV/XLSX profiler.
- Detect header rows, empty rows, malformed rows, totals/formula artifacts, duplicate phones, and likely lifecycle transitions.
- Produce field inventory for prospects, estimates, active work orders, completed/paid work orders, payments, balances, notes, and follow-ups.
- Draft the normalized schema and import mapping from real source data.
- Review uncertain Spanish statuses and notes with Alvaro before import rules become automated.

### Step 2: Backend Foundation

- Add Postgres and migration tooling.
- Choose ORM: Drizzle is the recommended default for this app because it is explicit, TypeScript-friendly, and maps well to a custom schema.
- Add database schema for organizations, business units, contacts, leads, estimates, work orders/jobs, financial snapshots, tasks, files, notes, activity, audit logs, and import staging tables.
- Seed the first organization and four business units.

### Step 3: Import Staging And Review

- Import raw rows into staging tables without mutating production CRM records.
- Normalize proposed contacts, leads, estimates, work orders, payments, notes, and follow-up activities.
- Add review states: pending, needs_review, approved, rejected, imported.
- Preserve source file, source sheet, source row, and raw Spanish text.
- Add rollback/re-run behavior per import batch.

### Step 4: Replace LocalStorage For Core CRM

- Replace `src/lib/store.js` localStorage persistence with server-backed data access.
- Keep the existing UI where practical.
- Move mutations through server actions/API endpoints.
- Preserve current UX while changing the data source.

### Step 5: Business Unit UX

- Add business-unit filter/switcher where needed.
- Add business-unit assignment to contacts/leads/jobs/financial records/files.
- Add consolidated vs business-unit scoped reporting.
- Keep UI label configurable so this client can see "Divisions".

### Step 6: Files

- Add object storage bucket.
- Add file metadata table.
- Scope files by organization and business unit when attached to scoped records.
- Add upload/download/delete permissions.

### Step 7: Auth And Authorization

- Add authentication after the core data model/import flow is coherent.
- Replace frontend role toggle with real signed-in users.
- Seed roles: admin, designer, account_manager, sales_manager.
- Add server-side permission helpers.
- Enforce organization/business-unit scoping in every data access path.
- Add tests for permission boundaries.

### Step 8: Facebook Lead Ads

- Add Meta webhook endpoint after the manual/imported CRM path works.
- Verify webhook signatures.
- Map lead forms/campaigns to business units.
- Normalize and dedupe lead/contact data.
- Create lead/contact/activity records.
- Add observability for failures and retries.

### Step 9: Deployment And Validation

- Deploy preview/staging.
- Run lint/build/tests.
- Validate import staging/review, core CRM operations, business-unit isolation, auth/RBAC, and Facebook webhook flow.
- Create production runbook.

## Codex Implementation Plan

Use Codex in small, reviewable slices. Do not ask one agent to rewrite the app end-to-end.

Recommended workflow:

- Keep this plan doc as the source of truth for product direction, but mirror execution in Linear.
- Create one Linear issue per slice with explicit acceptance criteria and validation commands.
- Each Codex run gets a narrow file/module ownership scope and a matching GitHub branch/PR when code changes.
- Every run must report changed files, validation commands, and unresolved assumptions.
- Prefer local commits per slice.
- Do not push until a human-approved integration checkpoint.
- If Symphony is routing the work, it should create the workspace, hand off the ticket context, and collect the evidence.

Suggested slice order:

1. CSV/XLSX profiler for provided AIT Signs exports.
2. Field inventory, lifecycle map, and Spanish status mapping draft.
3. Schema/migrations foundation, including import staging tables.
4. Seed data for organization and business units.
5. Contacts/leads/estimates/work-orders server data model.
6. Import staging and review workflow.
7. Contacts API/data migration from localStorage.
8. Leads/jobs/financial snapshots API/data migration.
9. UI data-provider replacement.
10. Business-unit UI and filters.
11. File storage.
12. Auth integration.
13. RBAC and business-unit access helpers.
14. Facebook webhook ingestion.
15. Permission/integration test suite.
16. Deployment/runbook.
17. QuickBooks V5 investigation/adapter.

Recommended agent discipline:

- One branch/worktree per slice.
- No broad rewrites unless the slice explicitly requires it.
- Keep current UI intact unless a backend change forces a UX update.
- Add tests around permission and business-unit scoping before adding more features.
- Use the canonical git author identity already configured for this repo.

First Codex task should not be app implementation. It should be a repo-backed data profiling/design slice:

- inspect current app state
- inspect the provided CSV exports
- produce a source field inventory and lifecycle map
- identify parse/mapping uncertainties that require Alvaro review
- choose Drizzle vs Prisma with reasons
- propose concrete schema files, import staging tables, and migration layout
- identify exact files that need to change for the first implementation slice
- produce a small implementation plan for the first code slice

## Operating Phases

### Phase 0: Workflow Foundation

- Enable Linear and GitHub integrations.
- Create the first working issue list in Linear for the AIT CRM build.
- Decide the branch naming and PR convention for Codex-authored slices.
- Confirm the repo owner identity and the review/merge path.
- Treat this plan doc as the narrative spec and Linear as the execution queue.

## Recommended Phases

### Phase 1: Data Foundation And Core CRM

- Profile the existing AIT Signs CSV/XLSX/Google Sheet data.
- Build staged import tables and review workflow.
- Map Spanish statuses, notes, payment fields, and follow-up fields into normalized CRM concepts.
- Pick ORM/migration tool.
- Create Postgres schema.
- Add organizations and business units.
- Add activity and audit tables.
- Replace localStorage persistence for core records.
- Keep business-unit scoping in Phase 1; do not migrate to Postgres first and retrofit business-unit ownership later.

### Phase 1.5: Auth And Access Control

- Add real authentication.
- Add real users/roles/permissions.
- Seed roles: admin, designer, account_manager, sales_manager.
- Replace the mock role toggle.
- Add server-side authorization helpers.
- Enforce business-unit and assignment boundaries before production/broader user access.

### Phase 2: Product Admin

- Build internal admin screens inside AIT CRM.
- Add role management.
- Add business unit management.
- Add import/export tools.
- Add basic file/attachment support.

### Phase 3: CRM Operations

- Harden contacts/leads/jobs/financials.
- Add assignment logic.
- Add business-unit scoped dashboards.
- Add consolidated organization reporting.
- Add custom fields for core entities.

### Phase 4: Ingestion

- Add Facebook Lead Ads ingestion.
- Add website form ingestion.
- Harden ongoing CSV/Google Sheets import flow.
- Add dedupe and attribution.
- Add source-to-business-unit mapping.

### Phase 5: Automation

- Add durable workflow engine.
- Add Twilio/email provider integration.
- Add follow-up sequences.
- Add reply/opt-out/bounce handling.
- Add task escalation and reminders.

### Version 5 / V5: QuickBooks / Accounting Integration

- Confirm QuickBooks structure only when accounting integration becomes active scope.
- Add read-only invoice/payment snapshot sync first.
- Store external IDs and last sync timestamps.
- Keep QuickBooks as accounting source of truth unless a separate replacement decision is made.

### Phase 6: Hardening

- Add integration tests around permissions.
- Add audit/recovery tooling.
- Add observability for ingestion and workflows.
- Add backup/restore process.
- Add production deployment runbook.

## Guardrails

- Do not let users create arbitrary database modules from the UI in the first version.
- Do support custom fields inside known CRM entities.
- Keep business-unit scoping first-class from day one.
- Do not treat permissions as frontend-only.
- Do not make Directus or n8n the core business brain.
- Do not make Linear or GitHub the product brain either; they are delivery infrastructure.
- Every external communication event must be logged back to the CRM.
- Every automated write should be idempotent.

## Strategy Summary

The strategic order is:

1. Build the real AIT Signs data foundation first.
2. Keep the scope to core CRM, business units, and staging/import cleanup.
3. Add auth after the data model is coherent and useful.
4. Add Facebook/web ingestion after the manual/import path is stable.
5. Add automation only after the CRM can reliably hold and route the data.
6. Keep QuickBooks out of V1/V2 unless a hard blocker appears.

The execution rule is:

- spec in this doc
- tasks in Linear
- code in GitHub
- implementation by Codex
- routing through Symphony when available
- review by Giuseppe

## Open Questions

- Which workflow engine should be used: Trigger.dev, Temporal, or BullMQ?
- Can we get XLSX or direct Google Sheets access to preserve formatting/formulas/hidden context, or should we proceed from CSV only?
- Which Spanish status labels and notes should become normalized CRM statuses versus plain timeline notes?
- What are the exact approval/movement rules from prospect to estimate to work order to completed/paid?
- Should business-unit membership be per-user only, or also team-based?
- Which data should be shared organization-wide across all business units?
- Which production data issues can be auto-cleaned, and which must always go through human review?

## Final Pre-Implementation Questions

These are the remaining questions before code implementation should start:

1. Can we get the original XLSX/Google Sheet access, or are the four CSV exports the source we should build from first?
2. Who can help validate Spanish statuses/notes when mappings are ambiguous?
3. Do we have or want Vercel + Neon + Cloudflare R2 accounts for this project?
4. Should business-unit membership be assigned directly per user in V1.5, or should we add teams immediately?
5. Should we start with Auth.js/NextAuth or Better Auth for Phase 1.5?
