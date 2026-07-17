# AIT CRM

AIT CRM is a private, multi-business operations platform for AIT. It combines customer records, lead and task workflows, class enrollment and attendance, work-order operations, controlled data imports, communications, and role-based administration in one application.

The product is designed around AIT's operating rules rather than a generic CRM template: organization and business-unit boundaries, auditable changes, staged imports, scoped employee access, and reliable source attribution are first-class concerns.

![Active Classes overview showing sessions, roster, and session notes](./docs/images/active-classes-overview.png)

> Screenshots in this repository use synthetic staging records. They contain no customer phone numbers, email addresses, or other private contact data.

## Product capabilities

- **Contacts and pipeline** — searchable customer records, lead stages, attribution, notes, and activity history.
- **Tasks and team coordination** — assigned work, priorities, due dates, follow-up context, and senior-level monitoring.
- **Active Classes** — class-first navigation, roster access, dated sessions, session notes, and fast attendance marking.
- **AIT Signs operations** — work orders, estimates, operational financial snapshots, and generated documents.
- **Import review** — staged, traceable data review before approved records are promoted into CRM tables.
- **Inbound lead capture** — website and Meta ingestion with explicit business-unit routing and audit metadata.
- **Administration** — account-managed roles, business-unit memberships, settings, reports, and operational diagnostics.

Feature visibility is determined by the deployed release channel, the selected business unit, and server-enforced permissions.

## Architecture

- Next.js 16 App Router and React 19
- PostgreSQL on Neon as the system of record
- Drizzle ORM and versioned SQL migrations
- Server-side service and policy layers for business behavior
- Vercel deployments with separate staging and production branches
- Provider adapters for website, Meta, SMS, and other external integrations

The application intentionally keeps product rules in the CRM. Authentication establishes identity; the server independently enforces organization, business-unit, role, and action scope.

## Security and data integrity

- Secrets are supplied through local or hosted environment variables and are never committed.
- Sensitive routes authorize every request on the server; UI visibility is not treated as authorization.
- Imports retain source references and review decisions for audit and recovery.
- Destructive or ambiguous data operations are rehearsed against staging or isolated database branches first.
- Attendance and other concurrent workflows use revision checks to prevent stale browser tabs from silently overwriting newer changes.
- Production changes follow explicit validation and promotion gates.

See [goals and constraints.md](./goals%20and%20constraints.md) for the product boundaries behind these decisions.

## Local development

Requirements:

- Node.js compatible with Next.js 16
- npm
- PostgreSQL for database-backed development

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Core validation commands:

```bash
npm run lint
npm run build
npm run verify:rbac
```

Database commands:

```bash
npm run db:generate
npm run db:migrate
```

Database-backed commands require `DATABASE_URL`. Authentication and integration credentials must also be supplied through environment variables. Ask a project administrator for the approved environment configuration; do not copy credentials into documentation, issue comments, or source files.

## Release model

- `staging` is the QA lane and auto-deploys to the protected staging environment.
- `master` is the production lane and is promoted only after staging acceptance and explicit approval.
- Database migrations are verified against the intended Neon branch before application.
- Production data is never used as screenshot or fixture data.

Operational release, rollback, and recovery procedures are documented in the [production runbook](./docs/production-runbook.md).

## Documentation

- [User guide](./USER_GUIDE.md)
- [Product goals and constraints](./goals%20and%20constraints.md)
- [Production runbook](./docs/production-runbook.md)
- [V1 operator and administrator handoff](./docs/v1-handoff.md)
- [V2 execution plan](./docs/v2-plan.md)

## Product boundaries

- QuickBooks remains the accounting source of truth; CRM financial records provide operational context rather than a replacement ledger.
- Files require approved object storage and do not belong in PostgreSQL.
- Historical attendance is not imported. Attendance begins with the dedicated class-session workflow.
- Automated outreach must preserve consent, attribution, audit history, owner routing, and stop conditions.
- Uncertain imports and identity matches remain held for human review instead of being forced into production.
