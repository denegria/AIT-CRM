# MIS-133 AIT Signs Account Alias/Provenance Dry Run

## Summary

- Generated: 2026-06-07T21:49:33.162Z
- Dry run: yes
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- DB branch label: staging
- DB host suffix: us-east-1.aws.neon.tech
- DB name: neondb

## Counts

- Linked accounts reviewed: 795
- Linked contacts reviewed: 795
- Account metadata provenance rows already present: 795
- Unique source names inspected: 795
- Planned hidden/searchable aliases: 0
- Planned visible aliases: 0
- Skipped redundant source names: 795
- Skipped low-signal source names: 0

## Decision Rule

- Do not auto-create visible aliases from cleaned import/source names.
- Keep the variants/aliases field available for future employee-promoted DBA names, abbreviations, locations, or useful misspellings.
- Only hidden/searchable provenance aliases should be planned automatically, and only when the source name differs from the canonical account name.

## Result

- No alias rows should be prefilled for the 795 safe one-to-one backfilled accounts. The source names match the canonical account names, and provenance is already retained in account metadata.

## Source Label Breakdown

- archive: 615
- work_order: 101
- lead: 42
- estimate: 24
- mis_97_workbook_identity_correction_apply: 13

## Planned Hidden Alias Sample

- None in sample.

## Planned Visible Alias Sample

- None in sample.

## Redundant Source Name Sample

- 2 QUICK: 2 QUICK (contacts.name, work_order)
- 3 BRIDGE CAFE: 3 BRIDGE CAFE (contacts.name, work_order)
- 3 SAABORES: 3 SAABORES (contacts.name, archive)
- 3G CONSTRUCTION: 3G CONSTRUCTION (contacts.name, archive)
- 4 BOTHERS IMPROVEMENT: 4 BOTHERS IMPROVEMENT (contacts.name, archive)
- 4 BROTHER: 4 BROTHER (contacts.name, work_order)
- 5 DE MAYO RESTAURANT: 5 DE MAYO RESTAURANT (contacts.name, archive)
- A&M CAR AUTODETAILLING: A&M CAR AUTODETAILLING (contacts.name, work_order)
- A.L. PAINTING: A.L. PAINTING (contacts.name, work_order)
- ABEL ALCALDE DE BOUND BROOK: ABEL ALCALDE DE BOUND BROOK (contacts.name, archive)
- ABU BAKAR: ABU BAKAR (contacts.name, lead)
- ACAPULCO RESTAURANT: ACAPULCO RESTAURANT (contacts.name, archive)
- ADRIAN GARBANZO: ADRIAN GARBANZO (contacts.name, work_order)
- ADRIAN GARCIA NARANJO: ADRIAN GARCIA NARANJO (contacts.name, archive)
- AGC CLEANING: AGC CLEANING (contacts.name, archive)
- AIT USA INSTITUTE: AIT USA INSTITUTE (contacts.name, archive)
- AITE: AITE (contacts.name, archive)
- ALBA E. GONZALES: ALBA E. GONZALES (contacts.name, archive)
- ALBERT MAINTENACE: ALBERT MAINTENACE (contacts.name, work_order)
- ALEJANDRA ROMERO: ALEJANDRA ROMERO (contacts.name, archive)
- ALEJANNDRO NILA: ALEJANNDRO NILA (contacts.name, archive)
- ALEX: ALEX (contacts.name, archive)
- ALEX&SAN CONSTRUCTION: ALEX&SAN CONSTRUCTION (contacts.name, archive)
- ALEXANDER MENDIETA: ALEXANDER MENDIETA (contacts.name, archive)
- ALI: ALI (contacts.name, lead)
- ALPE: ALPE (contacts.name, archive)
- ALPIZAR CONSTRUCTION: ALPIZAR CONSTRUCTION (contacts.name, archive)
- ALVARO: ALVARO (contacts.name, archive)
- AMAYA LANDSCAPING: AMAYA LANDSCAPING (contacts.name, archive)
- AMERICA BUILDERS: AMERICA BUILDERS (contacts.name, archive)

## Next Step

Leave aliases empty for these backfilled accounts until a reviewed data slice or employee action promotes useful variants. Continue with reviewed consolidation for held duplicate and near-duplicate groups.
