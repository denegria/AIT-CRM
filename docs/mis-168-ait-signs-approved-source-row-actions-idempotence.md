# MIS-168 AIT Signs Approved Source-row Actions

- Generated at: 2026-06-09T15:17:25.797Z
- Mode: dry-run
- DB writes: none

## Summary

- Approved rows: 12
- Primary actions: already_imported=3, already_promoted_note=1, already_promoted_estimate=2, already_promoted_work_order=4, already_assigned_work_order=1, already_assigned_estimate=1
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
