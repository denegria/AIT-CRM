# AIT Signs staging preview

This is the first row-level pass over the workbook after the profile and schema draft.

## Row kind counts

- `record_candidate`: 1980
- `financial_line`: 289
- `blank`: 1532
- `misc_text`: 35
- `section_header`: 21
- `header`: 4
- `note`: 6

## What that means

Most non-empty rows are likely usable as staged CRM content, but the workbook also has a significant amount of note text, section separators, and financial-only rows.

That reinforces the import approach:

- raw row capture first
- classify row kind
- normalize obvious records
- route ambiguous rows to review

## Sample record candidates

- `1. INTERESADOS #9`: `1.0 | FB | 45329.0 | ISRAEL | 973 687 4166 | LLAMAR DE NUEVO EN LA TARDE, ROMAN/ 3/28- 09:44 AM`
- `1. INTERESADOS #11`: `2.0 | FB | 45329.0 | 973 224 7702 | LLAMAR DE NUEVO EN LA TARDE, ROMAN/ 3/28- 09:46 AM`
- `1. INTERESADOS #13`: `3 | FB | 609 802 4421 | HACEN BANDERAS | LLAMAR DE NUEVO EN LA TARDE, ROMAN/ 3/28- 09:48 AM`
- `2. ESTIMADOS #39`: `29 | SI | NO | 45346.0 | LIAMS TREE SERVICE | BRYAN | 908 5484307 | CREAR LOGO ... | $ 2300.9675`
- `3. 15 SIGNS WORK ORDER #?`: many rows include actual production context plus payment and follow-up values

## Sample notes

- `P  R  I  N  T  I  N  G | VOLVER A LLAMAR NO CONTESTO`
- `WEB PAGE & DIGITAL ADS | SE CONTACTO, ESTA EN SEGUIMIENTO`
- `ENTREGADO Y PAGADO`
- `ENTREGADO PENDIENTE DE COBRO`

## Sample section headers

- `PROSPECTOS O INTERESADOS`
- `NOTA: CUANDO CLIENTE, DEBE MOVER A "15 WORK ORDER"`
- `DEBE PASAR DE ESTIMADO A 15 WORK ORDER`
- `WORK ORDER - CENTRAL - OFICIAL`

## Next backend slice

Use this preview to build:

1. import batch tables
2. source-row staging tables
3. normalized staging records
4. human review queue
5. first production entity mappings
