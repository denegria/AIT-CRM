# AIT CRM

AIT CRM is a custom all-in-one business operations system for AIT's multi-business organization. It starts with AIT Signs, but the product is being built to support multiple business units under one account, shared customer history, staged data migration, real permissions, operational reporting, and future lead ingestion/automation.

This is not intended to be a wrapper around a generic CRM. The product should own the business rules that matter: business-unit scoping, employee roles, customer/job history, import review, lead attribution, activity timelines, and operational workflows.

## Product Goals

- Give AIT one operational source of truth across AIT Signs, AIT USA Institute, AIT Photo & Video, and AIT Taxes.
- Replace spreadsheet-driven work tracking with structured contacts, leads, estimates, work orders, files, notes, tasks, payments snapshots, and activity history.
- Preserve business-unit separation while still allowing consolidated organization-level reporting.
- Make lead ingestion from Facebook, website forms, spreadsheets, and future sources reliable, traceable, and reviewable.
- Support role-specific workflows for administrators, designers, account managers, and sales managers.
- Keep historical Spanish spreadsheet notes and source rows traceable instead of flattening them into lossy fields.
- Build toward automated follow-up and communication workflows after the CRM data foundation is trustworthy.

## First Client Context

The first production target has four business units:

1. AIT Signs
2. AIT USA Institute
3. AIT Photo & Video
4. AIT Taxes

AIT Signs is the first implementation focus. Its existing source data comes from spreadsheet exports with lifecycle tabs for prospects, estimates, active work orders, and completed/paid work. The data is messy and Spanish-first, with duplicate contacts, freeform follow-up notes, payment fields, status legends, and spreadsheet artifacts.

The migration is product work, not a one-time CSV load. Raw rows need to be staged, classified, reviewed, and promoted into normalized CRM records only after they are understood.

## Core Constraints

- AIT CRM must be a custom CRM/business system, not a thin integration around HubSpot, GoHighLevel, or another prebuilt CRM.
- Directus may be useful as a temporary admin/data accelerator, but it must not own core CRM permissions, business-unit rules, ingestion logic, or automation behavior.
- Business units are real relational records, not tags. Records that are operationally scoped should carry `organization_id` and usually `business_unit_id`.
- Contacts can be organization-level and may have a primary business unit, while leads, jobs/work orders, estimates, campaigns, messages, tasks, files, and financial snapshots are usually business-unit scoped.
- Authentication proves identity; AIT CRM owns authorization through app-controlled roles, permissions, organization scope, business-unit scope, assignment, and ownership.
- Clerk is not the default auth choice because the project should avoid unnecessary vendor cost and complexity unless polished hosted user management becomes more valuable than owning the auth path.
- QuickBooks remains the accounting source of truth for V1. AIT CRM can store invoice/payment visibility and estimate context, but it should not try to become a full accounting ledger.
- Files should live in object storage, with metadata and permissions in Postgres. File blobs should not live in the database.
- Secrets belong in hosting/provider dashboards or local environment variables, never in committed files.

## Data And Import Constraints

- Preserve raw source rows, sheet names, source row numbers, and original Spanish text for traceability.
- Normalize phones first and use them as a strong dedupe signal, but do not blindly merge every matching phone without review.
- Treat spreadsheet status labels and legends as business vocabulary that needs mapping, not as noise.
- Convert repeated follow-up columns into timeline/activity records.
- Convert payment, tax, total, advance, and balance fields into financial snapshots tied to estimates or work orders. They are operational snapshots, not authoritative accounting records.
- Route uncertain mappings, malformed rows, duplicate candidates, conflicting financial values, and unclear Spanish notes to a human review queue.
- The app should support rollback or re-run behavior for import batches before production use.

## Architecture Direction

- Next.js app for the CRM product UI.
- Postgres as the source of truth.
- Drizzle for schema and migrations.
- Custom API/server layer for product behavior.
- Custom internal admin screens inside the CRM.
- Vercel for the Next.js app and route handlers.
- Neon Postgres for managed database hosting.
- Cloudflare R2 or another S3-compatible store for files and attachments.
- Durable workflows later for follow-up, ingestion retries, reminders, and automation.
- SMS, email, voice, Meta/Facebook, and QuickBooks should be provider integrations, not the core product brain.

## Permission Model

V1 should keep the role set aligned with the current CRM prototype:

- `admin`
- `designer`
- `account_manager`
- `sales_manager`

Permissions should be granular and composable. Access checks should consider organization, business unit, role, assignment, record ownership, and sensitive field permissions.

Example behavior:

- Admins see all business units.
- Sales managers see sales activity, assigned teams/leads, and business-unit scoped performance.
- Account managers see assigned contacts, customer activity, and follow-up work.
- Designers see design/job-related work assigned to them with restricted financial and settings access.

## Automation Boundaries

Automation is part of the product direction, but it should come after the data foundation is reliable.

The CRM should eventually support:

- Facebook Lead Ads ingestion
- website form ingestion
- lead/contact dedupe
- source and campaign attribution
- SMS/email follow-up
- task assignment
- pause-on-reply, booked, or opt-out behavior
- reminders and escalation rules
- activity and audit logging for every automated action

The near-term product should prioritize trustworthy data, import review, business-unit scoping, and manual operations before automated outreach.

## Build And Operating Constraints

- Keep the current UI stable while the data layer moves from generated/local data to Postgres-backed reads and writes.
- Prefer small, reviewable implementation slices over broad rewrites.
- Track concrete work in Linear and keep this repo/docs aligned with the source-of-truth plan.
- Use GitHub for code history, branches, pull requests, and review evidence.
- Use Codex as the coding harness and Symphony-style routing for issue-driven execution when that path is appropriate.
- Do not push or deploy sensitive changes without a validation checkpoint.

## Current Technical Baseline

- Framework: Next.js 16 App Router
- UI: React 19
- Icons: Lucide React
- PDFs: jsPDF
- Database: Postgres
- ORM/migrations: Drizzle
- Current fallback state: sanitized demo records are used only when no database is configured; live empty databases should stay empty until import staging is loaded
- Live database status: the initial Drizzle schema has been applied to Neon, but the production bootstrap/import data still needs to be loaded

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful commands:

```bash
npm run lint
npm run build
npm run profile:ait-signs
npm run import:ait-signs-staging
npm run seed:ait-signs
npm run db:generate
npm run db:migrate
```

Database commands require `DATABASE_URL` in the environment.
