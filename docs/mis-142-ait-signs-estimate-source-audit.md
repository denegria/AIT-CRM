# MIS-142 AIT Signs Estimate Source Audit

- Generated at: 2026-06-08T05:11:39.752Z
- Workbook: /root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx
- Workbook hash: 5018f3b48e294eef670f1937958aaac6714b6aafe45b799b020d1249d238aa06
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea

## Summary

- Current AIT Signs contacts: 903
- Target workbook records reviewed: 1847
- Candidate clients from target sheets: 1115
- Candidate linked people from contact column: 901
- Candidate clients with exact current contact match: 825
- Candidate clients with phone-only match: 262
- Candidate clients unmatched in current contacts: 24
- Ambiguous candidate matches: 4
- Current contacts without workbook candidate match: 75

## Sheet Contact Column Signal

- 2. ESTIMADOS: 63 target records; 63 with customer; 58 with contact column; 52 valid person candidates; 55 with phone.
- 3. 15 SIGNS WORK ORDER: 205 target records; 205 with customer; 197 with contact column; 191 valid person candidates; 168 with phone.
- WORK ORDER TERMINADOS Y PAGADOS: 1579 target records; 1578 with customer; 1279 with contact column; 1171 valid person candidates; 1279 with phone.

## Interpretation

- Paid/finished and work-order sheets have enough structure to become the source-of-truth candidate feed.
- The workbook contact column should feed linked people/contact points, not replace the client display name.
- Do not delete current AIT Signs data from this report alone; use a replacement/remap dry-run so operational rows stay attached.
- 75 current AIT Signs contacts do not have an exact/phone candidate match yet, covering 166 linked operational rows. These need remap/archive decisions before replacement.

## Examples

### Blue Mountain

- BLUE MOUNTAIN: exact_name; source rows 55; matches: BLUE MOUNTAIN (172 linked rows); people: FELIX x49, FELIZ x2, FELIX - JEFF x1
- GREAT BLUE MOUNTAIN: phone_only; source rows 2; matches: VALVERDE LANDSCPING (18 linked rows); people: VICENTE x2
- GREAT BLUE MOUNTAINS: phone_only; source rows 2; matches: VALVERDE LANDSCPING (18 linked rows); people: VICENTE x2
- MARK BLUE MOUNTAIN: unmatched; source rows 1; matches: none; people: MARK CARRILLO x1

### G&R / RG Tree

- GR TREE SERVICE: phone_only; source rows 8; matches: G&R TREE SERVICE (67 linked rows); people: GERARDO x5, GERARD x3
- G&R TREE SERVICE: exact_name; source rows 2; matches: G&R TREE SERVICE (67 linked rows); people: GERALDO x1, GERARDO x1
- GR TREEE SERVICE: unmatched; source rows 2; matches: none; people: GERARD x2
- G.R TREE SERVICE: unmatched; source rows 1; matches: none; people: GERARDO x1
- RG TREE SERVICE: exact_name; source rows 1; matches: RG TREE SERVICE (3 linked rows); people: RAUL GARCIA x1

### World Supermarket / Market

- WORLD SUPERMARKET: exact_name; source rows 34; matches: WORLD SUPERMARKET (82 linked rows); people: RUDY x14, SRA. EDY x3, MR JESUS - BOUND BROOK x2, MRS. EDY - PLAINFIELD x2, DON JESUS x1, FELIX/RUDY x1, FRANKIE (NEW OWNER) x1, RUDDY x1
- WORLD SUPERMARKET (PLAINFIELD): phone_only; source rows 2; matches: WOLD SUPERMARKET (27 linked rows); people: Mrs Edy x2

## Next Step

- Use this report to decide whether the estimate/work-order workbook should repair current AIT Signs contacts or drive a staging-only canonical replacement dry-run.
- No data was written by this audit.
