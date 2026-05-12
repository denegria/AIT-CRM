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

## Confirmed First Client Context

The first client has four businesses under one roof, in priority order:

1. AIT Signs
2. AIT USA Institute
3. AIT Photo & Video
4. AIT Taxes

Implementation should prioritize AIT Signs first, but the schema must support all four from the beginning so data access, reporting, ingestion, and future automation do not need to be retrofitted later.

Current production data source to inspect before final schema lock:

- Google Sheets are currently used to store business data.
- Those sheets should be reviewed before finalizing contact sharing, business-unit scoping, field names, import mappings, and workflow assumptions.

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
- Drizzle or Prisma for schema and migrations
- Custom API/server layer for product behavior
- Custom internal admin pages inside the CRM app
- Durable workflow layer for automations
- SMS/email/voice providers for delivery only
- QuickBooks integration for accounting source-of-truth behavior unless explicitly replaced later

Workflow layer options:

- Trigger.dev: best developer speed and good fit for product workflows
- Temporal: best if workflow durability and complexity become serious
- BullMQ + Redis: leanest custom queue option
- n8n: useful for internal ops/prototyping, not recommended as core product brain

V1 should not attempt to replace QuickBooks as the accounting ledger. AIT CRM can own CRM-native commercial workflow, such as estimates, customer/job context, proposal tracking, and invoice visibility, but QuickBooks should remain the accounting source of truth for invoices, payments, bank reconciliation, tax-facing books, and accountant workflows until there is a clear replacement decision.

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
- V1 does not need a separate long-running backend service unless QuickBooks/Facebook sync jobs become more complex than expected.

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

## Authentication Recommendation

V1 needs real authentication and app-owned authorization.

Recommended default:

- Auth.js/NextAuth or Better Auth for authentication
- Custom RBAC in Postgres for authorization

Reasoning:

- Auth should prove who the user is.
- Our app should decide what the user can access.
- Business-unit scoping and role permissions are business rules, so they should live in our database and server-side checks.

Clerk is still a valid alternative if speed and polished user management matter more than keeping auth fully app-owned. If Clerk is used, treat Clerk as identity only and keep roles/business-unit permissions in Postgres.

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

## Ingestion And Automation

Lead ingestion should be custom.

Sources:

- Facebook Lead Ads webhooks
- website forms
- Google forms/ads later
- call tracking/AI receptionist later
- CSV/Google Sheets import

V1 ingestion priority:

1. Facebook Lead Ads
2. Website forms
3. Manual entry
4. CSV/Google Sheets import
5. Phone/AI receptionist later

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

- V1: source-of-truth backend, RBAC, business units, core CRM data, and Facebook-first ingestion.
- V2: automated follow-up basics.
- V3: broader outreach/orchestration and more advanced communication workflows.

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

- Review the client's Google Sheets.
- Identify exact fields, sheets, dedupe patterns, and business-unit separation.
- Confirm where QuickBooks stores the four businesses: classes, locations, custom fields, separate companies, or naming conventions.
- Confirm hosting accounts and access: Vercel, Neon, Cloudflare/AWS, Meta/Facebook, QuickBooks.

### Step 1: Backend Foundation

- Add Postgres and migration tooling.
- Choose ORM: Drizzle is the recommended default for this app because it is explicit, TypeScript-friendly, and maps well to a custom schema.
- Add database schema for organizations, business units, users, roles, permissions, memberships, contacts, leads, jobs, financial snapshots, tasks, files, notes, activity, and audit logs.
- Seed the first organization and four business units.
- Seed V1 roles: admin, designer, account_manager, sales_manager.

### Step 2: Auth And Authorization

- Add authentication.
- Replace frontend role toggle with real signed-in users.
- Add server-side permission helpers.
- Enforce organization/business-unit scoping in every data access path.
- Add tests for permission boundaries.

### Step 3: Replace LocalStorage

- Replace `src/lib/store.js` localStorage persistence with server-backed data access.
- Keep the existing UI where practical.
- Move mutations through server actions/API endpoints.
- Preserve current UX while changing the data source.

### Step 4: Business Unit UX

- Add business-unit filter/switcher where needed.
- Add business-unit assignment to contacts/leads/jobs/financial records/files.
- Add consolidated vs business-unit scoped reporting.
- Keep UI label configurable so this client can see "Divisions".

### Step 5: Files

- Add object storage bucket.
- Add file metadata table.
- Scope files by organization and business unit when attached to scoped records.
- Add upload/download/delete permissions.

### Step 6: Imports

- Build CSV/Google Sheets import path after reviewing current sheets.
- Import contacts/leads/jobs/financial snapshots with mapping and dedupe.
- Record import activity/audit events.

### Step 7: Facebook Lead Ads V1

- Add Meta webhook endpoint.
- Verify webhook signatures.
- Map lead forms/campaigns to business units.
- Normalize and dedupe lead/contact data.
- Create lead/contact/activity records.
- Add observability for failures and retries.

### Step 8: QuickBooks Visibility

- Do not replace QuickBooks.
- Add a V1 sync plan for invoice/payment snapshots after confirming QuickBooks structure.
- Store external IDs and last sync timestamps.
- Keep CRM financial dashboards operational, not tax/accounting authoritative.

### Step 9: Deployment And Validation

- Deploy preview/staging.
- Run lint/build/tests.
- Validate auth, RBAC, business-unit isolation, imports, and Facebook webhook flow.
- Create production runbook.

## Codex Implementation Plan

Use Codex in small, reviewable slices. Do not ask one agent to rewrite the app end-to-end.

Recommended workflow:

- Keep this plan doc as the source of truth.
- Create one implementation ticket per slice.
- Each Codex run gets a narrow file/module ownership scope.
- Every run must report changed files, validation commands, and unresolved assumptions.
- Prefer local commits per slice.
- Do not push until a human-approved integration checkpoint.

Suggested slice order:

1. Schema/migrations foundation.
2. Seed data for organization, business units, and roles.
3. Auth integration.
4. RBAC and business-unit access helpers.
5. Contacts API/data migration from localStorage.
6. Leads/jobs/financial snapshots API/data migration.
7. UI data-provider replacement.
8. Business-unit UI and filters.
9. File storage.
10. CSV/Sheets import.
11. Facebook webhook ingestion.
12. QuickBooks sync investigation/adapter.
13. Permission/integration test suite.
14. Deployment/runbook.

Recommended agent discipline:

- One branch/worktree per slice.
- No broad rewrites unless the slice explicitly requires it.
- Keep current UI intact unless a backend change forces a UX update.
- Add tests around permission and business-unit scoping before adding more features.
- Use the canonical git author identity already configured for this repo.

First Codex task should not be implementation. It should be a repo-backed technical design slice:

- inspect current app state
- choose Drizzle vs Prisma with reasons
- propose concrete schema files and migration layout
- identify exact files that need to change for Step 1
- produce a small implementation plan for the first code slice

## Recommended Phases

### Phase 1: Foundation

- Pick ORM/migration tool.
- Create Postgres schema.
- Add real users/roles/permissions.
- Add organizations and business units.
- Add activity and audit tables.
- Replace localStorage persistence for core records.
- Keep business-unit scoping and RBAC in Phase 1; do not migrate to Postgres first and retrofit access rules later.

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
- Add CSV/Google Sheets import flow.
- Add dedupe and attribution.
- Add source-to-business-unit mapping.

### Phase 5: Automation

- Add durable workflow engine.
- Add Twilio/email provider integration.
- Add follow-up sequences.
- Add reply/opt-out/bounce handling.
- Add task escalation and reminders.

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
- Every external communication event must be logged back to the CRM.
- Every automated write should be idempotent.

## Open Questions

- Which ORM should be used: Drizzle or Prisma?
- Which workflow engine should be used: Trigger.dev, Temporal, or BullMQ?
- What do the current Google Sheets reveal about actual fields, ownership, dedupe, and business-unit separation?
- Should business-unit membership be per-user only, or also team-based?
- Which data should be shared organization-wide across all business units?
- What should be synced from QuickBooks in V1: customers, estimates, invoices, payments, items/services, or only invoice/payment snapshots?
- Does QuickBooks currently have separate classes/locations/custom fields for the four AIT businesses?

## Final Pre-Implementation Questions

These are the remaining questions before code implementation should start:

1. Can we inspect the current Google Sheets?
2. Which auth direction should V1 use: Auth.js/Better Auth by default, or Clerk for speed?
3. Do we have or want Vercel + Neon + Cloudflare R2 accounts for this project?
4. Does QuickBooks separate the four AIT businesses using classes, locations, custom fields, separate companies, or naming only?
5. Should business-unit membership be assigned directly per user in V1, or should we add teams immediately?
6. Should V1 include QuickBooks read-only snapshot sync, or defer QuickBooks integration until after core CRM + Facebook ingestion?
