# AIT CRM

A high-density, professional CRM built for rapid data editing, lead management, and operational document generation.

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Production build
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Features

### Dashboard
- **KPI Cards**: Total Revenue, Pipeline Value, Active Work Orders, New Leads
- **Task List**: Aggregated to-dos with priorities, due dates, and inline task creation
- **Calendar Widget**: Monthly view with color-coded event indicators
- **Revenue Trend**: Bar chart showing monthly revenue
- **Invoice Status**: Donut chart breakdown (Paid / Pending / Overdue)
- **Employee Progress**: Admin-only tracker for staff task completion

### Contacts & Leads
- High-density sortable/filterable data table
- Inline editing (double-click any editable cell)
- Lead status tracking: New Lead → Contacted → Qualified → Proposal Sent → Won/Lost
- Lead source tracking: Facebook Ads, Website, Referral, Cold Call, Google Ads
- Drawer-style forms for add/edit

### Work Orders
- Priority-based work order management (High/Medium/Low)
- Status tracking: Pending → In Progress → Completed / On Hold
- One-click PDF generation for professional work order documents
- Client and employee assignment

### Financials
- **Tabbed Interface**: Invoices | Estimates | Receipts
- Line item editing with auto-calculated totals
- Status badges: Draft, Pending, Paid, Overdue
- One-click PDF generation for all document types
- Professional PDF templates with company header and line items

### Reports
- Monthly financial snapshot with KPI cards
- Revenue by month bar chart
- Invoice status breakdown (pie chart)
- Lead source analysis
- Quick stats: Conversion rate, avg invoice value, etc.
- **CSV export** for financial data

### Settings
- Webhook configuration panel (Facebook Ads, Google Ads endpoints)
- Automation rules overview
- API access configuration
- Role-based access control management
- Data reset functionality

## Role-Based Views

Toggle between **Admin** and **Employee** views using the sidebar toggle:

- **Admin**: Full access to all data, reports, employee tracking, financial oversight
- **Employee**: Personal tasks, assigned leads, document generation

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **State Management**: React Context with localStorage persistence
- **PDF Generation**: jsPDF (client-side)
- **Charts**: Custom Canvas-based (zero dependencies)
- **Styling**: CSS Modules + CSS Custom Properties
- **Font**: Inter (Google Fonts)

## Deploying to Vercel

1. Push this repo to GitHub
2. Import the repo in [Vercel Dashboard](https://vercel.com/new)
3. Deploy — no configuration needed

## Data

The app ships with 15 contacts, 8 work orders, 13 financial records, 8 tasks, and 10 calendar events as demo data. All data persists in localStorage across sessions. Use **Settings → Reset Data** to restore defaults.
