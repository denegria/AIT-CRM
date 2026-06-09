#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const ISSUE = 'MIS-158';
const BUSINESS_UNIT = 'AIT Signs';
const DEFAULT_OUTPUT_JSON = 'docs/mis-158-ait-signs-import-review-cleanup-approval.json';
const DEFAULT_OUTPUT_CSV = 'docs/mis-158-ait-signs-import-review-cleanup-approval.csv';
const DEFAULT_OUTPUT_MD = 'docs/mis-158-ait-signs-import-review-cleanup-approval.md';

function parseArgs(argv) {
  const options = {
    outputJson: DEFAULT_OUTPUT_JSON,
    outputCsv: DEFAULT_OUTPUT_CSV,
    outputMarkdown: DEFAULT_OUTPUT_MD,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-json') {
      options.outputJson = argv[index + 1];
      index += 1;
    } else if (arg === '--output-csv') {
      options.outputCsv = argv[index + 1];
      index += 1;
    } else if (arg === '--output-md') {
      options.outputMarkdown = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function loadSecretsFingerprint() {
  try {
    const secrets = JSON.parse(await readFile('/root/.openclaw/secrets.json', 'utf8'));
    const url = secrets.aitCrm?.staging?.databaseUrl ? new URL(secrets.aitCrm.staging.databaseUrl) : null;
    return {
      expectedNeonBranchId: 'br-broad-hill-aptjpyea',
      targetBaseUrl: secrets.aitCrm?.staging?.baseUrl || null,
      hostSuffix: url ? url.hostname.split('.').slice(0, 2).join('.') : null,
    };
  } catch {
    return {
      expectedNeonBranchId: 'br-broad-hill-aptjpyea',
      targetBaseUrl: null,
      hostSuffix: null,
    };
  }
}

async function runtimeFingerprint(client) {
  const db = await client.query('select current_database() as database');
  return {
    ...(await loadSecretsFingerprint()),
    currentDatabase: db.rows[0]?.database || null,
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? 'null';
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function rowKey(sheet, rowNumber) {
  return `${sheet || ''}::${rowNumber || ''}`;
}

function eventTypeFor(recordType) {
  return `import_promoted_${recordType}`;
}

function proposalFor(row) {
  return row.proposed_lead_json
    || row.proposed_estimate_json
    || row.proposed_work_order_json
    || row.proposed_payment_json
    || row.proposed_note_json
    || {};
}

function workOrderNumberFor(row) {
  const sourceRow = Number(row.source_row_number || 0) || null;
  if (!sourceRow) return null;
  const sheet = String(row.source_sheet || '').toLowerCase();
  if (sheet.includes('termin') || sheet.includes('pagad')) return `AIT-WO-ARCH-${sourceRow}`;
  if (sheet.includes('15 signs')) return `AIT-WO-ACT-${sourceRow}`;
  return `AIT-WO-${sourceRow}`;
}

function estimateNumberFor(row) {
  const sourceRow = Number(row.source_row_number || 0) || null;
  return sourceRow ? `AIT-EST-${sourceRow}` : null;
}

function entityKeyFor(row) {
  if (row.record_type === 'work_order') return workOrderNumberFor(row);
  if (row.record_type === 'estimate') return estimateNumberFor(row);
  if (row.record_type === 'payment_snapshot') return rowKey(row.source_sheet, row.source_row_number);
  return null;
}

function normalizedAction({ row, exactEventCount, anyEventCount, existingEntityCount }) {
  if (exactEventCount > 0 || existingEntityCount > 0) {
    return {
      proposedAction: 'mark_normalized_imported',
      targetStatus: 'imported',
      reason: 'Already has matching promoted CRM evidence.',
    };
  }

  if (row.record_type === 'note' && anyEventCount > 0) {
    return {
      proposedAction: 'hold_note_attach_decision',
      targetStatus: row.import_status,
      reason: 'Parent row is promoted, but the note itself has no exact promoted-note event.',
    };
  }

  return {
    proposedAction: 'hold_unmatched',
    targetStatus: row.import_status,
    reason: 'No matching promoted evidence found.',
  };
}

function reviewItemOnlyAction(reviewType) {
  if (reviewType === 'header' || reviewType === 'section_header') {
    return {
      proposedAction: 'mark_review_rejected_ignore',
      targetStatus: 'rejected',
      reason: 'Workbook header/section label, not customer data.',
    };
  }
  if (reviewType === 'financial_line') {
    return {
      proposedAction: 'mark_review_rejected_ignore',
      targetStatus: 'rejected',
      reason: 'Financial total/line without usable customer identity.',
    };
  }
  if (reviewType === 'misc_text') {
    return {
      proposedAction: 'mark_review_rejected_ignore',
      targetStatus: 'rejected',
      reason: 'Context-only text with no normalized customer object.',
    };
  }
  return {
    proposedAction: 'hold_review_item_only',
    targetStatus: 'pending',
    reason: 'Review item is not linked to a normalized row and needs separate human direction.',
  };
}

function renderCsv(rows) {
  const headers = [
    'issue',
    'bucket',
    'id',
    'sourceRowId',
    'sourceSheet',
    'sourceRowNumber',
    'recordType',
    'reviewType',
    'currentStatus',
    'proposedAction',
    'targetStatus',
    'reason',
    'existingExactPromotionEvents',
    'existingAnyPromotionEvents',
    'existingEntityCount',
    'entityKey',
    'customerName',
    'contactName',
    'phoneHint',
    'statusHint',
    'workDescription',
    'reviewReason',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-158 AIT Signs Import Review Cleanup Approval Packet',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Staging branch id: ${report.safeFingerprint.expectedNeonBranchId}`,
    `- Current database: ${report.safeFingerprint.currentDatabase}`,
    `- Host suffix: ${report.safeFingerprint.hostSuffix || 'unknown'}`,
    `- Target base URL: ${report.safeFingerprint.targetBaseUrl || 'unknown'}`,
    '',
    '## Verdict',
    '',
    '- No DB writes were made.',
    '- This packet proposes queue/status cleanup only. It does not create contacts, clients, leads, estimates, work orders, payments, or notes.',
    `- Mark normalized rows as imported: ${report.summary.byProposedAction.mark_normalized_imported || 0}`,
    `- Hold normalized note attach decisions: ${report.summary.byProposedAction.hold_note_attach_decision || 0}`,
    `- Mark review-item-only rows rejected/ignored: ${report.summary.byProposedAction.mark_review_rejected_ignore || 0}`,
    `- Hold review-item-only rows for human direction: ${report.summary.byProposedAction.hold_review_item_only || 0}`,
    '',
    '## Proposed Cleanup',
    '',
    ...Object.entries(report.summary.byProposedAction).map(([action, count]) => `- ${action}: ${count}`),
    '',
    '## Held Rows',
    '',
    '- 19 normalized note rows: parent work/order/payment evidence exists, but no exact promoted-note event exists.',
    '- 16 review-item-only rows: 13 note review items and 3 record candidates not linked to normalized rows.',
    '',
    '## Approval Needed',
    '',
    'Approve only if the intended next write is:',
    '',
    '- set the 2,221 already-promoted normalized rows to `imported`;',
    '- set the 226 non-customer/context-only review items to `rejected`;',
    '- leave the 35 held rows pending for separate attach/hold decisions;',
    '- perform no CRM object creation or mutation.',
    '',
    '## Artifacts',
    '',
    `- CSV: ${report.artifacts.csv}`,
    `- JSON: ${report.artifacts.json}`,
  ];

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const safeFingerprint = await runtimeFingerprint(client);

  const businessUnit = await client.query(
    'select id, organization_id from business_units where name = $1 limit 1',
    [BUSINESS_UNIT],
  );
  if (!businessUnit.rows[0]) throw new Error(`Business unit not found: ${BUSINESS_UNIT}`);
  const businessUnitId = businessUnit.rows[0].id;
  const organizationId = businessUnit.rows[0].organization_id;

  const batchResult = await client.query(
    `
      select id, source_name, source_type, file_name, status, created_at
      from import_batches
      where business_unit_id = $1
      order by created_at desc
      limit 1
    `,
    [businessUnitId],
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new Error('No AIT Signs import batch found');

  const normalizedResult = await client.query(
    `
      select
        nr.id,
        nr.source_row_id,
        nr.record_type,
        nr.status as import_status,
        sr.source_sheet,
        sr.source_row_number,
        nr.proposed_lead_json,
        nr.proposed_estimate_json,
        nr.proposed_work_order_json,
        nr.proposed_payment_json,
        nr.proposed_note_json
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      where nr.import_batch_id = $1
      order by sr.source_sheet, sr.source_row_number, nr.record_type, nr.id
    `,
    [batch.id],
  );

  const eventsResult = await client.query(
    `
      select source_sheet, source_row, event_type, count(*)::int as count
      from activity_events
      where organization_id = $1
        and business_unit_id = $2
        and event_type like 'import_promoted_%'
        and source_sheet is not null
        and source_row is not null
      group by 1, 2, 3
    `,
    [organizationId, businessUnitId],
  );

  const estimatesResult = await client.query(
    `
      select estimate_number, count(*)::int as count
      from estimates
      where organization_id = $1
        and business_unit_id = $2
        and estimate_number is not null
      group by estimate_number
    `,
    [organizationId, businessUnitId],
  );

  const workOrdersResult = await client.query(
    `
      select work_order_number, count(*)::int as count
      from work_orders
      where organization_id = $1
        and business_unit_id = $2
        and work_order_number is not null
      group by work_order_number
    `,
    [organizationId, businessUnitId],
  );

  const paymentsResult = await client.query(
    `
      select source_sheet, source_row, count(*)::int as count
      from payment_snapshots
      where organization_id = $1
        and business_unit_id = $2
        and source_sheet is not null
        and source_row is not null
      group by 1, 2
    `,
    [organizationId, businessUnitId],
  );

  const reviewOnlyResult = await client.query(
    `
      select
        ri.id,
        ri.source_row_id,
        ri.review_type,
        ri.review_status,
        ri.reason,
        sr.source_sheet,
        sr.source_row_number
      from import_review_items ri
      left join import_source_rows sr on sr.id = ri.source_row_id
      left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
        and nr.source_row_id = ri.source_row_id
      where ri.import_batch_id = $1
        and nr.id is null
      order by ri.review_type, sr.source_sheet, sr.source_row_number, ri.id
    `,
    [batch.id],
  );

  await client.end();

  const eventCounts = new Map();
  const anyEventCounts = new Map();
  for (const event of eventsResult.rows) {
    const baseKey = rowKey(event.source_sheet, event.source_row);
    eventCounts.set(`${baseKey}::${event.event_type}`, Number(event.count));
    anyEventCounts.set(baseKey, (anyEventCounts.get(baseKey) || 0) + Number(event.count));
  }
  const estimateCounts = new Map(estimatesResult.rows.map((row) => [row.estimate_number, Number(row.count)]));
  const workOrderCounts = new Map(workOrdersResult.rows.map((row) => [row.work_order_number, Number(row.count)]));
  const paymentCounts = new Map(paymentsResult.rows.map((row) => [rowKey(row.source_sheet, row.source_row), Number(row.count)]));

  const normalizedRows = normalizedResult.rows.map((row) => {
    const proposal = proposalFor(row);
    const baseKey = rowKey(row.source_sheet, row.source_row_number);
    const exactEventCount = eventCounts.get(`${baseKey}::${eventTypeFor(row.record_type)}`) || 0;
    const anyEventCount = anyEventCounts.get(baseKey) || 0;
    const entityKey = entityKeyFor(row);
    let existingEntityCount = 0;
    if (row.record_type === 'estimate') existingEntityCount = estimateCounts.get(entityKey) || 0;
    if (row.record_type === 'work_order') existingEntityCount = workOrderCounts.get(entityKey) || 0;
    if (row.record_type === 'payment_snapshot') existingEntityCount = paymentCounts.get(entityKey) || 0;
    if (row.record_type === 'lead' || row.record_type === 'note') existingEntityCount = exactEventCount;
    const action = normalizedAction({ row, exactEventCount, anyEventCount, existingEntityCount });

    return {
      issue: ISSUE,
      bucket: 'normalized_record',
      id: row.id,
      sourceRowId: row.source_row_id,
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      recordType: row.record_type,
      reviewType: '',
      currentStatus: row.import_status,
      proposedAction: action.proposedAction,
      targetStatus: action.targetStatus,
      reason: action.reason,
      existingExactPromotionEvents: exactEventCount,
      existingAnyPromotionEvents: anyEventCount,
      existingEntityCount,
      entityKey,
      customerName: clean(proposal.customerName),
      contactName: clean(proposal.contactName),
      phoneHint: clean(proposal.phoneHint),
      statusHint: clean(proposal.statusHint),
      workDescription: clean(proposal.workDescription),
      reviewReason: '',
    };
  });

  const reviewOnlyRows = reviewOnlyResult.rows.map((row) => {
    const action = reviewItemOnlyAction(row.review_type);
    return {
      issue: ISSUE,
      bucket: 'review_item_only',
      id: row.id,
      sourceRowId: row.source_row_id,
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      recordType: '',
      reviewType: row.review_type,
      currentStatus: row.review_status,
      proposedAction: action.proposedAction,
      targetStatus: action.targetStatus,
      reason: action.reason,
      existingExactPromotionEvents: '',
      existingAnyPromotionEvents: '',
      existingEntityCount: '',
      entityKey: '',
      customerName: '',
      contactName: '',
      phoneHint: '',
      statusHint: '',
      workDescription: '',
      reviewReason: clean(row.reason),
    };
  });

  const rows = [...normalizedRows, ...reviewOnlyRows];
  const report = {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    businessUnit: BUSINESS_UNIT,
    safeFingerprint,
    batch,
    summary: {
      totalRowsInPacket: rows.length,
      normalizedRows: normalizedRows.length,
      reviewItemOnlyRows: reviewOnlyRows.length,
      byBucket: countBy(rows, 'bucket'),
      byProposedAction: countBy(rows, 'proposedAction'),
      byTargetStatus: countBy(rows, 'targetStatus'),
      byRecordType: countBy(normalizedRows, 'recordType'),
      byReviewType: countBy(reviewOnlyRows, 'reviewType'),
    },
    samples: {
      heldNormalizedNotes: normalizedRows.filter((row) => row.proposedAction === 'hold_note_attach_decision').slice(0, 30),
      heldReviewItems: reviewOnlyRows.filter((row) => row.proposedAction === 'hold_review_item_only').slice(0, 30),
      cleanupRows: rows.filter((row) => row.proposedAction !== 'hold_note_attach_decision' && row.proposedAction !== 'hold_review_item_only').slice(0, 20),
    },
    artifacts: {
      csv: options.outputCsv,
      json: options.outputJson,
    },
  };

  await mkdir(path.dirname(options.outputJson), { recursive: true });
  await writeFile(options.outputJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.outputCsv, renderCsv(rows));
  await writeFile(options.outputMarkdown, renderMarkdown(report));

  console.log(JSON.stringify({
    outputJson: options.outputJson,
    outputCsv: options.outputCsv,
    outputMarkdown: options.outputMarkdown,
    summary: report.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
