# MIS-159 AIT Signs Residual Import Review Buckets

- Generated at: 2026-06-09T05:30:07.376Z
- No DB writes in this residual export.

## Summary

- Total residual rows: 106
- Visible normalized pending rows: 19
- Pending review-item-only rows: 87

## Buckets

- follow_up_note_attach_or_hold: 19
- identityless_financial_line: 5
- loose_follow_up_or_context_text: 74
- review_only_follow_up_note: 5
- review_only_record_candidate: 3

## Recommendation

- Do not attack the parser for this one-off cleanup. The parser preserved noisy/context rows because the workbook mixes headers, follow-up text, financial totals, and records in the same sheets.
- Treat headers/section labels and identityless financial lines as safe ignore/reject candidates after approval.
- Review loose follow-up/context text, review-only notes, record candidates, and the 19 normalized notes as the only meaningful remainder.
