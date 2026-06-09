# MIS-157 AIT Signs Import Promotion Dry Run

- Generated at: 2026-06-09T00:42:36.102Z
- Staging branch id: br-broad-hill-aptjpyea
- Current database: neondb
- Host suffix: ep-muddy-frost-apgwqat1-pooler.c-7
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app

## Verdict

- No DB writes were made.
- Do not bulk approve/import the pending AIT Signs Import Review queue as-is.
- 2221 normalized rows already have matching promoted CRM evidence.
- 19 note rows have promoted parent rows but no matching promoted-note event.
- 0 normalized rows were not matched to promoted evidence.
- Current Import Review status is misleading: the normalized rows are still pending even though the CRM promotion evidence already exists for almost all rows.
- Import Review approval for this XLSX batch only marks staging/review statuses; it does not promote AIT Signs CRM records through the UI/API.

## Current Pending Queue

- work_order: 1786
- payment_snapshot: 277
- lead: 65
- estimate: 63
- note: 49

## Current Staging Statuses

- normalized pending: 2240
- review pending: 242

## Promotion Evidence

- already_promoted_do_not_import: 2221
- parent_promoted_note_needs_manual_attach_review: 19

## Recommendation

- Treat the queue as a stale/unfinalized staging review queue, not fresh data waiting to import.
- Next write should be a narrow metadata/status cleanup plan after approval, not a CRM object import.
- Review the 19 unmatched note rows before deciding whether to attach them as notes or leave them held/context-only.
- Do not use the existing bulk promotion script for these pending rows unless idempotence guards are added first.
- Add/import idempotence guards before any future bulk promotion path is trusted.

## Artifacts

- CSV: docs/mis-157-ait-signs-import-promotion-dry-run.csv
- JSON: docs/mis-157-ait-signs-import-promotion-dry-run.json
