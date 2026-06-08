# MIS-149 AIT Signs Pass 1 Linked People Apply

- Generated at: 2026-06-08T21:27:52.494Z
- Mode: dry-run
- Business unit: AIT Signs
- Source label: ait_signs_pass1_latest_source_linked_people
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Approved unique people from packet: 5
- Planned linked people inserts: 0
- Applied linked people inserts: 0
- Skipped existing linked people: 5
- Blocked rows: 0
- Distinct contacts affected: 0

## Guardrails

- Inserts linked people only from MIS-149 approve_listed_people recommendations.
- De-dupes by contact plus normalized person name before applying.
- Uses latest Pass 1 work-item/contact-point source evidence as temporary person-name truth.
- Does not rename, merge, remap, create, archive, delete, consolidate, or add aliases to contacts.
- Inserted rows are tagged with source_label=ait_signs_pass1_latest_source_linked_people.

## Planned Inserts

- none

## Skipped Existing

- G&R TREE SERVICE: GERARD; Existing linked person with same normalized name.
- BLUE MOUNTAIN: JEFF; Existing linked person with same normalized name.
- GREEN 714: EDIGAN; Existing linked person with same normalized name.
- JCE CONTRACTOR: CLAUDIO; Existing linked person with same normalized name.
- BLUE OCEAN POOL LLC: JOSE; Existing linked person with same normalized name.
