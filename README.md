# AIT CRM

AIT CRM is a custom business operations CRM for AIT's multi-business setup. It starts with AIT Signs, but the app is built to support multiple business units, staged import review, business-unit-aware permissions, Postgres-backed sessions, and operational reporting.

For the strategic goals and non-negotiable constraints, read [goals and constraints.md](./goals%20and%20constraints.md).

## What's In The App

- Dashboard with KPI cards, task tracking, calendar, revenue trends, and invoice status summaries.
- Contacts and leads with high-density tables, detail pages, Kanban flow, and inline editing.
- Work orders with priority/status tracking, assignment, and PDF generation.
- Financials for invoices, estimates, and receipts with line-item editing and document output.
- Import review for staged AIT Signs rows, with approve/reject handling before promotion into production tables.
- Postgres-backed auth with secure sessions, logout, and role-based access control.
- Business-unit-aware data access for admins, account managers, sales managers, and designers.
- Contacts CRUD backed by the server instead of local-only mock data.

## Tech Stack

- Next.js 16 App Router
- React 19
- Postgres
- Drizzle ORM and migrations
- Lucide React icons
- jsPDF for document generation

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
npm run db:load-ait-signs-staging
npm run db:review-ait-signs-staging
npm run db:promote-ait-signs-staging
npm run db:bootstrap-auth-user
npm run db:generate
npm run db:migrate
```

Database commands require `DATABASE_URL`.

For database-backed app sessions, set `AIT_CRM_SESSION_SECRET`, run migrations, then bootstrap the first admin:

```bash
AIT_CRM_BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
AIT_CRM_BOOTSTRAP_ADMIN_PASSWORD='change-me' \
npm run db:bootstrap-auth-user
```

## Import Workflow

The staged AIT Signs import is reviewed row by row before promotion.

1. Load or refresh staging data with `npm run db:load-ait-signs-staging`.
2. Inspect the queue with `npm run db:review-ait-signs-staging summary` or the `/import-review` screen.
3. Approve a row with either the UI Approve action or the CLI:

```bash
npm run db:review-ait-signs-staging approve-row --sheet "Sheet Name" --row 123 --reason "clean match"
```

4. Use `needs_review` or reject the row if the mapping is unclear.
5. Promote only approved rows with `npm run db:promote-ait-signs-staging`.

Import review also accepts the temporary `AIT_CRM_ADMIN_TOKEN` path for internal unlocks until app-owned auth/RBAC covers every case.
