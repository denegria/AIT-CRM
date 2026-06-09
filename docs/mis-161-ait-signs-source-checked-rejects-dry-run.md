# MIS-161 AIT Signs Source-checked Rejects

- Generated at: 2026-06-09T05:28:23.794Z
- Mode: dry-run
- DB writes: none

## Summary

- Target source-checked clean rejects: 130
- Matched pending review items: 130
- Missing pending review items: 0
- Updated rows: 0
- Target buckets: financial_line=25, misc_text=97, note=8

## Guardrail

- Only rows with `crosscheckVerdict=reject_source_row_has_no_identity_fields` are eligible.
- Rows with original workbook customer/contact/phone/email fields are excluded.
- Rows with normalized records are excluded.
- No CRM records, contacts, clients, work orders, payments, estimates, leads, notes, source rows, or schema are changed.
