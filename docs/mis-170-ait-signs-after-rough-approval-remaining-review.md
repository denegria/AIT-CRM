# MIS-169 AIT Signs Post-approval Remaining Review

- Generated at: 2026-06-09T16:02:14.822Z
- Input: `docs/mis-167-ait-signs-source-row-validation-packet.json`
- DB writes: none

## Summary

- Input review rows: 66
- Remaining rows: 40
- Resolved/skipped rows: 26

### By Rough Match Bucket

- no_rough_match: 31
- review_medium_rough_client_match: 1
- review_low_rough_client_match: 8

### By Validation Bucket

- manual_no_exact_match: 31
- manual_name_only_ambiguous: 9

## Notes

- Rough matches are suggestions only; they do not approve merges or imports.
- Contact/person-name-only evidence remains manual unless Alvaro approves a target.
- Current DB status is read live from staging after MIS-168.
