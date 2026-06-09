#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_OUTPUT = 'docs/mis-163-ait-signs-normalized-note-attach-dry-run.json';

const DECISION_OVERRIDES = new Map([
  ['2. ESTIMADOS#52', {
    decision: 'hold_for_human',
    reason: 'Promoted parent evidence points to DOWN TOWN PLAINFIELD, while the workbook row says PAVEMENT SPECIAL / JHON.',
  }],
  ['3. 15 SIGNS WORK ORDER#122', {
    decision: 'promote_note_candidate',
    reason: 'Useful operational note beyond parent work order; requires separate note creation approval.',
  }],
  ['WORK ORDER TERMINADOS Y PAGADOS#1538', {
    decision: 'hold_for_human',
    reason: 'Operational instruction text should be reviewed for attach-vs-ignore direction before note creation or status cleanup.',
  }],
]);

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

function key(sheet, rowNumber) {
  return `${sheet}#${Number(rowNumber)}`;
}

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function csvCell(value) {
  const text = clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function decisionFor(row) {
  const override = DECISION_OVERRIDES.get(key(row.source_sheet, row.source_row_number));
  if (override) return override;
  if (row.parent_work_order_id && row.parent_contact_id && row.parent_activity_event_id) {
    return {
      decision: 'attach_to_parent_evidence',
      reason: 'Existing promoted parent work-order/contact activity for the same workbook source row is present; no new CRM object needed.',
    };
  }
  return {
    decision: 'hold_for_human',
    reason: 'No complete promoted parent work-order/contact activity target found.',
  };
}

function by(rows, field) {
  return rows.reduce((acc, row) => {
    const value = row[field] || '';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

const pendingNotesSql = `
  with latest_batch as (
    select ib.id, ib.organization_id, ib.business_unit_id
    from import_batches ib
    join business_units bu on bu.id = ib.business_unit_id
    where bu.name = $1
      and ib.source_type = 'xlsx'
    order by ib.created_at desc
    limit 1
  ),
  parent_work_order_events as (
    select distinct on (ae.source_sheet, ae.source_row)
      ae.source_sheet,
      ae.source_row,
      ae.id as parent_activity_event_id,
      ae.contact_id as parent_contact_id,
      ae.work_order_id as parent_work_order_id
    from latest_batch lb
    join activity_events ae on ae.business_unit_id = lb.business_unit_id
    where ae.event_type = 'import_promoted_work_order'
      and ae.work_order_id is not null
      and ae.contact_id is not null
    order by ae.source_sheet, ae.source_row, ae.created_at asc, ae.id asc
  )
  select
    nr.id as normalized_record_id,
    nr.status as import_status,
    nr.record_type,
    nr.proposed_note_json,
    sr.id as source_row_id,
    sr.source_sheet,
    sr.source_row_number,
    sr.raw_text,
    pwo.parent_activity_event_id,
    pwo.parent_contact_id,
    pwo.parent_work_order_id,
    c.name as contact_name,
    c.company_name,
    c.phone,
    wo.work_order_number,
    wo.title as work_order_title
  from latest_batch lb
  join import_normalized_records nr on nr.import_batch_id = lb.id
  join import_source_rows sr on sr.id = nr.source_row_id
  left join parent_work_order_events pwo on pwo.source_sheet = sr.source_sheet
    and pwo.source_row = sr.source_row_number
  left join contacts c on c.id = pwo.parent_contact_id
  left join work_orders wo on wo.id = pwo.parent_work_order_id
  where nr.record_type = 'note'
    and nr.status = 'pending'
  order by sr.source_sheet, sr.source_row_number
`;

function toCsv(rows) {
  const columns = [
    'decision',
    'sourceSheet',
    'sourceRowNumber',
    'normalizedRecordId',
    'targetContact',
    'targetPhone',
    'targetWorkOrder',
    'targetWorkOrderTitle',
    'reason',
    'customerName',
    'contactName',
    'workDescription',
    'rawText',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMd(report) {
  return `# MIS-163 AIT Signs Normalized Note Attach Cleanup

- Generated at: ${report.generatedAt}
- Mode: ${report.mode}
- DB writes: ${report.mode === 'apply' ? 'normalized-record status updates only' : 'none'}

## Summary

- Pending normalized note rows reviewed: ${report.summary.totalRows}
- Attach to parent evidence: ${report.summary.byDecision.attach_to_parent_evidence || 0}
- Promote-note candidates left pending: ${report.summary.byDecision.promote_note_candidate || 0}
- Human holds left pending: ${report.summary.byDecision.hold_for_human || 0}
- Updated rows: ${report.summary.updatedRows}

## Guardrail

- Attach here means mark the normalized note row imported because a promoted parent work-order/contact activity already exists for the same workbook source row.
- No notes, activity events, contacts, work orders, source rows, review items, or schema are created/changed.
- Promote-note candidates and holds remain pending for explicit review.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const fingerprint = await safeFingerprint(client);
  const result = await client.query(pendingNotesSql, [BUSINESS_UNIT]);
  const rows = result.rows.map((row) => {
    const proposal = row.proposed_note_json || {};
    const decision = decisionFor(row);
    return {
      ...decision,
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      normalizedRecordId: row.normalized_record_id,
      sourceRowId: row.source_row_id,
      targetContactId: row.parent_contact_id,
      targetContact: row.company_name || row.contact_name || '',
      targetPhone: row.phone || '',
      targetWorkOrderId: row.parent_work_order_id,
      targetWorkOrder: row.work_order_number || '',
      targetWorkOrderTitle: row.work_order_title || '',
      parentActivityEventId: row.parent_activity_event_id,
      customerName: clean(proposal.customerName),
      contactName: clean(proposal.contactName),
      workDescription: clean(proposal.workDescription),
      rawText: clean(row.raw_text),
    };
  });
  const attachRows = rows.filter((row) => row.decision === 'attach_to_parent_evidence');

  let updatedRows = [];
  if (options.apply && attachRows.length) {
    await client.query('begin');
    try {
      const updateResult = await client.query(
        `
          update import_normalized_records
          set status = 'imported'
          where id = any($1::uuid[])
            and status = 'pending'
            and record_type = 'note'
          returning id, status
        `,
        [attachRows.map((row) => row.normalizedRecordId)],
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
    summary: {
      totalRows: rows.length,
      byDecision: by(rows, 'decision'),
      updatedRows: updatedRows.length,
    },
    rows,
    updatedRows,
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.csv'), `${toCsv(rows)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.md'), renderMd(report));
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
