# MIS-147 AIT Signs Shared Contact-Point Review

- Generated at: 2026-06-08T14:10:19.309Z
- Mode: apply
- Workbook: /root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx
- Workbook hash: 5018f3b48e294eef670f1937958aaac6714b6aafe45b799b020d1249d238aa06
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Phone/shared-contact candidates reviewed: 262
- Spelling variants eligible for existing-client linked people: 64
- Spelling variants held for review: 40
- Separate-business/shared-contact holds: 158
- Planned linked people inserts: 25
- Applied linked people inserts: 25
- Existing linked people skipped: 36
- Distinct contacts affected: 20

## Guardrails

- Same phone is treated as shared contact-point evidence, not client identity evidence.
- This script does not merge, rename, remap, create, archive, delete, or consolidate contacts.
- Current cleaned CRM names remain canonical.
- Rows inserted by apply mode are tagged with source_label=ait_signs_shared_contact_variant_backfill.

## Decision Samples

- GR FREE SERVICE -> G&R TREE SERVICE: hold_spelling_variant_review; people GERARD, GERARDO, GERARO; Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.
- GR TREE SERVICE -> G&R TREE SERVICE: hold_spelling_variant_review; people GERARDO, GERARD; Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.
- ANC LANDSCAPING -> ROJAS TANSPORTATIONS: hold_shared_contact_separate_business; people CARLOS, CARLOS BONILLA; Phone indicates shared owner/contact point, not shared client identity.
- ARTISAN CONSTRUCTION -> URIEL HERNANDEZ: hold_shared_contact_separate_business; people URIEL HERNANDEZ, URIEL; Phone indicates shared owner/contact point, not shared client identity.
- ELEPHANT -> ELEPHANT LANDSCAPING: hold_shared_contact_separate_business; people JULIO, JULIA; Phone indicates shared owner/contact point, not shared client identity.
- INSIDE OUTSIDE LANDSCAPING -> IASCDE 3 OUTSIDE: hold_shared_contact_separate_business; people ALBERTO, ALBERTO CASTRO; Phone indicates shared owner/contact point, not shared client identity.
- SALS DELI -> SAL'S DELI: hold_spelling_variant_review; people SAUL; Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.
- USAF -> USAF ATHLETIC FIELDS: hold_shared_contact_separate_business; people REINER, REINER DELGADO; Phone indicates shared owner/contact point, not shared client identity.
- 4 BROTHERS HOME IMPROVEMENT -> FREDY: hold_shared_contact_separate_business; people FREDY; Phone indicates shared owner/contact point, not shared client identity.
- AMERICAN ROOFING -> BEST AMERICAN ROOFING: apply_to_existing_spelling_variant; people LAURENSE, WILSON; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- BLUE OCEAN POOL -> BLUE OCEAN POOL LLC: apply_to_existing_spelling_variant; people JOSE; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- CANO TRUCK -> CANO TRUCK SERVICE: hold_spelling_variant_review; people FORTUNATO; Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.
- EPOXY FLOORS -> MG EPOXY: hold_shared_contact_separate_business; people ISIDRO; Phone indicates shared owner/contact point, not shared client identity.
- GALAN PLUMBING -> GALAN PLUMBING AND HEATING: hold_spelling_variant_review; people MOOSE, GALAN; Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.
- GREEN 7/14 -> GREEN 714: apply_to_existing_spelling_variant; people EDIGAN; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- IGLESIA DE DIOS COLUMNA Y APOYO DE LA VERDAD -> EFFY MOBILE MECHANICAL SERVICES: hold_shared_contact_separate_business; people JOEL; Phone indicates shared owner/contact point, not shared client identity.
- JCE CONTRACTOR LLC -> JCE CONTRACTOR: apply_to_existing_spelling_variant; people CLAUDIO; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- NEW JERSEY TREE EXPERT -> NJ TREE EXPERT: hold_shared_contact_separate_business; people JUAN JOSE; Phone indicates shared owner/contact point, not shared client identity.
- BLUE MONTAIN -> BLUE MOUNTAIN: apply_to_existing_spelling_variant; people FELIX, JEFF; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- DT LANDSCAPING -> TNT LANSCAPING: hold_spelling_variant_review; people SABAS, SEBAS; Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.
- G&R FREE SERVICE -> G&R TREE SERVICE: apply_to_existing_spelling_variant; people GERARD, GERARDO; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- J DIAZ CONTRUCTION -> ART BY LORELAY: hold_shared_contact_separate_business; people LORELAY DIAZ; Phone indicates shared owner/contact point, not shared client identity.
- MJ HOME IMPROVMENT -> M&J HOME IMPROVEMENT: hold_spelling_variant_review; people MARIO, MARCO; Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.
- OSCAR AUTO DETAILING -> IGLESIA DE DIOS VINO NUEVO: hold_shared_contact_separate_business; people OSCAR; Phone indicates shared owner/contact point, not shared client identity.
- PATRICIA SABOR CACERO -> FREDY: hold_shared_contact_separate_business; people FREDY; Phone indicates shared owner/contact point, not shared client identity.
- RAMON'S LANDSCAPING -> RAMON LANDSCPAING: apply_to_existing_spelling_variant; people JOSE RAMON; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- RIDE ALBERT -> RIDE ALERT: apply_to_existing_spelling_variant; people RIDE, IRAKLI JOKHDZE; Workbook candidate appears to be a spelling/format variant of the current cleaned client name.
- RINCON HONDUREÑO RESTAURANT -> ROSITA RESTAURANT: hold_shared_contact_separate_business; people ROSITA; Phone indicates shared owner/contact point, not shared client identity.
- US ATHLETIC -> USAF ATHLETIC FIELDS: hold_shared_contact_separate_business; people REINER DELGADO; Phone indicates shared owner/contact point, not shared client identity.
- ANC LANSCAPING -> ROJAS TANSPORTATIONS: hold_shared_contact_separate_business; people CARLOS; Phone indicates shared owner/contact point, not shared client identity.
