# MIS-146 AIT Signs Exact Linked People Backfill

- Generated at: 2026-06-08T05:42:53.635Z
- Mode: apply
- Workbook: /root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx
- Workbook hash: 5018f3b48e294eef670f1937958aaac6714b6aafe45b799b020d1249d238aa06
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Neon branch id: br-broad-hill-aptjpyea
- Current database: neondb

## Summary

- Exact-match client candidates reviewed: 825
- Planned linked people inserts: 636
- Applied linked people inserts: 636
- Existing linked people skipped: 0
- Distinct contacts affected: 549
- Primary person rows inserted: 549

## Guardrails

- Apply required --apply --confirm-staging: yes
- Only safe_reuse_existing_contact candidates from MIS-145 were eligible.
- Phone-only remaps, ambiguous candidates, new clients, archive/delete, and consolidation were not applied.
- Existing linked people with the same normalized name were skipped.

## Samples

- BLUE MOUNTAIN: FELIX (7328038578); primary=true; 2. ESTIMADOS#54
- BLUE MOUNTAIN: FELIZ (7328038578); primary=false; WORK ORDER TERMINADOS Y PAGADOS#753
- BLUE MOUNTAIN: FELIX - JEFF (5714550553); primary=false; WORK ORDER TERMINADOS Y PAGADOS#1465
- WORLD SUPERMARKET: RUDY (7324701825); primary=true; 3. 15 SIGNS WORK ORDER#164
- WORLD SUPERMARKET: SRA. EDY (9084829841); primary=false; WORK ORDER TERMINADOS Y PAGADOS#377
- WORLD SUPERMARKET: MR JESUS - BOUND BROOK (7326489269); primary=false; WORK ORDER TERMINADOS Y PAGADOS#1666
- WORLD SUPERMARKET: MRS. EDY - PLAINFIELD (9084829841); primary=false; WORK ORDER TERMINADOS Y PAGADOS#1601
- WORLD SUPERMARKET: DON JESUS; primary=false; WORK ORDER TERMINADOS Y PAGADOS#1415
- WORLD SUPERMARKET: FELIX/RUDY; primary=false; WORK ORDER TERMINADOS Y PAGADOS#1081
- WORLD SUPERMARKET: FRANKIE (NEW OWNER); primary=false; 2. ESTIMADOS#79
- WORLD SUPERMARKET: RUDDY (7324701825); primary=false; WORK ORDER TERMINADOS Y PAGADOS#1354
- WORLD SUPERMARKET: RUDY/ JESUS; primary=false; WORK ORDER TERMINADOS Y PAGADOS#1370
- WORLD SUPERMARKET: RUDYY; primary=false; WORK ORDER TERMINADOS Y PAGADOS#1416
- WORLD SUPERMARKET: SRA EDDY (9084829841); primary=false; WORK ORDER TERMINADOS Y PAGADOS#837
- IGLESIA DE DIOS VINO NUEVO: OSCAR (9084348374); primary=true; 3. 15 SIGNS WORK ORDER#36
- IGLESIA DE DIOS VINO NUEVO: HERCILIA (9086598518); primary=false; 3. 15 SIGNS WORK ORDER#18
- IGLESIA DE DIOS VINO NUEVO: ERCILIA (9086598518); primary=false; WORK ORDER TERMINADOS Y PAGADOS#1266
- DNC GUTTERS: DANNY (9083338210); primary=true; WORK ORDER TERMINADOS Y PAGADOS#523
- DNC GUTTERS: DANY (9087257444); primary=false; WORK ORDER TERMINADOS Y PAGADOS#508
- MR. HOODS: PERCY (7326484363); primary=true; WORK ORDER TERMINADOS Y PAGADOS#499
- 3G CONSTRUCTION: JOEL (3014559340); primary=true; WORK ORDER TERMINADOS Y PAGADOS#1077
- 3G CONSTRUCTION: JOEL GOMEZ (3014554340); primary=false; WORK ORDER TERMINADOS Y PAGADOS#1482
- 3G CONSTRUCTION: OMAR; primary=false; WORK ORDER TERMINADOS Y PAGADOS#1204
- DURABLE CONSTRUCTION: DAVID ACUNA (9085076553); primary=true; WORK ORDER TERMINADOS Y PAGADOS#262
- DURABLE CONSTRUCTION: DAVID (9085076553); primary=false; WORK ORDER TERMINADOS Y PAGADOS#1115

## Rollback Note

- Rows inserted by this script are tagged with source_label=ait_signs_estimate_exact_backfill.
