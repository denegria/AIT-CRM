# MIS-134 AIT Signs Reviewed Consolidation Dry Run

## Summary

- Generated: 2026-06-07T21:57:48.123Z
- Dry run: yes
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- DB branch label: staging
- DB host suffix: us-east-1.aws.neon.tech
- DB name: neondb

## Counts

- AIT Signs contacts scanned: 903
- Held exact duplicate groups: 1
- Held near-duplicate groups: 32
- Reviewed held groups: 33
- Candidate groups needing human approval: 5
- Candidate groups with shared real phone evidence: 0
- Candidate groups with workbook support: 4
- Candidate exact duplicate groups: 1
- Held-for-review groups: 28
- Candidate contacts: 11
- Candidate operational rows: 45
- Held contacts: 67
- Held operational rows: 572

## Rules

- No automatic consolidation happens in this dry run.
- Candidate groups still require human approval before any apply script links contacts or creates account records.
- Near-duplicate name-only groups stay held.
- Conflicting real-phone groups stay held.
- G&R TREE SERVICE and RG TREE SERVICE stay separate unless new evidence overturns the current rule.

## Disposition Counts

- hold_for_manual_review: 28
- candidate_needs_human_approval: 5

## Hold Reason Counts

- near_duplicate_name_only: 27
- conflicting_real_phone_evidence: 15
- no_real_phone: 4

## Candidate Sample

- COLIBRI LANDSCAPING — near_duplicate_name_similarity+workbook_supported; contacts: 3; operational rows: 11; shared phones: none; aliases to create: 2; hold reasons: none
- HAVANAS HOME IMPROVEMENT — near_duplicate_name_similarity+workbook_supported; contacts: 2; operational rows: 11; shared phones: none; aliases to create: 1; hold reasons: none
- RINCON HONDURENO — exact_normalized_name; contacts: 2; operational rows: 8; shared phones: none; aliases to create: 0; hold reasons: none
- STAR BRITE — near_duplicate_name_similarity+workbook_supported; contacts: 2; operational rows: 8; shared phones: none; aliases to create: 1; hold reasons: none
- MUJICA CLEANING SERVICE — near_duplicate_name_similarity+workbook_supported; contacts: 2; operational rows: 7; shared phones: none; aliases to create: 1; hold reasons: none

## Held Sample

- WORLD SUPERMARKET — near_duplicate_name_similarity; contacts: 3; operational rows: 111; shared phones: none; aliases to create: 2; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- USAF ATHLETIC FIELDS — near_duplicate_name_similarity+workbook_supported; contacts: 4; operational rows: 53; shared phones: none; aliases to create: 3; hold reasons: conflicting_real_phone_evidence
- BEAUTIFUL FLOOR — near_duplicate_name_similarity; contacts: 4; operational rows: 48; shared phones: none; aliases to create: 3; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- DINOS TREE SERVICE — near_duplicate_name_similarity; contacts: 3; operational rows: 40; shared phones: none; aliases to create: 2; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- ELEPHANT LANDSCAPING — near_duplicate_name_similarity; contacts: 2; operational rows: 31; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- VALVERDE LANDSCPING — near_duplicate_name_similarity; contacts: 3; operational rows: 29; shared phones: none; aliases to create: 2; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- MVR CLEANING — near_duplicate_name_similarity; contacts: 2; operational rows: 28; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- LA PUPUSA LOCA — near_duplicate_name_similarity; contacts: 2; operational rows: 25; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- TANANTA IRON WORKS — near_duplicate_name_similarity; contacts: 3; operational rows: 23; shared phones: none; aliases to create: 2; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- RAMON LANDSCPAING — near_duplicate_name_similarity; contacts: 3; operational rows: 21; shared phones: none; aliases to create: 2; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- AMAYA PAINTING — near_duplicate_name_similarity; contacts: 2; operational rows: 21; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- JACO MOVERS — near_duplicate_name_similarity; contacts: 2; operational rows: 19; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- LEOPARD TREE SERVICE — near_duplicate_name_similarity; contacts: 3; operational rows: 17; shared phones: none; aliases to create: 2; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- ROYAL GARDEN — near_duplicate_name_similarity; contacts: 2; operational rows: 14; shared phones: none; aliases to create: 1; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- IGLESIA CRISTO DE LA FUENTE DE VIDA ETERNA — near_duplicate_name_similarity; contacts: 2; operational rows: 12; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- HORTENSIAS CLEANING — near_duplicate_name_similarity; contacts: 2; operational rows: 12; shared phones: none; aliases to create: 1; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- PATRICIA SABOR CASERO — near_duplicate_name_similarity; contacts: 2; operational rows: 10; shared phones: none; aliases to create: 1; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- CABALLERO FENCE — near_duplicate_name_similarity; contacts: 3; operational rows: 8; shared phones: none; aliases to create: 2; hold reasons: near_duplicate_name_only
- PABLINO CARPENTRY — near_duplicate_name_similarity; contacts: 2; operational rows: 7; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- ROSAMARI — near_duplicate_name_similarity; contacts: 2; operational rows: 7; shared phones: none; aliases to create: 1; hold reasons: no_real_phone, near_duplicate_name_only
- DAVIS LANSCAPING — near_duplicate_name_similarity; contacts: 2; operational rows: 6; shared phones: none; aliases to create: 1; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- MELIS BEAUTY SALON — near_duplicate_name_similarity; contacts: 2; operational rows: 6; shared phones: none; aliases to create: 1; hold reasons: no_real_phone, near_duplicate_name_only
- LORENA MUNOS — near_duplicate_name_similarity; contacts: 2; operational rows: 4; shared phones: none; aliases to create: 1; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- JOSE MARQUES — near_duplicate_name_similarity; contacts: 2; operational rows: 4; shared phones: none; aliases to create: 1; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- DNF LANDSCAPING — near_duplicate_name_similarity; contacts: 2; operational rows: 4; shared phones: none; aliases to create: 1; hold reasons: no_real_phone, near_duplicate_name_only
- BAGEL BAZAR — near_duplicate_name_similarity; contacts: 2; operational rows: 4; shared phones: none; aliases to create: 1; hold reasons: conflicting_real_phone_evidence, near_duplicate_name_only
- GENERAL SERVICE — near_duplicate_name_similarity; contacts: 2; operational rows: 4; shared phones: none; aliases to create: 1; hold reasons: near_duplicate_name_only
- IHT CONSTRUCTION — near_duplicate_name_similarity; contacts: 2; operational rows: 4; shared phones: none; aliases to create: 1; hold reasons: no_real_phone, near_duplicate_name_only

## Protected Separations

- G&R TREE SERVICE: account G&R TREE SERVICE, phone ***2509, disposition keep_separate_without_new_evidence
- RG TREE SERVICE: account RG TREE SERVICE, phone ***4057, disposition keep_separate_without_new_evidence

## Apply/Rollback Shape

- Apply would export affected rows first, create or use a target account, link reviewed contacts, create hidden aliases for source names, add contact methods/locations, and tag all created records with the consolidation source.
- Rollback would restore prior `contacts.client_account_id` values and delete records created by the consolidation source tag.
