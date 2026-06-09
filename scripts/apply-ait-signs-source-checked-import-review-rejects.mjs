#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_INPUT = 'docs/mis-160-ait-signs-workbook-crosscheck.json';
const DEFAULT_OUTPUT = 'docs/mis-161-ait-signs-source-checked-rejects-dry-run.json';
const DEFAULT_BUCKET_BASE = 'docs/mis-161-ait-signs-source-checked-buckets';

function parseArgs(argv) {
  const options = {
    apply: false,
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    bucketBase: DEFAULT_BUCKET_BASE,
  };
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
    } else if (arg === '--bucket-base') {
      options.bucketBase = argv[index + 1];
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
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : clean(value);
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

function bucketFor(row) {
  if (row.crosscheckVerdict === 'reject_source_row_has_no_identity_fields') {
    return 'source_checked_clean_reject';
  }
  if (row.crosscheckVerdict === 'reject_blocked_original_row_has_identity_fields') {
    return 'identity_bearing_needs_promoted_evidence_or_hold';
  }
  return 'explicit_attach_promote_hold_or_record_candidate';
}

function bucketRows(crosscheckRows) {
  return crosscheckRows.map((row) => ({
    ...row,
    bucket: bucketFor(row),
  }));
}

function toCsv(rows) {
  const columns = [
    'bucket',
    'source',
    'recommendation',
    'crosscheckVerdict',
    'sourceSheet',
    'sourceRowNumber',
    'reviewType',
    'target',
    'workbookOriginalIdentityFields',
    'contextPhones',
    'contextEmails',
    'evidence',
    'workbookOriginalText',
    'workbookPreviousRowText',
    'workbookNextRowText',
    'reason',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

async function writeBucketFiles(bucketBase, rows) {
  const buckets = {
    cleanRejects: rows.filter((row) => row.bucket === 'source_checked_clean_reject'),
    identityBearingNeedsReview: rows.filter(
      (row) => row.bucket === 'identity_bearing_needs_promoted_evidence_or_hold',
    ),
    attachPromoteHoldRecordCandidates: rows.filter(
      (row) => row.bucket === 'explicit_attach_promote_hold_or_record_candidate',
    ),
  };
  await mkdir(path.dirname(bucketBase), { recursive: true });
  for (const [name, bucket] of Object.entries(buckets)) {
    await writeFile(`${bucketBase}-${name}.csv`, `${toCsv(bucket)}\n`);
    await writeFile(`${bucketBase}-${name}.json`, `${JSON.stringify(bucket, null, 2)}\n`);
  }
  const summary = {
    total: rows.length,
    buckets: Object.fromEntries(Object.entries(buckets).map(([name, bucket]) => [name, bucket.length])),
    byRecommendation: by(rows, 'recommendation'),
    byCrosscheckVerdict: by(rows, 'crosscheckVerdict'),
  };
  await writeFile(
    `${bucketBase}.md`,
    `# MIS-161 AIT Signs Source-checked Buckets

- Source rows: ${summary.total}
- Clean rejects: ${summary.buckets.cleanRejects}
- Identity-bearing rows needing promoted-evidence or hold review: ${summary.buckets.identityBearingNeedsReview}
- Attach/promote/hold/record candidates: ${summary.buckets.attachPromoteHoldRecordCandidates}

## Files

- \`${bucketBase}-cleanRejects.csv\`
- \`${bucketBase}-identityBearingNeedsReview.csv\`
- \`${bucketBase}-attachPromoteHoldRecordCandidates.csv\`
`,
  );
  return { buckets, summary };
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
    ri.id,
    ri.review_type,
    ri.review_status,
    ri.reason,
    sr.source_sheet,
    sr.source_row_number,
    sr.raw_text
  from latest_batch lb
  join import_review_items ri on ri.import_batch_id = lb.id
  join import_source_rows sr on sr.id = ri.source_row_id
  left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
    and nr.source_row_id = ri.source_row_id
  where ri.review_status = 'pending'
    and nr.id is null
  order by sr.source_sheet, sr.source_row_number, ri.id
`;

const allTargetReviewSql = `
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
    ri.id,
    ri.review_type,
    ri.review_status,
    ri.reason,
    sr.source_sheet,
    sr.source_row_number,
    sr.raw_text
  from latest_batch lb
  join import_review_items ri on ri.import_batch_id = lb.id
  join import_source_rows sr on sr.id = ri.source_row_id
  left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
    and nr.source_row_id = ri.source_row_id
  where nr.id is null
  order by sr.source_sheet, sr.source_row_number, ri.id
`;

function renderMd(report) {
  return `# MIS-161 AIT Signs Source-checked Rejects

- Generated at: ${report.generatedAt}
- Mode: ${report.mode}
- DB writes: ${report.mode === 'apply' ? 'review-item status updates only' : 'none'}

## Summary

- Target source-checked clean rejects: ${report.summary.targetRows}
- Matched pending review items: ${report.summary.matchedPendingReviewItems}
- Already rejected target rows: ${report.summary.alreadyRejectedTargetRows}
- Missing target review items: ${report.summary.missingTargetReviewItems}
- Updated rows: ${report.summary.updatedRows}
- Target buckets: ${Object.entries(report.summary.targetRowsByReviewType).map(([type, count]) => `${type || 'unknown'}=${count}`).join(', ') || 'none'}

## Guardrail

- Only rows with \`crosscheckVerdict=reject_source_row_has_no_identity_fields\` are eligible.
- Rows with original workbook customer/contact/phone/email fields are excluded.
- Rows with normalized records are excluded.
- No CRM records, contacts, clients, work orders, payments, estimates, leads, notes, source rows, or schema are changed.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const crosscheck = JSON.parse(await readFile(options.input, 'utf8'));
  const rows = bucketRows(crosscheck.rows || []);
  const bucketReport = await writeBucketFiles(options.bucketBase, rows);
  const targetRows = rows.filter((row) => row.bucket === 'source_checked_clean_reject');
  const targetKeys = new Set(targetRows.map((row) => key(row.sourceSheet, row.sourceRowNumber)));

  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const fingerprint = await safeFingerprint(client);
  const pendingResult = await client.query(pendingReviewSql, [BUSINESS_UNIT]);
  const allTargetResult = await client.query(allTargetReviewSql, [BUSINESS_UNIT]);
  const pendingByKey = new Map(pendingResult.rows.map((row) => [key(row.source_sheet, row.source_row_number), row]));
  const allByKey = new Map(allTargetResult.rows.map((row) => [key(row.source_sheet, row.source_row_number), row]));
  const candidates = targetRows
    .map((row) => {
      const pending = pendingByKey.get(key(row.sourceSheet, row.sourceRowNumber));
      return pending
        ? {
            ...row,
            reviewItemId: pending.id,
            currentReviewStatus: pending.review_status,
            currentReviewType: pending.review_type,
          }
        : row;
    })
    .filter((row) => row.reviewItemId);
  const alreadyRejectedTargets = targetRows.filter((row) => {
    const current = allByKey.get(key(row.sourceSheet, row.sourceRowNumber));
    return current?.review_status === 'rejected';
  });
  const missingTargets = targetRows.filter((row) => !allByKey.has(key(row.sourceSheet, row.sourceRowNumber)));
  const extraPendingTargets = pendingResult.rows.filter((row) => targetKeys.has(key(row.source_sheet, row.source_row_number)));

  let updatedRows = [];
  if (options.apply && candidates.length) {
    await client.query('begin');
    try {
      const updateResult = await client.query(
        `
          update import_review_items
          set review_status = 'rejected',
              reviewed_at = now(),
              updated_at = now()
          where id = any($1::uuid[])
            and review_status = 'pending'
          returning id, review_type, review_status
        `,
        [candidates.map((row) => row.reviewItemId)],
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
    sourceCrosscheck: options.input,
    bucketSummary: bucketReport.summary,
    summary: {
      targetRows: targetRows.length,
      matchedPendingReviewItems: candidates.length,
      alreadyRejectedTargetRows: alreadyRejectedTargets.length,
      missingTargetReviewItems: missingTargets.length,
      extraPendingTargets: extraPendingTargets.length,
      updatedRows: updatedRows.length,
      targetRowsByReviewType: by(targetRows, 'reviewType'),
    },
    targetRows,
    candidates,
    alreadyRejectedTargets,
    missingTargets,
    updatedRows,
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.md'), renderMd(report));
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
