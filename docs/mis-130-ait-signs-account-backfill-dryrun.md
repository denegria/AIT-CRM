# MIS-130 AIT Signs Account Backfill Dry Run

## Summary

- Generated: 2026-06-07T16:47:08.807Z
- Dry run: yes
- Business unit: AIT Signs
- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- DB branch label: staging / br-broad-hill-aptjpyea
- DB host suffix: us-east-1.aws.neon.tech
- DB name: neondb
- Contacts client account column exists in DB: no

## Counts

- Total AIT Signs contacts: 903
- One-to-one account candidates: 795
- One-to-one candidates with operational history: 795
- One-to-one candidates without operational history: 0
- Duplicate/shared account-key groups held for consolidation: 1
- Contacts inside duplicate/shared groups: 2
- Near-duplicate account-key groups held for review: 32
- Contacts inside near-duplicate groups: 76
- Contacts held for review before account creation: 30

## Rules

- Account label source: `company_name` when present, otherwise `contacts.name`.
- A row is one-to-one only when its normalized account key is usable and unique within AIT Signs.
- Exact-unique rows are still held when their account key is a likely near-duplicate of another account key.
- Duplicate/shared keys stay out of this slice and should go through reviewed consolidation.
- This report does not import visible aliases or re-add cleaned misspellings.

## One-To-One Sample

- BLUE MOUNTAIN (4d74a98a-4ca3-473b-92ac-cf17be4ad0f2) — linked rows: 172
- IGLESIA DE DIOS VINO NUEVO (25c58413-c4a5-409e-9196-73e2dd1e04de) — linked rows: 95
- G&R TREE SERVICE (3b0f21df-f8e2-4b91-8225-b21bffde498d) — linked rows: 67
- DNC GUTTERS (ae4ebd9d-6028-4714-9568-9d3d4def2e3d) — linked rows: 48
- DURABLE CONSTRUCTION (30b2a1a4-d1c7-4748-ac14-b6b9d7bce788) — linked rows: 41
- MISTER HOODS (c275b1a3-ab22-4697-9a29-5d9b4b919770) — linked rows: 38
- GREGORIO MEAT MARKET (afdf536a-871e-486b-8ef0-0dd4750cd180) — linked rows: 33
- LIFETIME CONSTRUCTION (7d0383d1-1671-416d-8278-5acfa15683c9) — linked rows: 32
- BRENMA TREE SERVICE (27f30092-1679-47a6-b986-7a8f5734ae10) — linked rows: 30
- JBP CONTRACTOR (950021da-5339-4043-a374-17ee3e16fa16) — linked rows: 30
- ROJAS TANSPORTATIONS (adc4477d-8cd9-4bf2-b25f-bbf186d7a645) — linked rows: 30
- BEST AMERICAN ROOFING (f9bda97c-a4ca-44f6-b59b-f1a1e101e6e6) — linked rows: 29
- PENTAGON CONSTRUCTION (82aaf199-b517-45d7-aadb-d188482d138f) — linked rows: 27
- NJ TREE EXPERT (52d44e78-a7fa-4e4a-90d3-76e1164109bf) — linked rows: 26
- WOODLAND (f1af9d9f-3b5f-4636-8a91-efc1478b0232) — linked rows: 26
- 3G CONSTRUCTION (9ed6a93e-564b-41b1-9dda-b3a40b7fde95) — linked rows: 23
- CANO TRUCK SERVICE (3704b3ac-aa41-46d8-bde2-9bd6057756c9) — linked rows: 22
- CRISPANCHOS BAKERY RESTAURANT (4a3554bb-40ea-4e11-ba5e-c0fda3efd7f2) — linked rows: 22
- EFFY MOBILE MECHANICAL SERVICES (1c14b21f-dad4-4861-914a-0bef202f098b) — linked rows: 22
- ART BY LORELAY (d7b59edd-a233-4307-8aaa-7d411212f7f3) — linked rows: 21

## Duplicate/Consolidation Sample

- RINCON HONDURENO / RINCON HONDUREÑO — contacts: 2, linked rows: 8, key: rinconhondureno

## Near-Duplicate Review Sample

- US ATHELETIC FIELD / USA ATHLETIC FIELD / USA ATTHLETICFIELD / USAF ATHLETIC FIELDS — contacts: 4, linked rows: 53, keys: usaathleticfield, usaatthleticfield, usafathleticfields, usatheleticfield
- BEAUTIFUL FLOOR / BEAUTIFUL FLOORS / BEUATIFUL FLOOR / BEUTIFUL FLOOR — contacts: 4, linked rows: 48, keys: beautifulfloor, beautifulfloors, beuatifulfloor, beutifulfloor
- WOLD SUPERMARKET / WORD SUPERMARKET / WORLD SUPERMARKET — contacts: 3, linked rows: 111, keys: woldsupermarket, wordsupermarket, worldsupermarket
- DINO TREE SERVICE / DINOS FREE SERVICE / DINOS TREE SERVICE — contacts: 3, linked rows: 40, keys: dinosfreeservice, dinostreeservice, dinotreeservice
- R. VALVERDE LANDSCAPING / VALVERDE LANDSCAPING / VALVERDE LANDSCPING — contacts: 3, linked rows: 29, keys: rvalverdelandscaping, valverdelandscaping, valverdelandscping
- ATANANTA IRON WORKS / TANANTA IRON WORK / TANANTA IRON WORKS — contacts: 3, linked rows: 23, keys: atanantaironworks, tanantaironwork, tanantaironworks
- RAMON LANDSCAPING / RAMON LANDSCPAING / RAMONS LANDSCAPING — contacts: 3, linked rows: 21, keys: ramonlandscaping, ramonlandscpaing, ramonslandscaping
- LEOPARD TREE SERVICE / LEOPARDS TREE SERVICE / LEOPORD FREE SERVICE — contacts: 3, linked rows: 17, keys: leopardstreeservice, leopardtreeservice, leopordfreeservice
- CALIBRI LANSCAPING / COLIBRI LANDSCAPING / COLIBRI LANSCAPING — contacts: 3, linked rows: 11, keys: calibrilanscaping, colibrilandscaping, colibrilanscaping
- CABALLERO FANCE / CABALLERO FEACE / CABALLERO FENCE — contacts: 3, linked rows: 8, keys: caballerofance, caballerofeace, caballerofence
- ELEPHANT LANDSCAPING / ELEPHANT LANSCAPING — contacts: 2, linked rows: 31, keys: elephantlandscaping, elephantlanscaping
- MUR CLEANING / MVR CLEANING — contacts: 2, linked rows: 28, keys: murcleaning, mvrcleaning
- LA PUPUSA LOCA / LA PUPUSO LOCA — contacts: 2, linked rows: 25, keys: lapupusaloca, lapupusoloca
- AMAYA PAINTING / AMAYA PAITING — contacts: 2, linked rows: 21, keys: amayapainting, amayapaiting
- JACO MOVER / JACO MOVERS — contacts: 2, linked rows: 19, keys: jacomover, jacomovers
- ROYAL GARDEN / ROYAR GARDEN — contacts: 2, linked rows: 14, keys: royalgarden, royargarden
- IGLESIA CRISTO DE LA FUENTE DE VIDA ETERNA / IGLESIA CRISTO LA FUENTE DE VIDA ETERNA — contacts: 2, linked rows: 12, keys: iglesiacristodelafuentedevidaeterna, iglesiacristolafuentedevidaeterna
- HORTENSIA CLEANING / HORTENSIAS CLEANING — contacts: 2, linked rows: 12, keys: hortensiacleaning, hortensiascleaning
- HAVANAS HOME IMPROVEMENT / HAVANIAS HOME IMPROVEMENT — contacts: 2, linked rows: 11, keys: havanashomeimprovement, havaniashomeimprovement
- PATRICIA SABOR CASERO / PATRICIO SABOR CACERO — contacts: 2, linked rows: 10, keys: patriciasaborcasero, patriciosaborcacero

## Review Sample

- -- (98f420f0-7a09-4747-b30c-f270b728ed12) — reasons: low_signal_or_missing_account_label, linked rows: 6
- ROOFING (18474449-14bc-4ff4-bbe2-7550925f1271) — reasons: low_signal_or_missing_account_label, linked rows: 5
- ------- (ac9ae153-3f04-4488-a203-cb548f183478) — reasons: low_signal_or_missing_account_label, linked rows: 4
- LANDSCAPING (16f0bf2d-6319-4ab9-a01c-7482c16e1bca) — reasons: low_signal_or_missing_account_label, linked rows: 4
- READY (54838c5f-403e-4a42-9561-c1a402378654) — reasons: low_signal_or_missing_account_label, linked rows: 4
- Unknown AIT Signs Contact (002c66af-81f4-4d1c-84ab-db9347bfb676) — reasons: low_signal_or_missing_account_label, linked rows: 4
- RR (a1dfe38c-bf60-4fcb-9d45-8099177b2c08) — reasons: low_signal_or_missing_account_label, linked rows: 3
- -- (38165920-fc39-47d8-84b2-086b114d6a4f) — reasons: low_signal_or_missing_account_label, linked rows: 2
- -- (698fe288-13d9-4c9e-8f3f-9987916e1af2) — reasons: low_signal_or_missing_account_label, linked rows: 2
- -- (c0ee62ca-72ce-4427-92ac-23fbec63e5b7) — reasons: low_signal_or_missing_account_label, linked rows: 2
- --- (8481a353-5f8d-4eb2-a73f-609948ed3498) — reasons: low_signal_or_missing_account_label, linked rows: 2
- ------- (08fb6e96-9114-4fc2-b979-86239185a450) — reasons: low_signal_or_missing_account_label, linked rows: 2
- ------- (7276a697-27eb-4e33-994f-bcf6f1c4980f) — reasons: low_signal_or_missing_account_label, linked rows: 2
- ------- (839b7c86-a474-42f5-893c-aad827c997d3) — reasons: low_signal_or_missing_account_label, linked rows: 2
- ------- (88c59600-0f9e-43ee-86e9-d295507c0935) — reasons: low_signal_or_missing_account_label, linked rows: 2
- HOME IMPROVEMENT (2eb5fa6f-4d1a-4dda-a70f-aa0f2b5f9d6e) — reasons: low_signal_or_missing_account_label, linked rows: 2
- READY (38c83cb2-6773-4b6a-a485-95f44d3c1654) — reasons: low_signal_or_missing_account_label, linked rows: 2
- READY (bf4d2628-1dfe-4735-bf3c-37cede4301be) — reasons: low_signal_or_missing_account_label, linked rows: 2
- Unknown AIT Signs Contact (02a8bc8e-1db4-4ff7-9e84-4ec35b98c6e4) — reasons: low_signal_or_missing_account_label, linked rows: 2
- Unknown AIT Signs Contact (104934a0-e9c0-4d3e-a070-03da4622ec9c) — reasons: low_signal_or_missing_account_label, linked rows: 2

## Next Step

Use this report to review the one-to-one candidate count and sample. Applying the schema migration and any account inserts should remain a separate approval-gated DB write.
