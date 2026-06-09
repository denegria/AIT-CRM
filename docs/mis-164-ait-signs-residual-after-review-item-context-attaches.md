# MIS-159 AIT Signs Residual Import Review Buckets

- Generated at: 2026-06-09T06:09:43.387Z
- No DB writes in this residual export.

## Summary

- Total residual rows: 79
- Visible normalized pending rows: 3
- Pending review-item-only rows: 76

## Buckets

- follow_up_note_attach_or_hold: 3
- identityless_financial_line: 5
- loose_follow_up_or_context_text: 67
- review_only_follow_up_note: 1
- review_only_record_candidate: 3

## Recommendation

- Do not attack the parser for this one-off cleanup. The parser preserved noisy/context rows because the workbook mixes headers, follow-up text, financial totals, and records in the same sheets.
- Treat headers/section labels and identityless financial lines as safe ignore/reject candidates after approval.
- Review loose follow-up/context text, review-only notes, record candidates, and the 19 normalized notes as the only meaningful remainder.
