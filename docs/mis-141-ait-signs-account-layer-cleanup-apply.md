# MIS-141 AIT Signs Account-Layer Cleanup Apply

- Generated at: 2026-06-08T05:05:19.033Z
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Host: ep-muddy-frost-apgwqat1-pooler...aws.neon.tech
- Database: neondb
- Code journal count: 12

## Before

- client_accounts: 795
- client_account_aliases: 0
- client_people: 0
- client_contact_methods: 686
- client_locations: 0
- contacts.client_account_id column existed: true
- linked contacts: 795
- latest migration id before: 13

## After

- account-layer tables exist: client_accounts=false, client_account_aliases=false, client_people=false, client_contact_methods=false, client_locations=false
- contacts.client_account_id column exists: false
- latest migration id after: 12

## Notes

- Raw row export was written outside the repo before cleanup because it contains contact data.
- This cleanup did not delete normal AIT Signs contacts or operational records.
- It removed only the abandoned account-layer schema/data created by the superseded staging branch.
