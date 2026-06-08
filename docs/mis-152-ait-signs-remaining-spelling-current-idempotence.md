# MIS-150 AIT Signs Remaining Spelling Linked People Apply

- Generated at: 2026-06-08T21:27:52.238Z
- Mode: dry-run
- Business unit: AIT Signs
- Source label: ait_signs_remaining_spelling_latest_source_linked_people
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Approved unique people from packet: 6
- Planned linked people inserts: 0
- Applied linked people inserts: 0
- Skipped existing linked people: 6
- Blocked rows: 0
- Distinct contacts affected: 0

## Guardrails

- Inserts linked people only from MIS-150 strong spelling/suffix match recommendations.
- De-dupes by contact plus normalized person name before applying.
- Uses latest work-item/contact-point source evidence as temporary person-name truth.
- Does not rename, merge, remap, create, archive, delete, consolidate, or add aliases to contacts.
- Does not set inserted linked people as primary.
- Inserted rows are tagged with source_label=ait_signs_remaining_spelling_latest_source_linked_people.

## Planned Inserts

- none

## Skipped Existing

- EL RAPIDO SERVICE: MANY; Existing linked person with same normalized name.
- MENDOZA LANSCAPING: MENDOZA; Existing linked person with same normalized name.
- PURA VIDA TICOS: Yorleni; Existing linked person with same normalized name.
- RIDE ALERT: IRAKLI JOKHDZE; Existing linked person with same normalized name.
- ROYAL GARDEN: DEIBER; Existing linked person with same normalized name.
- STUDIO FINISH DECOR: JORGE MARTINES (SOL); Existing linked person with same normalized name.
