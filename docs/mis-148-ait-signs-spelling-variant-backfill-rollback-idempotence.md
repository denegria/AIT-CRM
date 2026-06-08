# MIS-148 AIT Signs Spelling-Variant Backfill Rollback

- Generated at: 2026-06-08T18:26:58.591Z
- Mode: dry-run
- Business unit: AIT Signs
- Source label: ait_signs_shared_contact_variant_backfill
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Rows found before rollback: 0
- Rows deleted: 0
- Rows remaining after rollback: 0
- Distinct contacts affected: 0

## Guardrails

- Deletes only contact_people rows tagged with the MIS-147 spelling-variant source label.
- Does not touch exact-match backfill rows, contacts, client names, work orders, estimates, payments, tasks, or notes.
- This rollback reflects the product rule that obvious spelling variants are review/provenance-only.

## Sample Rows

