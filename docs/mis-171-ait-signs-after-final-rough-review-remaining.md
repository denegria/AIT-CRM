# MIS-169 AIT Signs Post-approval Remaining Review

- Generated at: 2026-06-09T16:40:29.515Z
- Input: `docs/mis-167-ait-signs-source-row-validation-packet.json`
- DB writes: none

## Summary

- Input review rows: 66
- Remaining rows: 37
- Resolved/skipped rows: 29

### By Rough Match Bucket

- no_rough_match: 29
- review_low_rough_client_match: 8

### By Validation Bucket

- manual_name_only_ambiguous: 8
- manual_no_exact_match: 29

## Notes

- Rough matches are suggestions only; they do not approve merges or imports.
- Contact/person-name-only evidence remains manual unless Alvaro approves a target.
- Current DB status is read live from staging after MIS-168.
