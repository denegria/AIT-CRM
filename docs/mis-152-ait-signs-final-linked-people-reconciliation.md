# MIS-152 AIT Signs Final Linked-People Reconciliation

- Generated at: 2026-06-08T21:29:21.823Z
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Verdict

- Missing latest-source linked people: 0
- Remaining held business-review rows with person inserts at stake: 0
- Remaining no-person business-name holds: 64
- Recommended next action: Stop linked-person data writes and return to MIS-124 account/client-layer design work.

## Current Source Passes

- Exact linked people: 0 planned, 637 existing skipped, 0 applied in dry-run.
- Pass 1 linked people: 0 planned, 5 existing skipped, 0 blocked.
- Remaining spelling linked people: 0 planned, 6 existing skipped, 0 blocked.
- Business-held linked people: 0 planned, 15 existing skipped, 0 blocked.
- Shared-contact current review: 0 planned inserts across 261 reviewed candidates.
- Current remaining-spelling approval view: 0 recommended apply rows, 0 held potential people after de-dupe.

## DB Source Labels

- ait_signs_estimate_exact_backfill: 636 rows, 549 contacts, 549 primary rows.
- ait_signs_pass1_latest_source_linked_people: 5 rows, 5 contacts, 0 primary rows.
- ait_signs_remaining_spelling_latest_source_linked_people: 6 rows, 6 contacts, 0 primary rows.
- ait_signs_business_held_latest_source_linked_people: 15 rows, 14 contacts, 0 primary rows.

## JCL State

- JC AND L LANDSCAPING (3a67a554-f5d0-4793-b96f-8ca80d87b231)

## Artifacts

- exactCurrent: docs/mis-152-ait-signs-exact-linked-people-current-idempotence.json
- pass1Current: docs/mis-152-ait-signs-pass1-current-idempotence.json
- remainingSpellingCurrent: docs/mis-152-ait-signs-remaining-spelling-current-idempotence.json
- businessHeldCurrent: docs/mis-151-ait-signs-business-held-linked-people-idempotence.json
- sharedCurrent: docs/mis-152-ait-signs-shared-contact-current-review.json
- remainingSpellingApprovalCurrent: docs/mis-152-ait-signs-remaining-spelling-current-approval.json
- Current remaining no-person business holds CSV: docs/mis-152-ait-signs-remaining-spelling-current-approval.csv
