# MIS-145 AIT Signs Canonical Replacement Plan Dry Run

- Generated at: 2026-06-08T05:38:24.195Z
- Workbook: /root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx
- Workbook hash: 5018f3b48e294eef670f1937958aaac6714b6aafe45b799b020d1249d238aa06
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea

## Summary

- Current AIT Signs contacts: 903
- Workbook candidate clients: 1115
- Workbook target records reviewed: 1847
- Safe exact-reuse candidates: 825
- Phone-only remap review candidates: 262
- New client/contact candidates: 24
- Ambiguous hold candidates: 4
- Current contacts with no workbook candidate: 75
- Linked operational rows on no-candidate contacts: 166
- Current contacts targeted by multiple workbook candidates: 166

## Linked People Plan

- Safe linked people inserts/updates from exact matches: 636
- Linked people held behind phone-remap review: 240
- Linked people for new candidates: 17
- Linked people blocked by ambiguity: 8

## Verdict

- Do not run a destructive AIT Signs reset from this dry-run alone.
- The safe first apply slice is exact-match linked-people backfill, because it preserves existing contact ids and operational links.
- Phone-only remaps need human review before relabeling or consolidating contacts.
- No-candidate current contacts must be exported and reviewed before archive/delete because some still own linked operational rows.

## Phased Apply Recommendation

- Phase 1: exact-match repair only - reuse 825 current contacts and backfill 636 linked people/contact points.
- Phase 2: phone-remap review - inspect 262 workbook candidates and 166 current contacts targeted by multiple candidates.
- Phase 3: create-new candidates - add 24 workbook clients that have no current contact match after review.
- Phase 4: archive/remap review - decide what to do with 75 current contacts that do not appear in the workbook candidate feed.

## Examples

### Blue Mountain

- BLUE MOUNTAIN: safe_reuse_existing_contact; source rows 55; matches: BLUE MOUNTAIN (172 linked rows); people: FELIX x49, FELIZ x2, FELIX - JEFF x1
- GREAT BLUE MOUNTAIN: review_phone_remap; source rows 2; matches: VALVERDE LANDSCPING (18 linked rows); people: VICENTE x2
- GREAT BLUE MOUNTAINS: review_phone_remap; source rows 2; matches: VALVERDE LANDSCPING (18 linked rows); people: VICENTE x2
- MARK BLUE MOUNTAIN: create_new_candidate; source rows 1; matches: none; people: MARK CARRILLO x1

### G&R / RG Tree

- GR TREE SERVICE: review_phone_remap; source rows 8; matches: G&R TREE SERVICE (67 linked rows); people: GERARDO x5, GERARD x3
- G&R TREE SERVICE: safe_reuse_existing_contact; source rows 2; matches: G&R TREE SERVICE (67 linked rows); people: GERALDO x1, GERARDO x1
- GR TREEE SERVICE: create_new_candidate; source rows 2; matches: none; people: GERARD x2
- G.R TREE SERVICE: create_new_candidate; source rows 1; matches: none; people: GERARDO x1
- RG TREE SERVICE: safe_reuse_existing_contact; source rows 1; matches: RG TREE SERVICE (3 linked rows); people: RAUL GARCIA x1

### World Supermarket / Market

- WORLD SUPERMARKET: safe_reuse_existing_contact; source rows 34; matches: WORLD SUPERMARKET (82 linked rows); people: RUDY x14, SRA. EDY x3, MR JESUS - BOUND BROOK x2, MRS. EDY - PLAINFIELD x2, DON JESUS x1, FELIX/RUDY x1, FRANKIE (NEW OWNER) x1, RUDDY x1, RUDY/ JESUS x1, RUDYY x1, SRA EDDY x1
- WOLD SUPERMARKET: safe_reuse_existing_contact; source rows 2; matches: WOLD SUPERMARKET (27 linked rows); people: EDY x1
- WORLD SUPERMARKET (PLAINFIELD): review_phone_remap; source rows 2; matches: WOLD SUPERMARKET (27 linked rows); people: Mrs Edy x2
- WORD SUPERMARKET: safe_reuse_existing_contact; source rows 1; matches: WORD SUPERMARKET (2 linked rows); people: FELIX x1

## No Writes

- This command generated a plan only. It did not insert, update, delete, archive, or remap CRM data.
