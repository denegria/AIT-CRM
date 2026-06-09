#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const ISSUE = 'MIS-156';
const BUSINESS_UNIT = 'AIT Signs';
const DEFAULT_OUTPUT_JSON = 'docs/mis-156-ait-signs-import-review-triage.json';
const DEFAULT_OUTPUT_CSV = 'docs/mis-156-ait-signs-import-review-triage.csv';
const DEFAULT_OUTPUT_MD = 'docs/mis-156-ait-signs-import-review-triage.md';

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

function compactJson(value, max = 260) {
  const text = clean(typeof value === 'string' ? value : JSON.stringify(value ?? null));
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function proposedFor(row) {
  return row.proposed_lead_json
    || row.proposed_estimate_json
    || row.proposed_work_order_json
    || row.proposed_payment_json
    || row.proposed_note_json
    || null;
}

function normalizedRecommendation(row) {
  if (row.record_type === 'lead') return 'review_leads_before_import';
  if (row.record_type === 'estimate') return 'dry_run_promote_before_import';
  if (row.record_type === 'work_order') return 'dry_run_promote_before_import';
  if (row.record_type === 'payment_snapshot') return 'dry_run_promote_before_import';
  if (row.record_type === 'note') return 'attach_only_after_parent_match';
  return 'hold_unknown_type';
}

function reviewRecommendation(row) {
  if (row.review_type === 'header' || row.review_type === 'section_header') return 'ignore_non_customer_row';
  if (row.review_type === 'financial_line') return 'hold_missing_identity';
  if (row.review_type === 'misc_text') return 'context_only_unattached';
  if (row.review_type === 'record_candidate') return 'manual_review_candidate';
  if (row.review_type === 'note') return 'manual_review_note';
  return 'manual_review';
}

function triagePriority(recommendation) {
  if (recommendation === 'manual_review_candidate') return 'high';
  if (recommendation === 'review_leads_before_import') return 'high';
  if (recommendation === 'manual_review_note') return 'medium';
  if (recommendation === 'dry_run_promote_before_import') return 'medium';
  if (recommendation === 'attach_only_after_parent_match') return 'medium';
  return 'low';
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function renderCsv(rows) {
  const headers = [
    'issue',
    'bucket',
    'priority',
    'recommendation',
    'sourceSheet',
    'sourceRowNumber',
    'recordType',
    'reviewType',
    'status',
    'confidenceScore',
    'customerName',
    'contactName',
    'phoneHint',
    'statusHint',
    'moneyHint',
    'paymentHint',
    'workDescription',
    'reason',
    'originalText',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function sheetLines(breakdown) {
  return Object.entries(breakdown).map(([sheet, counts]) => {
    const parts = Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(', ');
    return `- ${sheet}: ${parts}`;
  });
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-156 AIT Signs Import Review Triage',
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
    `- Latest AIT Signs import batch has ${report.summary.normalizedRows} normalized rows, all still pending.`,
    `- Import Review also has ${report.summary.reviewItems} pending review items.`,
    '- Recommendation: create an approval/import plan from this packet before approving or importing anything in the UI.',
    '',
    '## Normalized Rows',
    '',
    ...Object.entries(report.summary.normalizedByType).map(([type, count]) => `- ${type}: ${count}`),
    '',
    '## Rows By Sheet',
    '',
    ...sheetLines(report.summary.normalizedBySheetAndType),
    '',
    '## Review Items',
    '',
    ...Object.entries(report.summary.reviewByType).map(([type, count]) => `- ${type}: ${count}`),
    '',
    '## Default Handling',
    '',
    '- Leads: review first because they can create follow-up work and customer records.',
    '- Estimates/work orders/payments: do a promote dry-run with duplicate matching before any import approval.',
    '- Notes: attach only after the parent contact/order match is known.',
    '- Headers/section headers: ignore as non-customer rows.',
    '- Financial-only lines: hold unless workbook context clearly supplies identity.',
    '- Misc text: context only unless it can be safely attached to a neighboring parent row.',
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
    'select id, name from business_units where name = $1 limit 1',
    [BUSINESS_UNIT],
  );
  if (!businessUnit.rows[0]) throw new Error(`Business unit not found: ${BUSINESS_UNIT}`);

  const batchResult = await client.query(
    `
      select ib.id, ib.source_name, ib.source_type, ib.file_name, ib.status, ib.created_at
      from import_batches ib
      where ib.business_unit_id = $1
      order by ib.created_at desc
      limit 1
    `,
    [businessUnit.rows[0].id],
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new Error('No AIT Signs import batch found');

  const normalizedResult = await client.query(
    `
      select
        nr.id,
        nr.record_type,
        nr.status,
        nr.confidence_score,
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

  const reviewResult = await client.query(
    `
      select
        ri.id,
        ri.review_type,
        ri.reason,
        ri.review_status,
        sr.source_sheet,
        sr.source_row_number
      from import_review_items ri
      left join import_source_rows sr on sr.id = ri.source_row_id
      where ri.import_batch_id = $1
      order by ri.review_type, sr.source_sheet, sr.source_row_number, ri.id
    `,
    [batch.id],
  );

  await client.end();

  const normalizedRows = normalizedResult.rows.map((row) => {
    const proposed = proposedFor(row);
    const recommendation = normalizedRecommendation(row);
    return {
      issue: ISSUE,
      bucket: 'normalized_record',
      priority: triagePriority(recommendation),
      recommendation,
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      recordType: row.record_type,
      reviewType: '',
      status: row.status,
      confidenceScore: row.confidence_score,
      customerName: proposed?.customerName || '',
      contactName: proposed?.contactName || '',
      phoneHint: proposed?.phoneHint || '',
      statusHint: proposed?.statusHint || '',
      moneyHint: proposed?.moneyHint || '',
      paymentHint: proposed?.paymentHint || '',
      workDescription: proposed?.workDescription || '',
      reason: '',
      originalText: proposed?.originalText || '',
    };
  });

  const reviewRows = reviewResult.rows.map((row) => {
    const recommendation = reviewRecommendation(row);
    return {
      issue: ISSUE,
      bucket: 'review_item',
      priority: triagePriority(recommendation),
      recommendation,
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      recordType: '',
      reviewType: row.review_type,
      status: row.review_status,
      confidenceScore: '',
      customerName: '',
      contactName: '',
      phoneHint: '',
      statusHint: '',
      moneyHint: '',
      paymentHint: '',
      workDescription: '',
      reason: row.reason,
      originalText: compactJson(row.reason, 500),
    };
  });

  const normalizedBySheetAndType = {};
  for (const row of normalizedRows) {
    normalizedBySheetAndType[row.sourceSheet] ||= {};
    normalizedBySheetAndType[row.sourceSheet][row.recordType] = (normalizedBySheetAndType[row.sourceSheet][row.recordType] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    businessUnit: BUSINESS_UNIT,
    safeFingerprint,
    batch,
    summary: {
      normalizedRows: normalizedRows.length,
      reviewItems: reviewRows.length,
      normalizedByType: countBy(normalizedRows, 'recordType'),
      normalizedByStatus: countBy(normalizedRows, 'status'),
      normalizedByRecommendation: countBy(normalizedRows, 'recommendation'),
      normalizedBySheetAndType,
      reviewByType: countBy(reviewRows, 'reviewType'),
      reviewByStatus: countBy(reviewRows, 'status'),
      reviewByRecommendation: countBy(reviewRows, 'recommendation'),
    },
    sampleRows: {
      highPriority: [...normalizedRows, ...reviewRows].filter((row) => row.priority === 'high').slice(0, 20),
      reviewItems: reviewRows.slice(0, 20),
    },
    artifacts: {
      csv: options.outputCsv,
      json: options.outputJson,
    },
  };

  await mkdir(path.dirname(options.outputJson), { recursive: true });
  await writeFile(options.outputJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.outputCsv, renderCsv([...normalizedRows, ...reviewRows]));
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
