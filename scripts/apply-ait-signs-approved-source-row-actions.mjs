#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_OUTPUT = 'docs/mis-168-ait-signs-approved-source-row-actions-dry-run.json';
const SOURCE_LABEL = 'ait_signs_mis168_approved_source_row_actions';
const CANONICAL_PHT = 'PHT CONTRACTOR';

const APPROVALS = [
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#1538', decision: 'blue mountain', action: 'status_normalized_note_imported', targetClient: 'BLUE MOUNTAIN' },
  { key: '3. 15 SIGNS WORK ORDER#135', decision: 'JAIME ARRIAGA HOME IMPROVEMENT', action: 'status_review_item_imported', targetClient: 'JAIME ARRIAGA HOME IMPROVEMENT', personName: 'JAIME ARRIAGA', phone: '9083802643' },
  { key: '3. 15 SIGNS WORK ORDER#141', decision: 'Green 714 Llc', action: 'status_review_item_imported', targetClient: 'GREEN 714', personName: 'EDIGAN ARIAS', phone: '9085468462' },
  { key: '3. 15 SIGNS WORK ORDER#122', decision: 'PHT contractor/construction', action: 'create_note_and_merge_pht', targetClient: CANONICAL_PHT, personName: 'MARIO', phone: '7328902573' },
  { key: '2. ESTIMADOS#83', decision: 'xtreme klean', action: 'create_estimate', targetClient: 'XTREEM KLEEN', personName: 'MIKE' },
  { key: '2. ESTIMADOS#84', decision: 'xtreme klean', action: 'create_estimate', targetClient: 'XTREEM KLEEN', personName: 'MIKE' },
  { key: '3. 15 SIGNS WORK ORDER#86', decision: 'new client', action: 'create_work_order', targetClient: 'TRIM KING', personName: 'WAYNE' },
  { key: '3. 15 SIGNS WORK ORDER#107', decision: 'new client', action: 'create_work_order', targetClient: 'JUANITA', personName: 'JUANITA' },
  { key: '3. 15 SIGNS WORK ORDER#127', decision: 'new client', action: 'create_work_order', targetClient: 'AUTO CHIP CORP', personName: 'HENRI VALENCIA', phone: '9082964306' },
  { key: '3. 15 SIGNS WORK ORDER#171', decision: 'new client', action: 'create_work_order', targetClient: 'AUTO CHIP CORP', personName: 'HENRI VALENCIA', phone: '9082964306' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#1701', decision: 'new client', action: 'reassign_existing_work_order', targetClient: 'TAROT' },
  { key: '2. ESTIMADOS#52', decision: 'pavement specialists', action: 'reassign_existing_estimate', targetClient: 'PAVEMENT SPECIALISTS', personName: 'JHON' },
];

function parseArgs(argv) {
  const options = { apply: false, output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--output') {
      options.output = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function loadSecrets() {
  try {
    return JSON.parse(await readFile('/root/.openclaw/secrets.json', 'utf8'));
  } catch {
    return {};
  }
}

async function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const secrets = await loadSecrets();
  return secrets.aitCrm?.staging?.databaseUrl || '';
}

async function safeFingerprint(client) {
  const secrets = await loadSecrets();
  const databaseUrl = secrets.aitCrm?.staging?.databaseUrl || '';
  const url = databaseUrl ? new URL(databaseUrl) : null;
  const db = await client.query('select current_database() as database');
  return {
    expectedNeonBranchId: EXPECTED_BRANCH_ID,
    targetBaseUrl: secrets.aitCrm?.staging?.baseUrl || null,
    hostSuffix: url ? url.hostname.split('.').slice(0, 2).join('.') : null,
    currentDatabase: db.rows[0]?.database || null,
  };
}

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

function phoneDigits(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function sourceKey(row) {
  return `${row.source_sheet}#${Number(row.source_row_number)}`;
}

function splitKey(key) {
  const index = key.lastIndexOf('#');
  return { sourceSheet: key.slice(0, index), sourceRowNumber: Number(key.slice(index + 1)) };
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('; ') : clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function by(rows, field) {
  return rows.reduce((acc, row) => {
    const value = row[field] || '';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function parseRaw(rawText) {
  const parts = String(rawText || '').split('|').map(clean);
  return { parts };
}

function fieldFor(row, index) {
  return parseRaw(row.raw_text).parts[index] || '';
}

function sourceRowOrdinal(row) {
  return Number(fieldFor(row, 0)) || Number(row.source_row_number);
}

function sourceDateSerial(row) {
  return Number(fieldFor(row, row.source_sheet === 'WORK ORDER TERMINADOS Y PAGADOS' ? 3 : 1)) || null;
}

function workDescriptionFor(row) {
  if (row.source_sheet === '2. ESTIMADOS') return fieldFor(row, 4);
  if (row.source_sheet === 'WORK ORDER TERMINADOS Y PAGADOS') return fieldFor(row, 5);
  return fieldFor(row, 4);
}

function noteTextFor(row) {
  const parts = parseRaw(row.raw_text).parts;
  if (row.source_sheet === '2. ESTIMADOS') return parts.slice(6).join(' | ');
  if (row.source_sheet === '3. 15 SIGNS WORK ORDER') return parts.slice(5).join(' | ');
  return parts.join(' | ');
}

function amountsFor(row) {
  const nums = parseRaw(row.raw_text).parts
    .map((part) => Number(part.replace(/[$,]/g, '')))
    .filter((value) => Number.isFinite(value));
  const tail = nums.slice(-4);
  return {
    subtotal: tail[0] ?? null,
    tax: tail[1] ?? null,
    total: tail[2] ?? null,
    balance: tail[3] ?? null,
  };
}

async function loadContext(client) {
  const result = await client.query(
    `
      select ib.id, ib.organization_id, ib.business_unit_id
      from import_batches ib
      join business_units bu on bu.id = ib.business_unit_id
      where bu.name = $1
        and ib.source_type = 'xlsx'
      order by ib.created_at desc
      limit 1
    `,
    [BUSINESS_UNIT],
  );
  if (!result.rowCount) throw new Error(`No latest XLSX batch found for ${BUSINESS_UNIT}`);
  return {
    batchId: result.rows[0].id,
    organizationId: result.rows[0].organization_id,
    businessUnitId: result.rows[0].business_unit_id,
  };
}

async function loadSourceState(client, context) {
  const keys = APPROVALS.map((approval) => splitKey(approval.key));
  const result = await client.query(
    `
      select
        sr.id as source_row_id,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text,
        nr.id as normalized_record_id,
        nr.record_type,
        nr.status as normalized_status,
        ri.id as review_item_id,
        ri.review_type,
        ri.review_status
      from import_source_rows sr
      left join import_normalized_records nr on nr.import_batch_id = sr.import_batch_id
        and nr.source_row_id = sr.id
      left join import_review_items ri on ri.import_batch_id = sr.import_batch_id
        and ri.source_row_id = sr.id
      where sr.import_batch_id = $1
        and (sr.source_sheet, sr.source_row_number) in (
          select source_sheet, source_row_number
          from jsonb_to_recordset($2::jsonb) as x(source_sheet text, source_row_number int)
        )
      order by sr.source_sheet, sr.source_row_number
    `,
    [context.batchId, JSON.stringify(keys.map((key) => ({ source_sheet: key.sourceSheet, source_row_number: key.sourceRowNumber })))],
  );
  return result.rows.reduce((acc, row) => {
    const key = sourceKey(row);
    const rows = acc.get(key) || [];
    rows.push(row);
    acc.set(key, rows);
    return acc;
  }, new Map());
}

async function findContacts(client, context, name) {
  const key = normalizeKey(name);
  const result = await client.query(
    `
      select id, name, company_name, phone, email, source_label
      from contacts
      where organization_id = $1
        and primary_business_unit_id = $2
        and (
          regexp_replace(lower(coalesce(company_name, '')), '[^a-z0-9]', '', 'g') = $3
          or regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]', '', 'g') = $3
        )
      order by created_at asc
    `,
    [context.organizationId, context.businessUnitId, key],
  );
  return result.rows;
}

async function findOrCreateContact(client, context, name, phone, apply, planned) {
  const matches = await findContacts(client, context, name);
  if (matches.length === 1) return { contact: matches[0], action: 'reuse_existing_contact' };
  if (matches.length > 1) return { contact: null, action: 'hold_multiple_exact_contacts', matches };

  if (!apply) {
    planned.dryContacts ||= new Map();
    const key = normalizeKey(name);
    if (planned.dryContacts.has(key)) {
      return { contact: planned.dryContacts.get(key), action: 'reuse_planned_contact' };
    }
    const contact = {
      id: `dry-contact:${normalizeKey(name)}`,
      name,
      company_name: name,
      phone: phone || null,
    };
    planned.dryContacts.set(key, contact);
    return { contact, action: 'create_contact' };
  }

  const result = await client.query(
    `
      insert into contacts (
        organization_id,
        primary_business_unit_id,
        name,
        company_name,
        phone,
        source_label
      )
      values ($1, $2, $3, $3, nullif($4, ''), $5)
      returning id, name, company_name, phone, email, source_label
    `,
    [context.organizationId, context.businessUnitId, name, phone || '', SOURCE_LABEL],
  );
  planned.createdContacts += 1;
  return { contact: result.rows[0], action: 'create_contact' };
}

async function ensurePerson(client, context, contactId, personName, phone, apply, planned) {
  if (!personName || !contactId) return 'no_person_write';
  if (!apply && String(contactId).startsWith('dry-contact:')) {
    planned.dryPeople ||= new Set();
    const key = `${contactId}:${normalizeKey(personName)}:${phoneDigits(phone || '')}`;
    if (planned.dryPeople.has(key)) return 'person_already_planned';
    planned.dryPeople.add(key);
    return 'create_person';
  }
  const personKey = normalizeKey(personName);
  const phoneKey = phoneDigits(phone || '');
  const existing = await client.query(
    `
      select id
      from contact_people
      where contact_id = $1
        and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = $2
        and coalesce(regexp_replace(phone, '[^0-9]', '', 'g'), '') = $3
      limit 1
    `,
    [contactId, personKey, phoneKey],
  );
  if (existing.rowCount) return 'person_already_exists';
  if (!apply) return 'create_person';
  await client.query(
    `
      insert into contact_people (
        organization_id,
        business_unit_id,
        contact_id,
        name,
        phone,
        is_primary,
        source_label
      )
      values ($1, $2, $3, $4, nullif($5, ''), false, $6)
    `,
    [context.organizationId, context.businessUnitId, contactId, personName, phone || '', SOURCE_LABEL],
  );
  planned.createdPeople += 1;
  return 'create_person';
}

async function existingActivity(client, context, row, eventType) {
  const result = await client.query(
    `
      select id, contact_id, estimate_id, work_order_id
      from activity_events
      where business_unit_id = $1
        and source_sheet = $2
        and source_row = $3
        and event_type = $4
      limit 1
    `,
    [context.businessUnitId, row.source_sheet, row.source_row_number, eventType],
  );
  return result.rows[0] || null;
}

async function markReviewItemImported(client, row, resolution, apply, planned) {
  if (!row.review_item_id) return 'no_review_item';
  if (row.review_status === 'imported') return 'already_imported';
  if (row.review_status !== 'pending') return `hold_review_status_${row.review_status}`;
  if (!apply) return 'mark_review_item_imported';
  const result = await client.query(
    `
      update import_review_items
      set review_status = 'imported',
          reviewed_at = now(),
          updated_at = now(),
          proposed_resolution_json = coalesce(proposed_resolution_json, '{}'::jsonb) || $2::jsonb
      where id = $1
        and review_status = 'pending'
      returning id
    `,
    [row.review_item_id, JSON.stringify(resolution)],
  );
  planned.updatedReviewItems += result.rowCount || 0;
  return result.rowCount ? 'mark_review_item_imported' : 'review_item_not_updated';
}

async function markNormalizedImported(client, row, apply, planned) {
  if (!row.normalized_record_id) return 'no_normalized_record';
  if (row.normalized_status === 'imported') return 'already_imported';
  if (row.normalized_status !== 'pending') return `hold_normalized_status_${row.normalized_status}`;
  if (!apply) return 'mark_normalized_imported';
  const result = await client.query(
    `
      update import_normalized_records
      set status = 'imported'
      where id = $1
        and status = 'pending'
      returning id
    `,
    [row.normalized_record_id],
  );
  planned.updatedNormalizedRecords += result.rowCount || 0;
  return result.rowCount ? 'mark_normalized_imported' : 'normalized_not_updated';
}

async function createEstimate(client, context, row, contact, apply, planned) {
  const existing = await existingActivity(client, context, row, 'import_promoted_estimate');
  if (existing) return { action: 'already_promoted_estimate', estimateId: existing.estimate_id };
  const amounts = amountsFor(row);
  const sourceRow = sourceRowOrdinal(row);
  if (!apply) return { action: 'create_estimate', estimateId: `dry-estimate:${sourceKey(row)}` };
  const estimate = await client.query(
    `
      insert into estimates (
        organization_id,
        business_unit_id,
        contact_id,
        estimate_number,
        status,
        subtotal,
        tax,
        total
      )
      values ($1, $2, $3, $4, 'Open', $5, $6, $7)
      returning id
    `,
    [context.organizationId, context.businessUnitId, contact.id, `AIT-EST-${sourceRow}`, amounts.subtotal, amounts.tax, amounts.total],
  );
  const estimateId = estimate.rows[0].id;
  await client.query(
    `
      insert into activity_events (
        organization_id,
        business_unit_id,
        contact_id,
        estimate_id,
        event_type,
        message,
        source_sheet,
        source_row,
        occurred_at
      )
      values ($1, $2, $3, $4, 'import_promoted_estimate', $5, $6, $7, now())
    `,
    [context.organizationId, context.businessUnitId, contact.id, estimateId, row.raw_text, row.source_sheet, row.source_row_number],
  );
  planned.createdEstimates += 1;
  planned.createdActivityEvents += 1;
  return { action: 'create_estimate', estimateId };
}

async function createWorkOrder(client, context, row, contact, apply, planned) {
  const existing = await existingActivity(client, context, row, 'import_promoted_work_order');
  if (existing) return { action: 'already_promoted_work_order', workOrderId: existing.work_order_id };
  const amounts = amountsFor(row);
  const title = workDescriptionFor(row) || contact.company_name || contact.name;
  const sourceRow = sourceRowOrdinal(row);
  if (!apply) return { action: 'create_work_order', workOrderId: `dry-work-order:${sourceKey(row)}` };
  const workOrder = await client.query(
    `
      insert into work_orders (
        organization_id,
        business_unit_id,
        contact_id,
        work_order_number,
        title,
        status,
        priority,
        description,
        estimated_cost
      )
      values ($1, $2, $3, $4, $5, 'Open', 'Medium', $6, $7)
      returning id
    `,
    [context.organizationId, context.businessUnitId, contact.id, `AIT-WO-ACT-${sourceRow}`, title.slice(0, 220), row.raw_text, amounts.total || amounts.subtotal],
  );
  const workOrderId = workOrder.rows[0].id;
  await client.query(
    `
      insert into activity_events (
        organization_id,
        business_unit_id,
        contact_id,
        work_order_id,
        event_type,
        message,
        source_sheet,
        source_row,
        occurred_at
      )
      values ($1, $2, $3, $4, 'import_promoted_work_order', $5, $6, $7, now())
    `,
    [context.organizationId, context.businessUnitId, contact.id, workOrderId, row.raw_text, row.source_sheet, row.source_row_number],
  );
  planned.createdWorkOrders += 1;
  planned.createdActivityEvents += 1;
  return { action: 'create_work_order', workOrderId };
}

async function createNote(client, context, row, contact, workOrderId, apply, planned) {
  const existing = await existingActivity(client, context, row, 'import_promoted_note');
  if (existing) return { action: 'already_promoted_note' };
  const body = noteTextFor(row) || row.raw_text;
  if (!apply) return { action: 'create_note' };
  const note = await client.query(
    `
      insert into notes (
        organization_id,
        business_unit_id,
        contact_id,
        work_order_id,
        body
      )
      values ($1, $2, $3, $4, $5)
      returning id
    `,
    [context.organizationId, context.businessUnitId, contact.id, workOrderId || null, body],
  );
  await client.query(
    `
      insert into activity_events (
        organization_id,
        business_unit_id,
        contact_id,
        work_order_id,
        event_type,
        message,
        source_sheet,
        source_row,
        occurred_at
      )
      values ($1, $2, $3, $4, 'import_promoted_note', $5, $6, $7, now())
    `,
    [context.organizationId, context.businessUnitId, contact.id, workOrderId || null, body, row.source_sheet, row.source_row_number],
  );
  planned.createdNotes += 1;
  planned.createdActivityEvents += 1;
  return { action: 'create_note', noteId: note.rows[0].id };
}

async function reassignExisting(client, context, row, contact, type, apply, planned) {
  const eventType = type === 'estimate' ? 'import_promoted_estimate' : 'import_promoted_work_order';
  const existing = await existingActivity(client, context, row, eventType);
  if (!existing) return { action: `hold_missing_existing_${type}` };
  if (existing.contact_id === contact.id) return { action: `already_assigned_${type}` };
  if (!apply) return { action: `reassign_existing_${type}`, fromContactId: existing.contact_id, toContactId: contact.id };
  if (type === 'estimate' && existing.estimate_id) {
    await client.query('update estimates set contact_id = $1, updated_at = now() where id = $2', [contact.id, existing.estimate_id]);
    planned.reassignedEstimates += 1;
  }
  if (type === 'work_order' && existing.work_order_id) {
    await client.query('update work_orders set contact_id = $1, updated_at = now() where id = $2', [contact.id, existing.work_order_id]);
    planned.reassignedWorkOrders += 1;
  }
  const result = await client.query(
    `
      update activity_events
      set contact_id = $1
      where business_unit_id = $2
        and source_sheet = $3
        and source_row = $4
        and event_type = $5
        and contact_id = $6
      returning id
    `,
    [contact.id, context.businessUnitId, row.source_sheet, row.source_row_number, eventType, existing.contact_id],
  );
  planned.reassignedActivityEvents += result.rowCount || 0;
  return { action: `reassign_existing_${type}`, fromContactId: existing.contact_id, toContactId: contact.id };
}

async function mergePhtDuplicates(client, context, apply, planned) {
  const canonical = (await findContacts(client, context, CANONICAL_PHT))[0];
  if (!canonical) return { action: 'hold_missing_pht_canonical' };
  const duplicateNames = ['PH TCONTRACTON', 'PHT CONSTRUCTION'];
  const duplicates = [];
  for (const name of duplicateNames) {
    duplicates.push(...await findContacts(client, context, name));
  }
  if (!duplicates.length) return { action: 'already_merged_pht', canonicalContactId: canonical.id };

  const movedRefs = {};
  if (!apply) {
    return {
      action: 'merge_pht_duplicates',
      canonicalContactId: canonical.id,
      duplicateContactIds: duplicates.map((contact) => contact.id),
    };
  }

  for (const duplicate of duplicates) {
    const people = await client.query(
      'select id, name, phone, role, email, notes, is_primary, source_label, source_sheet, source_row, metadata_json from contact_people where contact_id = $1',
      [duplicate.id],
    );
    for (const person of people.rows) {
      const exists = await client.query(
        `
          select id
          from contact_people
          where contact_id = $1
            and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = $2
            and coalesce(regexp_replace(phone, '[^0-9]', '', 'g'), '') = $3
          limit 1
        `,
        [canonical.id, normalizeKey(person.name), phoneDigits(person.phone || '')],
      );
      if (exists.rowCount) {
        await client.query('delete from contact_people where id = $1', [person.id]);
        planned.deletedDuplicatePeople += 1;
      } else {
        await client.query('update contact_people set contact_id = $1, is_primary = false, updated_at = now() where id = $2', [canonical.id, person.id]);
        planned.movedPeople += 1;
      }
    }

    for (const table of ['activity_events', 'work_orders', 'estimates', 'notes', 'tasks', 'leads', 'conversation_messages', 'conversations', 'follow_up_sequence_enrollments', 'follow_up_sequence_step_runs']) {
      const result = await client.query(`update ${table} set contact_id = $1 where contact_id = $2`, [canonical.id, duplicate.id]);
      movedRefs[table] = (movedRefs[table] || 0) + (result.rowCount || 0);
    }
    await client.query('delete from contacts where id = $1', [duplicate.id]);
    planned.deletedContacts += 1;
  }

  await client.query(
    `
      insert into notes (
        organization_id,
        business_unit_id,
        contact_id,
        body
      )
      values ($1, $2, $3, $4)
    `,
    [
      context.organizationId,
      context.businessUnitId,
      canonical.id,
      `MIS-168 merged remaining PHT duplicate contact shells into PHT CONTRACTOR: ${duplicates.map((contact) => contact.company_name || contact.name).join(', ')}.`,
    ],
  );
  planned.createdNotes += 1;

  return {
    action: 'merge_pht_duplicates',
    canonicalContactId: canonical.id,
    duplicateContactIds: duplicates.map((contact) => contact.id),
    movedRefs,
  };
}

async function planOrApplyApproval(client, context, sourceByKey, approval, apply, planned) {
  const candidates = sourceByKey.get(approval.key) || [];
  const row = selectSourceRow(candidates, approval);
  if (!row) return { sourceKey: approval.key, decision: 'hold_missing_source_row', approval };

  const contactResult = await findOrCreateContact(client, context, approval.targetClient, approval.phone || '', apply, planned);
  const contact = contactResult.contact;
  if (!contact) return { sourceKey: approval.key, decision: contactResult.action, approval, matches: contactResult.matches };

  const personAction = await ensurePerson(client, context, contact.id, approval.personName, approval.phone || '', apply, planned);
  const result = {
    sourceKey: approval.key,
    approvalDecision: approval.decision,
    approvedAction: approval.action,
    targetClient: approval.targetClient,
    targetContactId: contact.id,
    contactAction: contactResult.action,
    personAction,
    sourceRowId: row.source_row_id,
    normalizedRecordId: row.normalized_record_id,
    reviewItemId: row.review_item_id,
    rawText: row.raw_text,
  };

  if (approval.action === 'status_normalized_note_imported') {
    result.primaryAction = await markNormalizedImported(client, row, apply, planned);
  } else if (approval.action === 'status_review_item_imported') {
    result.primaryAction = await markReviewItemImported(client, row, {
      action: 'approved_status_only_cleanup',
      approvedBy: 'Alvaro',
      approvedDecision: approval.decision,
      targetContactId: contact.id,
      targetClient: approval.targetClient,
      source: 'MIS-168 approved source-row actions',
    }, apply, planned);
  } else if (approval.action === 'create_estimate') {
    const estimate = await createEstimate(client, context, row, contact, apply, planned);
    result.primaryAction = estimate.action;
    result.estimateId = estimate.estimateId;
    result.reviewItemAction = await markReviewItemImported(client, row, {
      action: 'created_or_matched_estimate',
      approvedBy: 'Alvaro',
      approvedDecision: approval.decision,
      targetContactId: contact.id,
      targetClient: approval.targetClient,
      source: 'MIS-168 approved source-row actions',
    }, apply, planned);
  } else if (approval.action === 'create_work_order') {
    const workOrder = await createWorkOrder(client, context, row, contact, apply, planned);
    result.primaryAction = workOrder.action;
    result.workOrderId = workOrder.workOrderId;
    result.reviewItemAction = await markReviewItemImported(client, row, {
      action: 'created_or_matched_work_order',
      approvedBy: 'Alvaro',
      approvedDecision: approval.decision,
      targetContactId: contact.id,
      targetClient: approval.targetClient,
      source: 'MIS-168 approved source-row actions',
    }, apply, planned);
  } else if (approval.action === 'reassign_existing_work_order') {
    const reassignment = await reassignExisting(client, context, row, contact, 'work_order', apply, planned);
    result.primaryAction = reassignment.action;
    result.reassignment = reassignment;
    result.reviewItemAction = await markReviewItemImported(client, row, {
      action: 'reassigned_existing_work_order',
      approvedBy: 'Alvaro',
      approvedDecision: approval.decision,
      targetContactId: contact.id,
      targetClient: approval.targetClient,
      source: 'MIS-168 approved source-row actions',
    }, apply, planned);
  } else if (approval.action === 'reassign_existing_estimate') {
    const reassignment = await reassignExisting(client, context, row, contact, 'estimate', apply, planned);
    result.primaryAction = reassignment.action;
    result.reassignment = reassignment;
    result.normalizedAction = await markNormalizedImported(client, row, apply, planned);
  } else if (approval.action === 'create_note_and_merge_pht') {
    const parent = await existingActivity(client, context, row, 'import_promoted_work_order');
    const note = await createNote(client, context, row, contact, parent?.work_order_id || null, apply, planned);
    result.primaryAction = note.action;
    result.noteId = note.noteId;
    result.normalizedAction = await markNormalizedImported(client, row, apply, planned);
    result.mergeAction = await mergePhtDuplicates(client, context, apply, planned);
  }

  return result;
}

function selectSourceRow(candidates, approval) {
  if (!candidates.length) return null;
  if (approval.action === 'status_normalized_note_imported' || approval.action === 'create_note_and_merge_pht' || approval.action === 'reassign_existing_estimate') {
    return candidates.find((row) => row.record_type === 'note' && row.normalized_status === 'pending')
      || candidates.find((row) => row.record_type === 'note')
      || candidates[0];
  }
  return candidates.find((row) => row.review_item_id && row.review_status === 'pending')
    || candidates.find((row) => row.review_item_id)
    || candidates[0];
}

function toCsv(rows) {
  const columns = [
    'sourceKey',
    'approvalDecision',
    'approvedAction',
    'targetClient',
    'targetContactId',
    'contactAction',
    'personAction',
    'primaryAction',
    'reviewItemAction',
    'normalizedAction',
    'estimateId',
    'workOrderId',
    'noteId',
    'rawText',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMd(report) {
  return `# MIS-168 AIT Signs Approved Source-row Actions

- Generated at: ${report.generatedAt}
- Mode: ${report.mode}
- DB writes: ${report.mode === 'apply' ? 'approved source-row actions only' : 'none'}

## Summary

- Approved rows: ${report.summary.totalRows}
- Primary actions: ${Object.entries(report.summary.byPrimaryAction).map(([key, count]) => `${key}=${count}`).join(', ')}
- Review-item updates: ${report.writeCounts.updatedReviewItems}
- Normalized-record updates: ${report.writeCounts.updatedNormalizedRecords}
- Contacts created: ${report.writeCounts.createdContacts}
- People created: ${report.writeCounts.createdPeople}
- Estimates created: ${report.writeCounts.createdEstimates}
- Work orders created: ${report.writeCounts.createdWorkOrders}
- Notes created: ${report.writeCounts.createdNotes}
- PHT duplicate contacts deleted: ${report.writeCounts.deletedContacts}

## Guardrails

- Existing source-row activity is reused or reassigned instead of duplicated.
- Status-only rows do not create CRM records.
- Contact people are de-duped by contact, normalized name, and phone.
- PHT merge moves references into \`PHT CONTRACTOR\` before deleting duplicate shells.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const fingerprint = await safeFingerprint(client);
  const context = await loadContext(client);
  const sourceByKey = await loadSourceState(client, context);

  const writeCounts = {
    updatedReviewItems: 0,
    updatedNormalizedRecords: 0,
    createdContacts: 0,
    createdPeople: 0,
    createdEstimates: 0,
    createdWorkOrders: 0,
    createdNotes: 0,
    createdActivityEvents: 0,
    reassignedEstimates: 0,
    reassignedWorkOrders: 0,
    reassignedActivityEvents: 0,
    movedPeople: 0,
    deletedDuplicatePeople: 0,
    deletedContacts: 0,
  };

  let rows;
  if (options.apply) await client.query('begin');
  try {
    rows = [];
    for (const approval of APPROVALS) {
      rows.push(await planOrApplyApproval(client, context, sourceByKey, approval, options.apply, writeCounts));
    }
    if (options.apply) await client.query('commit');
  } catch (error) {
    if (options.apply) await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }

  const report = {
    issue: 'MIS-168',
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: fingerprint,
    summary: {
      totalRows: rows.length,
      byPrimaryAction: by(rows, 'primaryAction'),
      byContactAction: by(rows, 'contactAction'),
      byPersonAction: by(rows, 'personAction'),
      byReviewItemAction: by(rows, 'reviewItemAction'),
      byNormalizedAction: by(rows, 'normalizedAction'),
    },
    writeCounts,
    dryRunSimulation: {
      plannedContacts: writeCounts.dryContacts ? writeCounts.dryContacts.size : 0,
      plannedPeople: writeCounts.dryPeople ? writeCounts.dryPeople.size : 0,
    },
    rows,
  };
  delete writeCounts.dryContacts;
  delete writeCounts.dryPeople;

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.csv'), `${toCsv(rows)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.md'), renderMd(report));
  console.log(JSON.stringify({ summary: report.summary, writeCounts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
