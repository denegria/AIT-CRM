# MIS-167 AIT Signs Source-Row Validation Packet

- Generated at: 2026-06-09T14:26:27.896Z
- Refined input: `docs/mis-166-ait-signs-refined-residual-approval.json`
- Held packet input: `docs/mis-165-ait-signs-held-residual-review-packet.json`
- DB writes: none
- CRM/source/schema changes: none
- First CSV column is intentionally blank: `alvaro_decision`.

## Summary

- Total rows: 79

### By Validation Bucket

- manual_name_only_ambiguous: 13
- create_or_promote_plan: 8
- approve_status_only_existing_evidence: 3
- manual_rejectable_noise_review: 1
- approve_reject_or_ignore_source_checked: 12
- manual_no_exact_match: 32
- manual_exact_client_match_review: 10

### By Workflow Recommendation

- hold_name_only_not_enough: 13
- create_note_candidate: 1
- approve_status_only_cleanup: 3
- review_reject_or_ignore: 1
- reject_noise_candidate: 9
- reject_or_ignore_sheet12_debris: 3
- hold_no_safe_target: 32
- create_record_candidate: 7
- review_status_or_note_attach: 10

## Rules Encoded

- Original workbook row is treated as the primary review surface.
- Exact client/business-name matches are stronger than contact/person-name matches.
- Exact phone/email matches are contact-point evidence, not automatic client-merge evidence.
- Contact/person-name-only matches stay manual.
- Create-note/create-record candidates are kept out of cleanup writes.
