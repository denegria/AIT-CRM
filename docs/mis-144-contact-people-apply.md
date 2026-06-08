# MIS-144 Contact People Apply

- Generated at: 2026-06-08T05:30:44.246Z
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Host: ep-muddy-frost-apgwqat1-pooler...aws.neon.tech
- Database: neondb

## Migration

- File: drizzle/0012_contact_people.sql
- Table: contact_people
- Latest Drizzle migration id after apply: 14
- Note: Migration id sequence skipped 13 because the abandoned account-layer migration had previously consumed that id before cleanup.

## Validation

- node schema import confirmed contactPeople is exported through allTables
- node --check src/app/api/contacts/[id]/people/route.js passed
- npm run lint passed
- npm run build passed and included /api/contacts/[id]/people
- Authenticated local API smoke on BLUE MOUNTAIN created, patched, and deleted a temporary linked person row
