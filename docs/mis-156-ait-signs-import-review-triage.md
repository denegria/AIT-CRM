# MIS-156 AIT Signs Import Review Triage

- Generated at: 2026-06-09T00:12:10.777Z
- Staging branch id: br-broad-hill-aptjpyea
- Current database: neondb
- Host suffix: ep-muddy-frost-apgwqat1-pooler.c-7
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app

## Verdict

- No DB writes were made.
- Latest AIT Signs import batch has 2240 normalized rows, all still pending.
- Import Review also has 242 pending review items.
- Recommendation: create an approval/import plan from this packet before approving or importing anything in the UI.

## Normalized Rows

- work_order: 1786
- payment_snapshot: 277
- lead: 65
- estimate: 63
- note: 49

## Rows By Sheet

- 1. INTERESADOS: lead: 65
- 2. ESTIMADOS: estimate: 63, note: 2
- 3. 15 SIGNS WORK ORDER: payment_snapshot: 81, work_order: 205, note: 5
- WORK ORDER TERMINADOS Y PAGADOS: work_order: 1581, payment_snapshot: 196, note: 42

## Review Items

- misc_text: 171
- financial_line: 30
- section_header: 21
- note: 13
- header: 4
- record_candidate: 3

## Default Handling

- Leads: review first because they can create follow-up work and customer records.
- Estimates/work orders/payments: do a promote dry-run with duplicate matching before any import approval.
- Notes: attach only after the parent contact/order match is known.
- Headers/section headers: ignore as non-customer rows.
- Financial-only lines: hold unless workbook context clearly supplies identity.
- Misc text: context only unless it can be safely attached to a neighboring parent row.

## Artifacts

- CSV: docs/mis-156-ait-signs-import-review-triage.csv
- JSON: docs/mis-156-ait-signs-import-review-triage.json
