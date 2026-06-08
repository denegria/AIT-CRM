# MIS-146 AIT Signs Exact Linked People Backfill

- Generated at: 2026-06-08T21:27:53.934Z
- Mode: dry-run
- Workbook: /root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx
- Workbook hash: 5018f3b48e294eef670f1937958aaac6714b6aafe45b799b020d1249d238aa06
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Exact-match client candidates reviewed: 826
- Planned linked people inserts: 0
- Applied linked people inserts: 0
- Existing linked people skipped: 637
- Distinct contacts affected: 0
- Primary person rows inserted: 0

## Guardrails

- Apply required --apply --confirm-staging: not used in dry-run mode
- Only safe_reuse_existing_contact candidates from MIS-145 were eligible.
- Phone-only remaps, ambiguous candidates, new clients, archive/delete, and consolidation were not applied.
- Existing linked people with the same normalized name were skipped.

## Samples

- No linked people were planned.

## Rollback Note

- Rows inserted by this script are tagged with source_label=ait_signs_estimate_exact_backfill.
