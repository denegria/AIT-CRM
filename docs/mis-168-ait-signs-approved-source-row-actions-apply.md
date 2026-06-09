# MIS-168 AIT Signs Approved Source-row Actions

- Generated at: 2026-06-09T15:17:06.150Z
- Mode: apply
- DB writes: approved source-row actions only

## Summary

- Approved rows: 12
- Primary actions: mark_normalized_imported=1, mark_review_item_imported=2, create_note=1, create_estimate=2, create_work_order=4, reassign_existing_work_order=1, reassign_existing_estimate=1
- Review-item updates: 9
- Normalized-record updates: 3
- Contacts created: 5
- People created: 7
- Estimates created: 2
- Work orders created: 4
- Notes created: 2
- PHT duplicate contacts deleted: 2

## Guardrails

- Existing source-row activity is reused or reassigned instead of duplicated.
- Status-only rows do not create CRM records.
- Contact people are de-duped by contact, normalized name, and phone.
- PHT merge moves references into `PHT CONTRACTOR` before deleting duplicate shells.
