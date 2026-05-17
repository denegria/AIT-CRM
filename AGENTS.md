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

## 🛣️ Current V1 Direction
1. **Postgres is the source of truth**: keep live reads/writes on the Drizzle/Postgres path. Local seed data is fallback only when no database is configured.
2. **Import Review is the safety gate**: staged AIT Signs rows must be approved before promotion. Do not bypass review for ambiguous rows.
3. **Website leads are webhook-backed**: non-Meta website forms use `/api/webhooks/website-leads`. Wix-style top-level `data` payloads and body-secret fields are supported; secret fields must stay redacted.
4. **V1 boundaries**: QuickBooks, automated outbound follow-up, WordPress/Divi lead capture, and file attachments are not launch blockers. Attachments require object storage setup first.

## ✅ Import Review Approval
- Use `npm run db:review-ait-signs-staging summary` to inspect the current batch before approving anything.
- Use `npm run db:review-ait-signs-staging samples --limit 10` to spot-check row examples and the normalized output.
- Approve a staged row with `npm run db:review-ait-signs-staging approve-row --sheet "Sheet Name" --row 123 --reason "clean match"`.
- Reject a staged row with `npm run db:review-ait-signs-staging reject-row --sheet "Sheet Name" --row 123 --reason "bad match"`.
- In the app, the same queue lives at `/import-review`; approve from the row actions or the bulk approve button after unlocking access.
- Only rows with `approved` status are promoted into production tables. Leave ambiguous rows as `needs_review` or reject them instead of forcing a bad match.
- Run `npm run db:promote-ait-signs-staging --dry-run` before a real promotion.
