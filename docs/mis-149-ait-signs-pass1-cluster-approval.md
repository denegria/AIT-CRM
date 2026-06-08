# MIS-149 AIT Signs Pass 1 Cluster Approval Packet

- Generated at: 2026-06-08T19:21:34.767Z
- Source report: docs/mis-148-ait-signs-shared-contact-point-review-rule-idempotence.json
- Source generated at: 2026-06-08T18:27:00.459Z
- Business unit: AIT Signs

## Summary

- Source reviewed candidates: 262
- Pass 1 clusters: 7
- Approval rows: 18
- Excluded same-cluster rows: 3
- Potential linked people after de-dupe: 10
- DB writes planned by this packet: 0

## Guardrails

- Approval packet only; this script performs no database writes.
- Each row requires explicit approval before any later apply script may insert linked people.
- Approved apply scope is linked-person insertion only, for the listed people only.
- Any later apply script must de-dupe by contact plus normalized person name before inserting rows.
- If a listed person name looks misspelled, mark that row needs_research instead of approving it.
- Do not rename, merge, remap, create, archive, delete, consolidate, or add aliases from this packet.
- Separate-business/shared-contact rows stay excluded unless Alvaro explicitly opens a later review.

## Approval Values

- approve_listed_people: approved for a later guarded apply script to insert only the listed missing linked people after de-dupe.
- approve_no_write: approved as same-client evidence, but no linked-person insert should be made.
- reject: do not apply linked-person inserts for this row.
- needs_research: keep held for manual/business-name research.

## Clusters

### G&R TREE SERVICE

- Rationale: Alvaro previously confirmed the GR/G&R cleanup direction after business-name review.
- Approval rows: 5
- Excluded same-cluster rows: 0
- Candidate variants: G&R FREE SERVICE; GERALD TREE SERVICE; GERARD TREE SERVICE; GR FREE SERVICE; GR TREE SERVICE
- Potential linked people: GERARD x10; GERARO x1

### BLUE MOUNTAIN

- Rationale: Only direct Blue Mountain misspellings are in scope; Valverde/Great Blue Mountain shared-phone rows stay excluded.
- Approval rows: 3
- Excluded same-cluster rows: 1
- Candidate variants: BLUE MONTAIN; BLUE MOUNATIN; BLUE MOUNTOWN
- Potential linked people: JEFF x1

### LIFETIME CONSTRUCTION

- Rationale: Life Time/Life Team/Contruction rows appear to be direct spelling or spacing variants.
- Approval rows: 3
- Excluded same-cluster rows: 0
- Candidate variants: LIFE TEAM CONSTRUCTION; LIFE TIME CONSTRUCTION; LIFETIME CONTRUCTION
- Potential linked people: WILLIAM ARAUJO x1; WILLIAM AROYO x1

### GREEN 714

- Rationale: Green 7/14, 7/15, and LLC rows appear to be direct formatting/suffix variants.
- Approval rows: 3
- Excluded same-cluster rows: 1
- Candidate variants: GREEN 7/14; GREEN 7/15; GREEN 714 LLC
- Potential linked people: EDIGAN x5; EDIGON x1

### 3 BRIDGE CAFE

- Rationale: Only cafe spelling/plural variants are in scope; restaurant wording stays excluded.
- Approval rows: 2
- Excluded same-cluster rows: 1
- Candidate variants: 3 BRIDGES CAFE; 3 BRIGES CAFE
- Potential linked people: HECTOR MARTINEZ x1

### JCE CONTRACTOR

- Rationale: LLC suffix-only variant.
- Approval rows: 1
- Excluded same-cluster rows: 0
- Candidate variants: JCE CONTRACTOR LLC
- Potential linked people: CLAUDIO x4

### BLUE OCEAN POOL LLC

- Rationale: LLC suffix-only variant.
- Approval rows: 1
- Excluded same-cluster rows: 0
- Candidate variants: BLUE OCEAN POOL
- Potential linked people: JOSE x3

## Approval Rows

- G&R FREE SERVICE -> G&R TREE SERVICE
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: GERARD x2; GERARDO x1
  - Potential linked people to insert: GERARD x2
  - Phones: 9082744942; 9087632509
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#949; WORK ORDER TERMINADOS Y PAGADOS#1126; WORK ORDER TERMINADOS Y PAGADOS#917

- GERALD TREE SERVICE -> G&R TREE SERVICE
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: GERARD x1
  - Potential linked people to insert: GERARD x1
  - Phones: 9087632509
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#678

- GERARD TREE SERVICE -> G&R TREE SERVICE
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: no_db_write_existing_people_only
  - Candidate people: GERARDO x1
  - Potential linked people to insert: none
  - Phones: 9087632509
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1009

- GR FREE SERVICE -> G&R TREE SERVICE
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: GERARD x4; GERARDO x2; GERARO x1
  - Potential linked people to insert: GERARD x4; GERARO x1
  - Phones: 9087632509
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#898; WORK ORDER TERMINADOS Y PAGADOS#964; WORK ORDER TERMINADOS Y PAGADOS#1106; WORK ORDER TERMINADOS Y PAGADOS#1187; WORK ORDER TERMINADOS Y PAGADOS#805; WORK ORDER TERMINADOS Y PAGADOS#1157; WORK ORDER TERMINADOS Y PAGADOS#806

- GR TREE SERVICE -> G&R TREE SERVICE
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: GERARDO x5; GERARD x3
  - Potential linked people to insert: GERARD x3
  - Phones: 9082744942; 9086598518; 9087622509; 9087632509
  - Source rows: 3. 15 SIGNS WORK ORDER#37; 3. 15 SIGNS WORK ORDER#197; 3. 15 SIGNS WORK ORDER#198; WORK ORDER TERMINADOS Y PAGADOS#1052; WORK ORDER TERMINADOS Y PAGADOS#1412; WORK ORDER TERMINADOS Y PAGADOS#720; WORK ORDER TERMINADOS Y PAGADOS#1402; WORK ORDER TERMINADOS Y PAGADOS#1709

- BLUE MONTAIN -> BLUE MOUNTAIN
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: FELIX x2; JEFF x1
  - Potential linked people to insert: JEFF x1
  - Phones: 5714550553; 7328038578
  - Source rows: 3. 15 SIGNS WORK ORDER#106; 3. 15 SIGNS WORK ORDER#138; 3. 15 SIGNS WORK ORDER#156

- BLUE MOUNATIN -> BLUE MOUNTAIN
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: no_db_write_existing_people_only
  - Candidate people: FELIX x1
  - Potential linked people to insert: none
  - Phones: 7328038578
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1094

- BLUE MOUNTOWN -> BLUE MOUNTAIN
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: no_db_write_existing_people_only
  - Candidate people: FELIX x1
  - Potential linked people to insert: none
  - Phones: 7328038578
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#860

- LIFE TEAM CONSTRUCTION -> LIFETIME CONSTRUCTION
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: WILLIAM AROYO x1
  - Potential linked people to insert: WILLIAM AROYO x1
  - Phones: 7327990967
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1035

- LIFE TIME CONSTRUCTION -> LIFETIME CONSTRUCTION
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: no_db_write_existing_people_only
  - Candidate people: WILLIAM x1; WILLIAN x1
  - Potential linked people to insert: none
  - Phones: 7327990967
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1208; WORK ORDER TERMINADOS Y PAGADOS#1224

- LIFETIME CONTRUCTION -> LIFETIME CONSTRUCTION
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: WILLIAM ARAUJO x1
  - Potential linked people to insert: WILLIAM ARAUJO x1
  - Phones: 7327990967
  - Source rows: 3. 15 SIGNS WORK ORDER#158

- GREEN 7/14 -> GREEN 714
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: EDIGAN x4
  - Potential linked people to insert: EDIGAN x4
  - Phones: 9085468462
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1464; WORK ORDER TERMINADOS Y PAGADOS#1508; WORK ORDER TERMINADOS Y PAGADOS#1583; WORK ORDER TERMINADOS Y PAGADOS#1584

- GREEN 7/15 -> GREEN 714
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: EDIGAN x1
  - Potential linked people to insert: EDIGAN x1
  - Phones: 9085468462
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1509

- GREEN 714 LLC -> GREEN 714
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: EDIGON x1
  - Potential linked people to insert: EDIGON x1
  - Phones: 9085468462
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1082

- 3 BRIDGES CAFE -> 3 BRIDGE CAFE
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: HECTOR MARTINEZ x1
  - Potential linked people to insert: HECTOR MARTINEZ x1
  - Phones: 4105709002
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#796

- 3 BRIGES CAFE -> 3 BRIDGE CAFE
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: no_db_write_existing_people_only
  - Candidate people: HECTOR x1
  - Potential linked people to insert: none
  - Phones: 4105709002
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1215

- JCE CONTRACTOR LLC -> JCE CONTRACTOR
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: CLAUDIO x4
  - Potential linked people to insert: CLAUDIO x4
  - Phones: 9086987793
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1668; WORK ORDER TERMINADOS Y PAGADOS#1669; WORK ORDER TERMINADOS Y PAGADOS#1670; WORK ORDER TERMINADOS Y PAGADOS#1671

- BLUE OCEAN POOL -> BLUE OCEAN POOL LLC
  - Decision: (blank)
  - Allowed values: approve_listed_people | approve_no_write | reject | needs_research
  - Proposed apply action: later_apply_may_insert_listed_people_only_after_dedupe
  - Candidate people: JOSE x3
  - Potential linked people to insert: JOSE x3
  - Phones: 6092559965; 9084205571
  - Source rows: WORK ORDER TERMINADOS Y PAGADOS#1154; WORK ORDER TERMINADOS Y PAGADOS#1173; WORK ORDER TERMINADOS Y PAGADOS#1174

## Excluded From Pass 1

- FELIX -> BLUE MOUNTAIN: hold_shared_contact_separate_business; Not a spelling/name/suffix variant row in MIS-148; keep out of Pass 1.
- GREEA -> GREEN 714: hold_shared_contact_separate_business; Not a spelling/name/suffix variant row in MIS-148; keep out of Pass 1.
- 3 BRIDGE RESTAURANT -> 3 BRIDGE CAFE: hold_shared_contact_separate_business; Not a spelling/name/suffix variant row in MIS-148; keep out of Pass 1.

