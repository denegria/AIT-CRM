# MIS-164 AIT Signs Review-item Context Attaches

- Generated at: 2026-06-09T06:09:31.069Z
- Mode: dry-run
- DB writes: none

## Summary

- Attach recommendations reviewed: 18
- Resolved existing contacts: 0
- Already imported/attached: 11
- Holds/unresolved/ambiguous: 7
- Updated review items: 0

## Guardrail

- Only rows with `recommendation=attach_to_existing_contact` are eligible.
- Only existing contacts may be targets; unresolved or ambiguous rows stay pending.
- No contacts, notes, activities, work orders, normalized records, source rows, or schema are created/changed.
