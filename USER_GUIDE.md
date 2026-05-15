# AIT Signs CRM — User & Admin Guide

Welcome to the AIT Signs CRM! This guide will help you navigate the system and manage your shop's operations efficiently.

---

## 🧭 Navigation & Interface

### **The Sidebar**
- **Dashboard**: Your daily bird's-eye view of revenue, tasks, and calendar.
- **Contacts**: Where all your leads and clients live.
- **Import Review**: Stage and review incoming rows before they are promoted.
- **Work Orders**: Track the production and installation of signs.
- **Financials**: Admin-only sample/demo surface (not a v1 production workflow).
- **Reports**: Admin-only sample/demo surface (not a v1 production workflow).
- **Settings**: Configure automation and system preferences.

### **Pro Tips**
- 🔍 **Global Search**: Press `Cmd + K` (or `Ctrl + K`) to quickly find any contact or invoice from anywhere in the app.
- 🌓 **Dark Mode**: Use the toggle at the bottom of the sidebar to switch between Light and Dark mode.
- 🔔 **Notifications**: Watch the bottom right for "Toasts" that confirm your actions (Saved, Deleted, etc.).
- 🛡️ **Export Restrictions**: Data exports (CSV) are restricted to **Administrators** only.

---

## 👥 Managing Contacts & Leads

### **Table vs. Pipeline View**
On the Contacts page, use the icons in the top right to switch views:
1.  **List View (Table)**: Best for bulk viewing and sorting data. **Double-click** any name or email to edit it directly in the table.
2.  **Pipeline View (Kanban)**: Best for managing leads. Click and drag a card to move a lead through the stages (New Lead → Won).

**Filtering**: Use the status dropdown at the top to filter contacts by stage (e.g., show only "Qualified" leads). This works in both Table and Kanban views.

### **Contact Details**
Click **"View"** on any contact to open their profile. Here you can:
- View their entire **Activity Timeline**.
- Add a new **Note** about a recent phone call or meeting.
- See all **Work Orders** and **Invoices** linked specifically to that person.

---

## 🛠️ Work Orders & Document Generation

### **Managing Jobs**
- Click **"+ New Work Order"** to start a job.
- Assign a **Priority** (High/Medium/Low) to keep your team focused on urgent installs.
- Use the **Status Filter** at the top to find "In Progress" or "Pending" orders.

### **Generating PDFs**
Professional documents are just one click away:
- In Work Orders or Financials, click the **"PDF"** button.
- The system will instantly generate a professional document with the AIT Signs header and all relevant details.

---

## ✅ Import Review Safety

- Use **Import Review** to set row status (`approved`, `needs_review`, `rejected`, `pending`).
- Approving rows is safe: it updates staged review status only.
- Production CRM tables are written only when promotion is run.
- Recommended sequence:
  1. Approve only clear rows.
  2. Keep uncertain rows in `needs_review`.
  3. Run a promotion dry run first.
  4. Promote approved rows.

---

## 💰 Financials & Reports (v1 Note)

- These pages are intentionally limited in v1 and currently serve as admin-only sample/demo surfaces.
- They are visible to administrators and hidden/restricted for non-admin users.
- Core v1 operational work should prioritize Contacts, Import Review, and Work Orders.

---

## 🛡️ Admin vs. Employee Roles

Roles are account-based (not a sidebar toggle in database-backed sessions):
- **Administrators**: See global revenue, track all employee progress, and have full access to Reports, Settings, and Data Exports.
- **Account Managers / Sales Managers / Designers**: Focused on their specific operational tasks. Settings, high-level financial reports, and data exports are restricted.

---

## 🆘 Troubleshooting & Support

- **Data Reset**: In local/demo mode, use **Settings → Reset Data** to restore defaults.
- **Database-backed sessions**: Data is stored in Postgres; browser local data reset does not control production records.
