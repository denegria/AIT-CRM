#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const INPUT = 'docs/mis-169-ait-signs-post-approval-remaining-review.json';
const DEFAULT_OUTPUT = 'docs/mis-170-ait-signs-rough-match-approvals-dry-run.json';

const APPROVALS = [
  { key: '3. 15 SIGNS WORK ORDER#142', target: 'PINAS LOCAS', approval: 'high rough approved' },
  { key: '3. 15 SIGNS WORK ORDER#208', target: 'FONSE', approval: 'high rough approved' },
  { key: '3. 15 SIGNS WORK ORDER#235', target: 'CENTRAL FRESH SUPERMARKET', approval: 'high rough approved' },
  { key: '3. 15 SIGNS WORK ORDER#258', target: 'PATRICIA SABOR CASERO', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#41', target: 'GREEN WORLD', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#52', target: 'JOSE CAICEDO', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#53', target: 'DIEGO', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#57', target: 'TONY', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#67', target: 'VALVERDE LANDSCAPING', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#75', target: 'GREEN WORLD', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#86', target: 'GLOBAL', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#91', target: 'PASTOR SILVIO', approval: 'high rough approved' },
  { key: 'WORK ORDER TERMINADOS Y PAGADOS#104', target: "FRANKY'S", approval: "high rough corrected from Frank to Franky/Franky's" },
  { key: '2. ESTIMADOS#85', target: 'JBP CONTRACTOR', approval: 'medium rough approved' },
];

const HELD = [
  {
    key: '3. 15 SIGNS WORK ORDER#109',
    originalTarget: 'GK BROTHERS HOME IMPROVEMENT',
    reviewedTarget: '4 BOTHERS IMPROVEMENT',
    reason: 'Alvaro rejected GK Brothers; staging has no 9083338110 contact/person phone match, so hold for explicit target confirmation.',
  },
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

function compactName(value) {
  return clean(value)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '');
}

function splitKey(value) {
  const index = value.lastIndexOf('#');
  return { sourceSheet: value.slice(0, index), sourceRowNumber: Number(value.slice(index + 1)) };
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
  const batch = result.rows[0];
  if (!batch) throw new Error(`No latest XLSX batch found for ${BUSINESS_UNIT}`);
  return batch;
}

async function loadReviewItems(client, batchId, keys) {
  const result = await client.query(
    `
      select
        ri.id as review_item_id,
        ri.review_status,
        ri.review_type,
        ri.proposed_resolution_json,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text
      from import_source_rows sr
      join import_review_items ri on ri.import_batch_id = sr.import_batch_id
        and ri.source_row_id = sr.id
      where sr.import_batch_id = $1
        and (sr.source_sheet, sr.source_row_number) in (
          select source_sheet, source_row_number
          from jsonb_to_recordset($2::jsonb) as x(source_sheet text, source_row_number int)
        )
    `,
    [batchId, JSON.stringify(keys.map((key) => ({ source_sheet: key.sourceSheet, source_row_number: key.sourceRowNumber })))],
  );
  return new Map(result.rows.map((row) => [`${row.source_sheet}#${Number(row.source_row_number)}`, row]));
}

async function resolveContact(client, batch, target) {
  const targetKey = compactName(target);
  const result = await client.query(
    `
      select id, name, company_name, phone, email, source_label
      from contacts
      where organization_id = $1
        and primary_business_unit_id = $2
        and (
          regexp_replace(upper(coalesce(company_name, '')), '[^A-Z0-9]', '', 'g') = $3
          or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]', '', 'g') = $3
        )
      order by created_at asc
      limit 5
    `,
    [batch.organization_id, batch.business_unit_id, targetKey],
  );
  if (result.rowCount === 1) return { status: 'resolved_existing_contact', contact: result.rows[0], matchType: 'exact_client_name' };
  if (result.rowCount > 1) return { status: 'hold_ambiguous_target', matches: result.rows, matchType: 'exact_client_name' };
  return { status: 'hold_unresolved_target', matches: [], matchType: 'exact_client_name' };
}

async function phoneEvidence(client, batch, phone) {
  const digits = clean(phone).replace(/\D/g, '');
  if (!digits) return [];
  const result = await client.query(
    `
      select 'contact' as source, c.id::text, c.company_name, c.name, c.phone, null::text as person_name, null::text as person_phone
      from contacts c
      where c.organization_id = $1
        and c.primary_business_unit_id = $2
        and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = $3
      union all
      select 'contact_people' as source, cp.id::text, c.company_name, c.name, c.phone, cp.name as person_name, cp.phone as person_phone
      from contact_people cp
      join contacts c on c.id = cp.contact_id
      where c.organization_id = $1
        and c.primary_business_unit_id = $2
        and regexp_replace(coalesce(cp.phone, ''), '[^0-9]', '', 'g') = $3
      order by source, company_name nulls last, name
    `,
    [batch.organization_id, batch.business_unit_id, digits],
  );
  return result.rows;
}

function toCsv(rows) {
  const columns = [
    'decision',
    'sourceKey',
    'target',
    'resolvedContact',
    'resolvedPhone',
    'matchType',
    'reviewItemId',
    'approval',
    'sourceClientNames',
    'sourcePhones',
    'workbookOriginalText',
    'reason',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMarkdown(report) {
  return `# MIS-170 AIT Signs Rough-match Approvals

- Generated at: ${report.generatedAt}
- Mode: ${report.mode}
- DB writes: ${report.mode === 'apply' ? 'review-item status/metadata updates only' : 'none'}

## Summary

- Approved rows reviewed: ${report.summary.approvedRows}
- Rows resolved to existing clients: ${report.summary.byDecision.resolved_existing_contact || 0}
- Already imported: ${report.summary.byDecision.already_imported_existing_contact || 0}
- Held rows: ${report.summary.heldRows}
- Updated review items: ${report.summary.updatedRows}

## Guardrail

- This marks approved Import Review rows as imported and stores the chosen existing client in metadata.
- It does not create contacts, people, notes, work orders, estimates, activities, source rows, or schema.
- The 4 Brothers row is held because the rejected GK target has a different phone, and staging has no exact \`9083338110\` contact/person phone evidence.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const packet = JSON.parse(await readFile(INPUT, 'utf8'));
  const sourceByKey = new Map(packet.rows.map((row) => [row.sourceKey, row]));

  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const fingerprint = await safeFingerprint(client);
  const batch = await loadContext(client);
  const keys = [...APPROVALS, ...HELD].map((row) => splitKey(row.key));
  const reviewByKey = await loadReviewItems(client, batch.id, keys);

  const plannedRows = [];
  for (const approval of APPROVALS) {
    const source = sourceByKey.get(approval.key);
    const review = reviewByKey.get(approval.key);
    if (!source || !review) {
      plannedRows.push({ decision: 'hold_missing_source_or_review_item', ...approval });
      continue;
    }
    if (review.review_status !== 'pending') {
      plannedRows.push({
        decision: review.review_status === 'imported' ? 'already_imported_existing_contact' : 'hold_current_review_status',
        ...approval,
        reviewItemId: review.review_item_id,
        currentReviewStatus: review.review_status,
        sourceClientNames: source.sourceClientNames || [],
        sourcePhones: source.sourcePhones || [],
        workbookOriginalText: source.workbookOriginalText,
      });
      continue;
    }
    const resolved = await resolveContact(client, batch, approval.target);
    plannedRows.push({
      decision: resolved.status,
      ...approval,
      reviewItemId: review.review_item_id,
      resolvedContactId: resolved.contact?.id || '',
      resolvedContact: resolved.contact ? (resolved.contact.company_name || resolved.contact.name || '') : '',
      resolvedPhone: resolved.contact?.phone || '',
      matchType: resolved.matchType,
      sourceClientNames: source.sourceClientNames || [],
      sourcePhones: source.sourcePhones || [],
      workbookOriginalText: source.workbookOriginalText,
      matches: resolved.matches || [],
    });
  }

  const heldRows = [];
  for (const hold of HELD) {
    const source = sourceByKey.get(hold.key);
    heldRows.push({
      decision: 'held_for_human_confirmation',
      ...hold,
      sourceClientNames: source?.sourceClientNames || [],
      sourcePhones: source?.sourcePhones || [],
      workbookOriginalText: source?.workbookOriginalText || '',
      phoneEvidence: (source?.sourcePhones || []).length ? await phoneEvidence(client, batch, source.sourcePhones[0]) : [],
    });
  }

  const attachRows = plannedRows.filter((row) => row.decision === 'resolved_existing_contact');
  let updatedRows = [];
  if (options.apply && attachRows.length) {
    await client.query('begin');
    try {
      const result = await client.query(
        `
          update import_review_items ri
          set review_status = 'imported',
              reviewed_at = now(),
              updated_at = now(),
              proposed_resolution_json = coalesce(ri.proposed_resolution_json, '{}'::jsonb)
                || updates.resolution
          from (
            select *
            from jsonb_to_recordset($1::jsonb) as x(id uuid, resolution jsonb)
          ) updates
          where ri.id = updates.id
            and ri.review_status = 'pending'
          returning ri.id, ri.review_status, ri.review_type
        `,
        [
          JSON.stringify(attachRows.map((row) => ({
            id: row.reviewItemId,
            resolution: {
              action: 'approved_rough_match_existing_client',
              issue: 'MIS-170',
              targetContactId: row.resolvedContactId,
              targetContact: row.resolvedContact,
              sourceClientNames: row.sourceClientNames,
              sourcePhones: row.sourcePhones,
              matchType: row.matchType,
              approval: row.approval,
              operatorReason: 'Alvaro approved MIS-169 high/medium rough-match review batch',
            },
          }))),
        ],
      );
      updatedRows = result.rows;
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  await client.end();

  const report = {
    issue: 'MIS-170',
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: fingerprint,
    input: INPUT,
    summary: {
      approvedRows: plannedRows.length,
      heldRows: heldRows.length,
      byDecision: by(plannedRows, 'decision'),
      updatedRows: updatedRows.length,
    },
    rows: plannedRows,
    heldRows,
    updatedRows,
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.csv'), `${toCsv([...plannedRows, ...heldRows])}\n`);
  await writeFile(options.output.replace(/\.json$/, '.md'), renderMarkdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(JSON.stringify(fingerprint, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
