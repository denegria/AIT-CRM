# MIS-166 AIT Signs Refined Residual Approval Packet

- Generated at: 2026-06-09T14:13:55.768Z
- Input: `docs/mis-165-ait-signs-held-residual-review-packet.json`
- DB writes: none
- CRM/source/schema changes: none
- First CSV column is intentionally blank: `alvaro_decision`.

## Summary

- Total rows: 79

### By Approval Bucket

- manual_review: 56
- create_note_or_record_candidates: 8
- approve_status_only_candidates: 3
- approve_reject_or_ignore_candidates: 12

### By Recommendation

- hold_for_human_direction: 6
- create_note_candidate: 1
- attach_status_only_candidate: 3
- hold_identity_bearing_no_crm_match: 2
- reject_noise_candidate: 9
- reject_or_ignore_sheet12_debris: 3
- create_record_candidate: 7
- hold_ambiguous_attach_target: 5
- hold_legacy_info_followup_no_exact_match: 43

## Notes

- Sheet12 rows are treated as non-authoritative debris and should not create CRM records.
- Exact phone/email matches can become status-only attach candidates, but name-only matches stay manual review.
- Create-note/create-record candidates are separated from status-only cleanup candidates.
