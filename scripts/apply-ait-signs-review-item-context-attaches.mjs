#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_INPUT = 'docs/mis-161-ait-signs-source-checked-buckets-attachPromoteHoldRecordCandidates.json';
const DEFAULT_OUTPUT = 'docs/mis-164-ait-signs-review-item-context-attaches-dry-run.json';

function parseArgs(argv) {
  const options = { apply: false, input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--input') {
      options.input = argv[index + 1];
      index += 1;
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

function key(sheet, rowNumber) {
  return `${sheet}#${Number(rowNumber)}`;
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function phoneFrom(value) {
  const match = clean(value).match(/(?:\+?\d[\d\s().-]{5,}\d)/);
  if (!match) return '';
  const digits = match[0].replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return '';
}

function targetName(value) {
  return clean(value).replace(/\([^)]*\)/g, '').trim();
}

function csvCell(value) {
  const text = clean(value);
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

const pendingReviewSql = `
  with latest_batch as (
    select ib.id, ib.organization_id, ib.business_unit_id
    from import_batches ib
    join business_units bu on bu.id = ib.business_unit_id
    where bu.name = $1
      and ib.source_type = 'xlsx'
    order by ib.created_at desc
    limit 1
  )
  select
    lb.organization_id,
    lb.business_unit_id,
    ri.id as review_item_id,
    ri.review_type,
    ri.review_status,
    ri.reason,
    ri.proposed_resolution_json,
    sr.source_sheet,
    sr.source_row_number,
    sr.raw_text
  from latest_batch lb
  join import_review_items ri on ri.import_batch_id = lb.id
  join import_source_rows sr on sr.id = ri.source_row_id
  left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
    and nr.source_row_id = ri.source_row_id
  where nr.id is null
  order by sr.source_sheet, sr.source_row_number
`;

async function resolveContact(client, context, target) {
  const phone = phoneFrom(target);
  if (phone) {
    const byPhone = await client.query(
      `
        select id, name, company_name, phone
        from contacts
        where organization_id = $1
          and primary_business_unit_id = $2
          and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = $3
        order by created_at asc
        limit 2
      `,
      [context.organizationId, context.businessUnitId, phone],
    );
    if (byPhone.rowCount === 1) return { status: 'resolved_existing_contact', contact: byPhone.rows[0], matchType: 'phone' };
    if (byPhone.rowCount > 1) return { status: 'hold_ambiguous_target', matchType: 'phone', matches: byPhone.rows };
  }

  const targetKey = normalizeKey(targetName(target));
  if (targetKey.length >= 3) {
    const byName = await client.query(
      `
        select id, name, company_name, phone
        from contacts
        where organization_id = $1
          and primary_business_unit_id = $2
          and (
            regexp_replace(lower(coalesce(company_name, '')), '[^a-z0-9]', '', 'g') like $3
            or regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]', '', 'g') like $3
            or $4 like '%' || regexp_replace(lower(coalesce(company_name, name, '')), '[^a-z0-9]', '', 'g') || '%'
          )
        order by length(coalesce(company_name, name, '')) asc, created_at asc
        limit 5
      `,
      [context.organizationId, context.businessUnitId, `%${targetKey}%`, targetKey],
    );
    if (byName.rowCount === 1) return { status: 'resolved_existing_contact', contact: byName.rows[0], matchType: 'name' };
    if (byName.rowCount > 1) return { status: 'hold_ambiguous_target', matchType: 'name', matches: byName.rows };
  }

  return { status: 'hold_unresolved_target', matchType: phone ? 'phone' : 'name' };
}

function toCsv(rows) {
  const columns = [
    'decision',
    'sourceSheet',
    'sourceRowNumber',
    'reviewItemId',
    'target',
    'resolvedContact',
    'resolvedPhone',
    'matchType',
    'evidence',
    'workbookOriginalText',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMd(report) {
  return `# MIS-164 AIT Signs Review-item Context Attaches

- Generated at: ${report.generatedAt}
- Mode: ${report.mode}
- DB writes: ${report.mode === 'apply' ? 'review-item status/metadata updates only' : 'none'}

## Summary

- Attach recommendations reviewed: ${report.summary.totalRows}
- Resolved existing contacts: ${report.summary.byDecision.resolved_existing_contact || 0}
- Already imported/attached: ${report.summary.byDecision.already_imported_existing_contact || 0}
- Holds/unresolved/ambiguous: ${(report.summary.byDecision.hold_unresolved_target || 0) + (report.summary.byDecision.hold_ambiguous_target || 0)}
- Updated review items: ${report.summary.updatedRows}

## Guardrail

- Only rows with \`recommendation=attach_to_existing_contact\` are eligible.
- Only existing contacts may be targets; unresolved or ambiguous rows stay pending.
- No contacts, notes, activities, work orders, normalized records, source rows, or schema are created/changed.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const sourceRows = JSON.parse(await readFile(options.input, 'utf8'))
    .filter((row) => row.recommendation === 'attach_to_existing_contact');
  const targetByKey = new Map(sourceRows.map((row) => [key(row.sourceSheet, row.sourceRowNumber), row]));

  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const fingerprint = await safeFingerprint(client);
  const pending = await client.query(pendingReviewSql, [BUSINESS_UNIT]);
  const context = {
    organizationId: pending.rows[0]?.organization_id || null,
    businessUnitId: pending.rows[0]?.business_unit_id || null,
  };
  if (!context.organizationId || !context.businessUnitId) throw new Error('No pending review context found');

  const reviewByKey = new Map(pending.rows.map((row) => [key(row.source_sheet, row.source_row_number), row]));
  const plannedRows = [];
  for (const source of sourceRows) {
    const review = reviewByKey.get(key(source.sourceSheet, source.sourceRowNumber));
    if (!review) {
      plannedRows.push({
        decision: 'hold_missing_review_item',
        sourceSheet: source.sourceSheet,
        sourceRowNumber: source.sourceRowNumber,
        target: source.target,
        evidence: source.evidence,
        workbookOriginalText: source.workbookOriginalText,
      });
      continue;
    }
    if (review.review_status !== 'pending') {
      plannedRows.push({
        decision: review.review_status === 'imported' ? 'already_imported_existing_contact' : 'hold_current_review_status',
        sourceSheet: source.sourceSheet,
        sourceRowNumber: source.sourceRowNumber,
        reviewItemId: review.review_item_id,
        target: source.target,
        matchType: 'current_status',
        evidence: source.evidence,
        workbookOriginalText: source.workbookOriginalText,
        currentReviewStatus: review.review_status,
      });
      continue;
    }
    const resolution = await resolveContact(client, context, source.target);
    plannedRows.push({
      decision: resolution.status,
      sourceSheet: source.sourceSheet,
      sourceRowNumber: source.sourceRowNumber,
      reviewItemId: review.review_item_id,
      target: source.target,
      resolvedContactId: resolution.contact?.id || '',
      resolvedContact: resolution.contact ? (resolution.contact.company_name || resolution.contact.name || '') : '',
      resolvedPhone: resolution.contact?.phone || '',
      matchType: resolution.matchType,
      evidence: source.evidence,
      workbookOriginalText: source.workbookOriginalText,
      matches: resolution.matches || [],
    });
  }

  const attachRows = plannedRows.filter((row) => row.decision === 'resolved_existing_contact');
  let updatedRows = [];
  if (options.apply && attachRows.length) {
    await client.query('begin');
    try {
      const updateResult = await client.query(
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
          returning ri.id, ri.review_type, ri.review_status
        `,
        [
          JSON.stringify(
            attachRows.map((row) => ({
              id: row.reviewItemId,
              resolution: {
                action: 'attached_to_existing_contact',
                targetContactId: row.resolvedContactId,
                targetContact: row.resolvedContact,
                matchType: row.matchType,
                operatorReason: 'MIS-164 source-workbook attach plan',
              },
            })),
          ),
        ],
      );
      updatedRows = updateResult.rows;
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  await client.end();

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: fingerprint,
    source: options.input,
    summary: {
      totalRows: plannedRows.length,
      byDecision: by(plannedRows, 'decision'),
      updatedRows: updatedRows.length,
    },
    rows: plannedRows,
    updatedRows,
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.csv'), `${toCsv(plannedRows)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.md'), renderMd(report));
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
