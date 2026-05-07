# AIT Signs CRM

A high-performance, professional CRM built for sign shops and operational workflows. Designed for rapid data management, visual lead pipelines, and professional document generation.

## 🚀 Quick Start

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

## ✨ Key Features

### 🏢 Dashboard
- **Live KPIs**: Revenue, Pipeline, Active Orders, and Lead counts.
- **Unified Task List**: Inline task creation with priority and assignment.
- **Calendar Widget**: Track appointments and deadlines.
- **Deterministic Reporting**: Revenue trends and invoice status charts (visualized via custom Canvas implementation).
- **Employee Tracker**: Monitor staff performance and lead assignment.

### 👥 Contacts & Leads
- **Dual Views**: Toggle between a **High-Density Table** and a **Visual Kanban Pipeline**.
- **Kanban Board**: Drag-and-drop leads through stages (New Lead → Won/Lost).
- **Contact Details**: Rich profile pages with:
    - **Activity Timeline**: Chronological record of notes and updates.
    - **Linked Records**: Instant access to all Work Orders and Financials for that contact.
- **Inline Editing**: Double-click any cell in the table view to update data instantly.

### 🛠️ Work Orders
- **Priority Management**: Color-coded High/Medium/Low priority tracking.
- **Status Lifecycle**: Manage jobs from Pending to Completed.
- **PDF Generation**: Professional, client-ready work order documents generated in one click.
- **Status Filtering**: Quickly drill down into active vs. completed jobs.

### 💰 Financials & Billing
- **Full Suite**: Manage Invoices, Estimates, and Receipts.
- **Auto-Calculations**: Dynamic line items with real-time tax and total updates.
- **Document Generation**: High-quality PDFs with company branding and professional layout.

### 🔍 Search & Navigation
- **Command Palette (Cmd+K)**: Instant global search across all records from anywhere in the app.
- **Dark Mode**: Fully themed dark mode with persistence.
- **Toast Notifications**: Real-time feedback for all CRUD operations.
- **Confirm Dialogs**: Custom, themed safety prompts for destructive actions.

## 🏗️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Icons**: Lucide React
- **PDFs**: jsPDF (Client-side)
- **State**: React Context API
- **Persistence**: `localStorage` (Mock data layer)
- **Styling**: Vanilla CSS + CSS Modules + CSS Custom Properties

## 🛡️ Role-Based Access

Toggle roles in the Sidebar to test different permissions:
- **Admin**: Full oversight, reports, and settings access.
- **Employee**: Focused on assigned tasks, leads, and work order execution.

## 📦 Deployment

1. Connect this repo to [Vercel](https://vercel.com).
2. The app is zero-config and will deploy immediately.

## 🗺️ Roadmap
- [ ] **Directus + PostgreSQL Integration**: Move from localStorage to a real database.
- [ ] **CSV Importer**: Bulk import leads from Google Sheets.
- [ ] **File Storage**: Upload sign designs and site survey photos.
- [ ] **Twilio Integration**: Automated SMS follow-ups for new leads.
