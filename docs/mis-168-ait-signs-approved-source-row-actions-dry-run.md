# MIS-168 AIT Signs Approved Source-row Actions

- Generated at: 2026-06-09T15:16:49.666Z
- Mode: dry-run
- DB writes: none

## Summary

- Approved rows: 12
- Primary actions: mark_normalized_imported=1, mark_review_item_imported=2, create_note=1, create_estimate=2, create_work_order=4, reassign_existing_work_order=1, reassign_existing_estimate=1
- Review-item updates: 0
- Normalized-record updates: 0
- Contacts created: 0
- People created: 0
- Estimates created: 0
- Work orders created: 0
- Notes created: 0
- PHT duplicate contacts deleted: 0

## Guardrails

- Existing source-row activity is reused or reassigned instead of duplicated.
- Status-only rows do not create CRM records.
- Contact people are de-duped by contact, normalized name, and phone.
- PHT merge moves references into `PHT CONTRACTOR` before deleting duplicate shells.
