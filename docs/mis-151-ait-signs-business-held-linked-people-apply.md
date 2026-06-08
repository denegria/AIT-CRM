# MIS-151 AIT Signs Business-Held Linked People Apply

- Generated at: 2026-06-08T21:13:00.765Z
- Mode: apply
- Business unit: AIT Signs
- Source label: ait_signs_business_held_latest_source_linked_people
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Approved unique people from packet: 15
- Planned linked people inserts: 15
- Applied linked people inserts: 15
- Skipped existing linked people: 0
- Blocked linked people: 0
- Planned contact name corrections: 1
- Applied contact name corrections: 1
- Blocked contact name corrections: 0
- Distinct contacts affected: 14

## Guardrails

- Inserts linked people only from MIS-151 user-approved business-match rows.
- De-dupes by contact plus normalized person name before applying.
- Uses latest work-item/contact-point source evidence as temporary person-name truth.
- Does not merge, remap, create, archive, delete, consolidate, or add aliases to contacts.
- Does not set inserted linked people as primary.
- Performs only the explicitly approved JCL display-name correction.
- Inserted rows are tagged with source_label=ait_signs_business_held_latest_source_linked_people.

## Planned Inserts

- BRENMA TREE SERVICE: OLGER BREMMAN MILEDY (9084219404) from WORK ORDER TERMINADOS Y PAGADOS#1517
- CESI ´S CLEANING SERVICE: ALMA DIONICIO (7322777750) from WORK ORDER TERMINADOS Y PAGADOS#1613
- COLIBRI LANDSCAPING: MARVIA (9084441095) from WORK ORDER TERMINADOS Y PAGADOS#1435
- LOCKSMITH THE WIZARD: DARVISON LUZARDO (3123990516) from 2. ESTIMADOS#58
- BEST AMERICAN ROOFING: LAURENSE (9088751885) from WORK ORDER TERMINADOS Y PAGADOS#1645
- BEST AMERICAN ROOFING: WILSON (9085525743) from WORK ORDER TERMINADOS Y PAGADOS#1070
- GALAN PLUMBING AND HEATING: MOOSE (9082299541) from WORK ORDER TERMINADOS Y PAGADOS#474
- IGLESIA NUEVO NACIMIENTO: GERARDO (8624130511) from WORK ORDER TERMINADOS Y PAGADOS#1410
- PINEBERRY JUICE: AUILES EULISES (8563089146) from WORK ORDER TERMINADOS Y PAGADOS#1575
- SUMMITVILLE: JHON (9084489698) from WORK ORDER TERMINADOS Y PAGADOS#740
- GUTO CONTRACTORS: AUGUSTO (9085249937) from WORK ORDER TERMINADOS Y PAGADOS#1617
- JC AND L LANDSCAPING: JOSE (9083034702) from WORK ORDER TERMINADOS Y PAGADOS#1649
- PERALTA AND SON CONSTRUCTION: THOMAS (9084148155) from WORK ORDER TERMINADOS Y PAGADOS#1576
- RUIZ HOME IMPROVEMENT: ELIAS (2035656106) from WORK ORDER TERMINADOS Y PAGADOS#1615
- RV LANDSCAPING: RAFAEL (7326488809) from WORK ORDER TERMINADOS Y PAGADOS#884

## Planned Name Corrections

- JCL LANSCAPING -> JC AND L LANDSCAPING
