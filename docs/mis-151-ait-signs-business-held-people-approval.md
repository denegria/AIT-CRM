# MIS-151 AIT Signs Business-Held People Approval Packet

- Generated at: 2026-06-08T20:55:27.230Z
- Source report: docs/mis-150-ait-signs-remaining-spelling-approval.json
- Source issue: MIS-150
- Source generated at: 2026-06-08T20:41:23.588Z
- Business unit: AIT Signs

## Summary

- Source held business-review rows: 65
- No-person held rows deferred: 51
- Approval rows in this packet: 14
- Likely approval rows: 9
- Hard business-direction rows: 5
- Distinct canonical clients: 14
- Linked people after de-dupe: 15
- DB writes planned by this packet: 0

## Guardrails

- Packet only; this script performs no database writes.
- Source workbook/latest work item or contact point remains temporary person-name truth.
- Every row still needs explicit business-match approval before a future apply.
- Shared phone/contact point is not client identity evidence.
- Any future apply must insert only non-primary linked people and de-dupe by contact plus normalized person name.
- Do not rename, merge, remap, create, archive, delete, consolidate, add aliases, or change primary linked-person flags from this packet.

## Linked People In Scope

- ALMA DIONICIO
- AUGUSTO
- AUILES EULISES
- DARVISON LUZARDO
- ELIAS
- GERARDO
- JHON
- JOSE
- LAURENSE
- MARVIA
- MOOSE
- OLGER BREMMAN MILEDY
- RAFAEL
- THOMAS
- WILSON

## Approval Rows

- BREMMA TREE SERVICE -> BRENMA TREE SERVICE: OLGER BREMMAN MILEDY x1; approve_if_business_match; high_spelling_similarity; latest 9084219404: OLGER BREMMAN MILEDY from WORK ORDER TERMINADOS Y PAGADOS#1517
- CECI'S CLEANING SERVICES -> CESI ´S CLEANING SERVICE: ALMA DIONICIO x1; approve_if_business_match; high_spelling_similarity; latest 7322777750: ALMA DIONICIO from WORK ORDER TERMINADOS Y PAGADOS#1613
- CALIBRI LANDSCAPING -> COLIBRI LANDSCAPING: MARVIA x1; approve_if_business_match; high_spelling_similarity; latest 9084441095: MARVIA from WORK ORDER TERMINADOS Y PAGADOS#1435
- LOCK SMITH THE WIZARD -> LOCKSMITH THE WIZARD: DARVISON LUZARDO x1; approve_if_business_match; format_only; latest 3123990516: DARVISON LUZARDO from 2. ESTIMADOS#58
- AMERICAN ROOFING -> BEST AMERICAN ROOFING: LAURENSE x2; WILSON x2; approve_if_prefix_suffix_is_same_business; prefix_or_suffix_variant; latest 9085525743: WILSON from WORK ORDER TERMINADOS Y PAGADOS#1070; 9088751885: LAURENSE from WORK ORDER TERMINADOS Y PAGADOS#1645
- GALAN PLUMBING -> GALAN PLUMBING AND HEATING: MOOSE x3; approve_if_prefix_suffix_is_same_business; prefix_or_suffix_variant; latest 9082299541: MOOSE from WORK ORDER TERMINADOS Y PAGADOS#474; 9092299541: MOOSE from WORK ORDER TERMINADOS Y PAGADOS#474
- NUEVO NACIMIENTO -> IGLESIA NUEVO NACIMIENTO: GERARDO x1; approve_if_prefix_suffix_is_same_business; prefix_or_suffix_variant; latest 8624130511: GERARDO from WORK ORDER TERMINADOS Y PAGADOS#1410
- PINEBERRY -> PINEBERRY JUICE: AUILES EULISES x1; approve_if_prefix_suffix_is_same_business; prefix_or_suffix_variant; latest 8563089146: AUILES EULISES from WORK ORDER TERMINADOS Y PAGADOS#1575
- SUMMITVILLE TREE SERVICE -> SUMMITVILLE: JHON x1; approve_if_prefix_suffix_is_same_business; prefix_or_suffix_variant; latest 9084489698: JHON from WORK ORDER TERMINADOS Y PAGADOS#740
- GUTTO CONTTRACTORS LLC -> GUTO CONTRACTORS: AUGUSTO x1; hold_for_business_identity_direction; needs_business_direction; latest 9085249937: AUGUSTO from WORK ORDER TERMINADOS Y PAGADOS#1617
- JC&L LANDSCAPING -> JCL LANSCAPING: JOSE x1; hold_for_business_identity_direction; needs_business_direction; latest 9083034702: JOSE from WORK ORDER TERMINADOS Y PAGADOS#1649
- PERALTA CONSTRUCTION -> PERALTA AND SON CONSTRUCTION: THOMAS x2; hold_for_business_identity_direction; needs_business_direction; latest 9084148155: THOMAS from WORK ORDER TERMINADOS Y PAGADOS#1576
- RUIZ HOME IMPROVEMT -> RUIZ HOME IMPROVEMENT: ELIAS x2; hold_for_business_identity_direction; near_spelling_similarity; latest 2035656106: ELIAS from WORK ORDER TERMINADOS Y PAGADOS#1615
- RU LANSCAPING -> RV LANDSCAPING: RAFAEL x1; hold_for_business_identity_direction; near_spelling_similarity; latest 7326488809: RAFAEL from WORK ORDER TERMINADOS Y PAGADOS#884
