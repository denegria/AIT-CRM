# MIS-150 AIT Signs Remaining Spelling Approval Packet

- Generated at: 2026-06-08T21:28:09.771Z
- Source report: docs/mis-148-ait-signs-shared-contact-point-review-rule-idempotence.json
- Source generated at: 2026-06-08T21:27:53.963Z
- Business unit: AIT Signs

## Summary

- Source reviewed candidates: 261
- Remaining spelling rows: 85
- Distinct canonical clients: 76
- Recommended apply rows: 0
- Recommended no-write rows: 21
- Held business-review rows: 64
- Potential linked people after de-dupe: 0
- Held potential people after de-dupe: 0
- DB writes planned by this packet: 0

## Guardrails

- Packet only; this script performs no database writes.
- The latest work-item/contact-point source row is temporary person-name truth until a newer edit/input replaces it.
- Safe apply rows are limited to strong business-name spelling/suffix matches.
- Held rows are not blocked by person-name uncertainty; they are blocked by business-name ambiguity.
- Any later apply must de-dupe by contact plus normalized person name.
- Do not rename, merge, remap, create, archive, delete, consolidate, or add aliases from this packet.
- Do not change primary linked-person flags from this packet.

## Potential Linked People

- none

## Held Potential People

- none

## Recommended Apply Rows

- none

## Held Business Review Rows

- ALEJANDRO ROMERO -> ALEJANDRA ROMERO: no missing person; first-token-mismatch
- ANA LLENY -> ANDLLERY: no missing person; first-token-mismatch
- ANALLENY -> ANDLLERY: no missing person; first-token-mismatch
- ACUA PAINTING -> AQUA PAINTING: no missing person; first-token-mismatch
- LORELAY ART -> ART BY LORELAY: no missing person; first-token-mismatch
- ROOFING AND SIDING -> ASA ROOFING AND SIDING: no missing person; weak-or-ambiguous-business-match
- AMERICAN ROOFING -> BEST AMERICAN ROOFING: no missing person; first-token-mismatch
- BEST AMERICAN MATRIZ -> BEST AMERICAN ROOFING: no missing person; weak-or-ambiguous-business-match
- BREMMA TREE SERVICE -> BRENMA TREE SERVICE: no missing person; first-token-mismatch
- BROOKLYN BOMBER SHOP -> BROOKLYN BARBER SHOP: no missing person; weak-or-ambiguous-business-match
- BRUNSWICK -> BRUNS WICK PLUMBING: no missing person; first-token-mismatch
- CAMILA CONSTRUCTION -> CAMILA CONTRACTOR: no missing person; weak-or-ambiguous-business-match
- CASIEL EXPRESS -> CASTELL EXPRESS: no missing person; first-token-mismatch
- CECI'S CLEANING SERVICES -> CESI ´S CLEANING SERVICE: no missing person; first-token-mismatch
- CALIBRI LANDSCAPING -> COLIBRI LANDSCAPING: no missing person; first-token-mismatch
- Da Home Works -> D&A HOME WORKS: no missing person; first-token-mismatch
- DAVID'S LANDSCAPING -> DAVIS LANSCAPING: no missing person; first-token-mismatch
- OJ NITRO -> DJ NITRO: no missing person; first-token-mismatch
- DREANING HOME IMPROVEMENT -> DREAMING HOME IMPROVEMENT: no missing person; first-token-mismatch
- DURABLE CONSTRUCTORA -> DURABLE CONSTRUCTION: no missing person; weak-or-ambiguous-business-match
- EDWIN MUNES -> Edwin Nunez: no missing person; weak-or-ambiguous-business-match
- DJ ENRIQUE MALAN -> ENRIQUE MALAN: no missing person; first-token-mismatch
- Buerth Cleaning Service -> EVERTH CLEANING SERVICE: no missing person; first-token-mismatch
- FASTWAY CONTRACTOR -> FATWAY CONTRACTOR: no missing person; first-token-mismatch
- FRANKYS -> FRANKY'S: no missing person; first-token-mismatch
- GALAN PLUMBING -> GALAN PLUMBING AND HEATING: no missing person; weak-or-ambiguous-business-match
- GREEN TEAM LANSCAPE -> GREEN TEAM: no missing person; weak-or-ambiguous-business-match
- GREEN LAND -> GREENLAND: no missing person; first-token-mismatch
- GUTTO CONTTRACTORS LLC -> GUTO CONTRACTORS: no missing person; first-token-mismatch
- NUEVO NACIMIENTO -> IGLESIA NUEVO NACIMIENTO: no missing person; first-token-mismatch
- IGLESIA RESTAURACION SHALOM INC -> IGLESIA RESTAURACION SHALOM - RIOS DE AGUA VIVA: no missing person; weak-or-ambiguous-business-match
- JS CARPENTIER -> JS CARPENTRY: no missing person; weak-or-ambiguous-business-match
- LINDO LOPEZ -> LANDO LOPEZ: no missing person; first-token-mismatch
- HANDYMAN CARPENTY AND ELECTRICAL -> LB HANDYMAN CARPEATY AND ELETRICAL: no missing person; first-token-mismatch
- LEA PAINTING -> LEO PAITING: no missing person; first-token-mismatch
- Jerlin Pena -> LERLIN PENA: no missing person; first-token-mismatch
- LOCK SMITH THE WIZARD -> LOCKSMITH THE WIZARD: no missing person; first-token-mismatch
- MJ HOME IMPROVMENT -> M&J HOME IMPROVEMENT: no missing person; first-token-mismatch
- MASTERCONSTRUCTION -> MASTER CONSTRUCTION: no missing person; first-token-mismatch
- MINISTERIO MI JKANODOR -> MINISTERIO MI SANADOR: no missing person; weak-or-ambiguous-business-match
- IGLESIA PRESENCIA DE DIOS -> MINISTERIO PRESENCIA DE DIOS: no missing person; first-token-mismatch
- PRESENCIA DE DIOS -> MINISTERIO PRESENCIA DE DIOS: no missing person; first-token-mismatch
- Nelson de Leon -> NELSON: no missing person; weak-or-ambiguous-business-match
- PERALTA CONSTRUCTION -> PERALTA AND SON CONSTRUCTION: no missing person; weak-or-ambiguous-business-match
- PINA LOCA -> PINAS LOCAS: no missing person; first-token-mismatch
- PINEBERRY -> PINEBERRY JUICE: no missing person; weak-or-ambiguous-business-match
- RAMON'S LANDSCAPING -> RAMON LANDSCPAING: no missing person; weak-or-ambiguous-business-match
- RANDALL ROJAS -> RANDAL ROJAS: no missing person; first-token-mismatch
- R C S LANDSCAPING CONSTRUCTION -> RC & SON LANDSCAPING CONSTRUCTION LLC: no missing person; first-token-mismatch
- ROJAS TANSPORTIONS -> ROJAS TANSPORTATIONS: no missing person; weak-or-ambiguous-business-match
- RUIZ HOME IMPROVEMT -> RUIZ HOME IMPROVEMENT: no missing person; weak-or-ambiguous-business-match
- RU LANSCAPING -> RV LANDSCAPING: no missing person; first-token-mismatch
- SALS DELI -> SAL'S DELI: no missing person; first-token-mismatch
- SALEM HALAl FOOD -> SALEM HALAL MEAT: no missing person; weak-or-ambiguous-business-match
- SIGNATURE SCAPES -> SIGNATURA SCOPES: no missing person; first-token-mismatch
- SUMMITVILLE TREE SERVICE -> SUMMITVILLE: no missing person; weak-or-ambiguous-business-match
- TANANTA FRON WAKS -> TANANTA IRON WORKS: no missing person; weak-or-ambiguous-business-match
- TICO'S DECKS -> TICOS DECKS: no missing person; first-token-mismatch
- DT LANDSCAPING -> TNT LANSCAPING: no missing person; first-token-mismatch
- TRANSFERIR USA -> TRANSFOR USA: no missing person; first-token-mismatch
- URBAN STYLE BARBER -> URBAN STYLE: no missing person; weak-or-ambiguous-business-match
- USAF ATHLETIC -> USAF ATHLETIC FIELDS: no missing person; weak-or-ambiguous-business-match
- USAF US THLETIC FIELDS -> USAF ATHLETIC FIELDS: no missing person; weak-or-ambiguous-business-match
- WOOD LAND -> WOODLAND: no missing person; first-token-mismatch
