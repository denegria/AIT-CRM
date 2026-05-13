# ✨ AIT Signs CRM — Developer Guidelines

## 🎯 Project Principles
- **Speed & Density**: Keep UI elements compact. Use `text-sm` for most content.
- **Visual Feedback**: Every action should trigger a `toast` or a `ConfirmDialog`.
- **Custom Design System**: Avoid external UI libraries (Tailwind/MUI). Use the variables in `globals.css` and CSS Modules.

## 🧩 Key Files & Patterns
- **State Management**: `src/lib/store.js` houses the `CRMProvider`. All data mutations happen here via `useCRM`.
- **Tables**: Use `src/components/DataTable.js`. It handles sorting, searching, and inline editing via the `columns` schema.
- **Pipeline**: `src/components/KanbanBoard.js` uses native drag-and-drop.
- **PDFs**: `src/lib/pdf.js` uses `jsPDF`. All generators should be wrapped in `try/catch`.
- **Search**: `src/components/CommandPalette.js` is the global entry point via `Cmd+K`.

## 🎨 Design Tokens
Refer to `src/app/globals.css` for:
- `--bg-primary`, `--bg-secondary` (Base layers)
- `--accent`, `--success`, `--danger` (Semantic colors)
- `--shadow-md`, `--radius-lg` (Elevation & Corners)

## 🛣️ Roadmap for Next Agent
1. **Directus Integration**: Transition from `localStorage` to a Dockerized PostgreSQL + Directus backend.
2. **CSV Import**: Build a mapper in `src/app/contacts/import/page.js` for Google Sheets data.
3. **Mobile Polish**: Enhance the bottom nav behavior for mobile screen widths.

## ✅ Import Review Approval
- Use `npm run db:review-ait-signs-staging summary` to inspect the current batch before approving anything.
- Use `npm run db:review-ait-signs-staging samples --limit 10` to spot-check row examples and the normalized output.
- Approve a staged row with `npm run db:review-ait-signs-staging approve-row --sheet "Sheet Name" --row 123 --reason "clean match"`.
- Reject a staged row with `npm run db:review-ait-signs-staging reject-row --sheet "Sheet Name" --row 123 --reason "bad match"`.
- In the app, the same queue lives at `/import-review`; approve from the row actions or the bulk approve button after unlocking access.
- Only rows with `approved` status are promoted into production tables. Leave ambiguous rows as `needs_review` or reject them instead of forcing a bad match.
