# ✨ AIT CRM

A high-density, professional CRM built for rapid data editing, lead management, staged import review, and operational document generation.

For the strategic goals and non-negotiable constraints, read [goals and constraints.md](./goals%20and%20constraints.md).

## Features

### 📊 Dashboard
- KPI cards for revenue, pipeline value, active work orders, and new leads
- Task list with priorities, due dates, and inline task creation
- Calendar widget with color-coded event indicators
- Revenue trend chart for monthly performance
- Invoice status breakdown for paid, pending, and overdue work
- Employee progress tracking for admin visibility

### 👥 Contacts & Leads
- High-density sortable and filterable data table
- Inline editing for fast cleanup and updates
- Lead status tracking from new lead to won or lost
- Lead source tracking for Facebook Ads, Website, Referral, Cold Call, and Google Ads
- Drawer-style forms for add and edit flows

### 🧾 Work Orders
- Priority-based work order management
- Status tracking from pending to in progress, completed, or on hold
- One-click PDF generation for professional documents
- Client and employee assignment

### 💰 Financials
- Tabbed interface for invoices, estimates, and receipts
- Line item editing with auto-calculated totals
- Status badges for draft, pending, paid, and overdue
- One-click PDF generation for financial documents
- Professional document templates with headers and line items

### 📈 Reports
- Monthly financial snapshot with KPI cards
- Revenue by month chart
- Invoice status breakdown chart
- Lead source analysis
- Quick stats like conversion rate and average invoice value
- CSV export for financial data

### ✅ Import Review
- Staged AIT Signs rows are reviewed before promotion into production tables
- Approve or reject rows from the `/import-review` screen or the CLI
- Use the summary and sample commands to inspect a batch before approving
- Only `approved` rows are promoted; ambiguous rows stay in review or are rejected

### ⚙️ Settings
- Webhook configuration for Facebook Ads and Google Ads endpoints
- Automation rules overview
- API access configuration
- Role-based access control management
- Data reset functionality

## 👤 Role-Based Views

Toggle between **Admin** and **Employee** views using the sidebar toggle:

- **Admin**: full access to all data, reports, employee tracking, and financial oversight
- **Employee**: personal tasks, assigned leads, and document generation

## 🛠️ Tech Stack

- **Framework**: Next.js 16 App Router
- **UI**: React 19
- **Database**: Postgres
- **ORM/Migrations**: Drizzle
- **Icons**: Lucide React
- **PDFs**: jsPDF

## 🚀 Development

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

## 🔄 Import Workflow

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
