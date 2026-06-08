# MIS-151 AIT Signs Business-Held Linked People Apply

- Generated at: 2026-06-08T21:14:22.416Z
- Mode: dry-run
- Business unit: AIT Signs
- Source label: ait_signs_business_held_latest_source_linked_people
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Approved unique people from packet: 15
- Planned linked people inserts: 0
- Applied linked people inserts: 0
- Skipped existing linked people: 15
- Blocked linked people: 0
- Planned contact name corrections: 0
- Applied contact name corrections: 0
- Skipped contact name corrections: 1
- Blocked contact name corrections: 0
- Distinct contacts affected: 0

## Guardrails

- Inserts linked people only from MIS-151 user-approved business-match rows.
- De-dupes by contact plus normalized person name before applying.
- Uses latest work-item/contact-point source evidence as temporary person-name truth.
- Does not merge, remap, create, archive, delete, consolidate, or add aliases to contacts.
- Does not set inserted linked people as primary.
- Performs only the explicitly approved JCL display-name correction.
- Inserted rows are tagged with source_label=ait_signs_business_held_latest_source_linked_people.

## Planned Inserts

- none

## Skipped Existing People

- BRENMA TREE SERVICE: OLGER BREMMAN MILEDY; Existing linked person with same normalized name.
- CESI ´S CLEANING SERVICE: ALMA DIONICIO; Existing linked person with same normalized name.
- COLIBRI LANDSCAPING: MARVIA; Existing linked person with same normalized name.
- LOCKSMITH THE WIZARD: DARVISON LUZARDO; Existing linked person with same normalized name.
- BEST AMERICAN ROOFING: LAURENSE; Existing linked person with same normalized name.
- BEST AMERICAN ROOFING: WILSON; Existing linked person with same normalized name.
- GALAN PLUMBING AND HEATING: MOOSE; Existing linked person with same normalized name.
- IGLESIA NUEVO NACIMIENTO: GERARDO; Existing linked person with same normalized name.
- PINEBERRY JUICE: AUILES EULISES; Existing linked person with same normalized name.
- SUMMITVILLE: JHON; Existing linked person with same normalized name.
- GUTO CONTRACTORS: AUGUSTO; Existing linked person with same normalized name.
- JC AND L LANDSCAPING: JOSE; Existing linked person with same normalized name.
- PERALTA AND SON CONSTRUCTION: THOMAS; Existing linked person with same normalized name.
- RUIZ HOME IMPROVEMENT: ELIAS; Existing linked person with same normalized name.
- RV LANDSCAPING: RAFAEL; Existing linked person with same normalized name.

## Skipped Name Corrections

- JCL LANSCAPING -> JC AND L LANDSCAPING; Target contact name already exists and source name is absent; correction was already applied.
