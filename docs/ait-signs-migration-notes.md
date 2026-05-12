# AIT Signs migration notes

Source workbook:

- `/root/.openclaw/media/inbound/AiT_15_SIGNS_WORK-ESTIMATES---adcfba27-3c56-4bec-99ab-b5e05165f79d.xlsx`

This note is the first practical mapping pass from the workbook profile.

## Workbook shape

The workbook is not one table. It is a set of lifecycle tabs with shared operational vocabulary:

- `1. INTERESADOS` = prospects / lead intake
- `2. ESTIMADOS` = estimates waiting for approval
- `3. 15 SIGNS WORK ORDER` = active work orders / production
- `WORK ORDER TERMINADOS Y PAGADOS` = completed and paid archive
- `Sheet13` = empty/noise
- `Sheet12` = small calculation-like sheet with line-item math

The profile shows:

- `1. INTERESADOS`: 408 rows, 106 non-empty
- `2. ESTIMADOS`: 438 rows, 139 non-empty
- `3. 15 SIGNS WORK ORDER`: 860 rows, 269 non-empty
- `WORK ORDER TERMINADOS Y PAGADOS`: 2158 rows, 1818 non-empty

## What the source is really storing

The workbook mixes several concerns in the same row blocks:

- intake source
- customer/contact identity
- service request text
- Spanish status legends
- follow-up history
- payment/balance snapshots
- assignment hints
- delivery/progress notes
- archive/completion state

That means the import must split the source into normalized records plus timeline events, not one flat contact table.

## Normalized entities to build

Minimum staging model:

- `import_batches`
- `import_source_rows`
- `import_normalized_records`
- `import_review_items`
- `contacts`
- `leads`
- `estimates`
- `work_orders`
- `payment_snapshots`
- `activity_events`

Likely production model additions:

- `organizations`
- `business_units`
- `users`
- `roles`
- `permissions`
- `attachments`

## Primary dedupe signals

The strongest dedupe field is `phone`, but the source is messy enough that phone alone should not auto-merge everything.

Recommended dedupe priority:

1. normalized phone
2. contact/customer name
3. organization/business unit context
4. source sheet + source row
5. human review for conflicts

## Spanish status vocabulary seen in the workbook

These should become normalized statuses or review labels, not raw free text:

- `LO REALIZO EN OTRO LUGAR`
- `SOLICITO NO LLAMARLO`
- `VOLVER A LLAMAR NO CONTESTO`
- `SE CONTACTO, ESTA EN SEGUIMIENTO`
- `NO CONTESTO`
- `NO FUE APROBADO`
- `ESTAMOS EN CONVERSACIONES`
- `ESPERANDO RESPUESTA DE CLIENTE`
- `LISTO PARA ENTREGAR`
- `YA NO VA`
- `YA NO ES SU WHATSAPP`
- `INTERESADO NO SABE CUANDO VENDRA`
- `VINO, HNO A PAGAR $200 EN CASH`
- `ENTREGADO Y PAGADO`
- `ENTREGADO PENDIENTE DE COBRO`

Recommended normalized buckets:

- `new`
- `contacted`
- `follow_up`
- `quote_sent`
- `approved`
- `in_production`
- `ready_for_delivery`
- `delivered`
- `paid`
- `on_hold`
- `do_not_call`
- `lost`
- `wrong_number`

## Import rules

- Keep the original Spanish text in notes/timeline fields.
- Normalize dates, phone numbers, money values, and check/payment columns.
- Preserve source sheet name and source row on every imported record.
- Treat repeated follow-up columns as activity events.
- Treat balance/advance/payment columns as financial snapshots, not accounting ledger truth.
- Do not auto-import rows that are clearly section headers, notes, or blank separators.
- Route rows with conflicting phone/name/status values into review.

## Review cases that need human help

- ambiguous customer vs contact name rows
- rows where status text conflicts with the lifecycle sheet
- rows with duplicate phone numbers across different names
- rows where the same work order appears with different payment snapshots
- rows where Spanish note text appears to negate a prior state

## First implementation slice

Build the following before any production import:

1. workbook profiler
2. field inventory
3. lifecycle map
4. normalized status mapping draft
5. staging schema outline
6. import review queue design

This is enough to start the real backend work without pretending the source is clean.
