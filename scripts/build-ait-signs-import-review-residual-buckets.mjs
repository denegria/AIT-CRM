#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const ISSUE = 'MIS-159';
const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_BASENAME = 'docs/mis-159-ait-signs-import-review-residual-buckets';

function parseArgs(argv) {
  const options = { outputBase: DEFAULT_BASENAME };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-base') {
      options.outputBase = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function clean(value) {
  return String(value || '').trim();
}

function csvCell(value) {
  const text = clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows) {
  const columns = [
    'bucket',
    'recommendedBucket',
    'sourceSheet',
    'sourceRowNumber',
    'reviewType',
    'customerName',
    'contactName',
    'workDescription',
    'reason',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function proposalFor(row) {
  const proposal =
    row.proposed_note_json ||
    row.proposed_work_order_json ||
    row.proposed_estimate_json ||
    row.proposed_lead_json ||
    row.proposed_payment_json ||
    {};
  const contact = proposal.contact || proposal.customer || {};
  return {
    customerName: clean(proposal.customerName || proposal.customer_name || contact.companyName || contact.company_name || proposal.companyName),
    contactName: clean(proposal.contactName || proposal.contact_name || contact.contactName || contact.name || proposal.personName),
    workDescription: clean(proposal.workDescription || proposal.description || proposal.note || proposal.body || proposal.originalText),
  };
}

function reviewItemBucket(reviewType) {
  if (reviewType === 'financial_line') {
    return {
      recommendedBucket: 'identityless_financial_line',
      reason: 'Financial/context line without enough customer identity to attach safely.',
    };
  }
  if (reviewType === 'header' || reviewType === 'section_header') {
    return {
      recommendedBucket: 'parser_header_noise',
      reason: 'Workbook header or section label preserved for review; not customer data.',
    };
  }
  if (reviewType === 'misc_text') {
    return {
      recommendedBucket: 'loose_follow_up_or_context_text',
      reason: 'Loose workbook text that may be follow-up/context, not a structured CRM record.',
    };
  }
  if (reviewType === 'note') {
    return {
      recommendedBucket: 'review_only_follow_up_note',
      reason: 'Review-only note/follow-up text that needs attach-vs-ignore direction.',
    };
  }
  if (reviewType === 'record_candidate') {
    return {
      recommendedBucket: 'review_only_record_candidate',
      reason: 'Potential record candidate that was not normalized safely.',
    };
  }
  return {
    recommendedBucket: 'review_only_other',
    reason: 'Review-only row that needs separate direction.',
  };
}

async function loadSecretsFingerprint() {
  try {
    const secrets = JSON.parse(await readFile('/root/.openclaw/secrets.json', 'utf8'));
    const databaseUrl = secrets.aitCrm?.staging?.databaseUrl || '';
    const url = databaseUrl ? new URL(databaseUrl) : null;
    return {
      expectedNeonBranchId: EXPECTED_BRANCH_ID,
      targetBaseUrl: secrets.aitCrm?.staging?.baseUrl || null,
      hostSuffix: url ? url.hostname.split('.').slice(0, 2).join('.') : null,
    };
  } catch {
    return {
      expectedNeonBranchId: EXPECTED_BRANCH_ID,
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

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const safeFingerprint = await runtimeFingerprint(client);

  const batchResult = await client.query(
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
  const batch = batchResult.rows[0];
  if (!batch) throw new Error(`No XLSX import batch found for ${BUSINESS_UNIT}`);

  const normalizedResult = await client.query(
    `
      select
        nr.id,
        nr.record_type,
        nr.status,
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
        and nr.status = 'pending'
      order by sr.source_sheet, sr.source_row_number, nr.record_type, nr.id
    `,
    [batch.id],
  );

  const reviewOnlyResult = await client.query(
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
      left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
        and nr.source_row_id = ri.source_row_id
      where ri.import_batch_id = $1
        and ri.review_status = 'pending'
        and nr.id is null
      order by ri.review_type, sr.source_sheet, sr.source_row_number, ri.id
    `,
    [batch.id],
  );

  await client.end();

  const normalizedRows = normalizedResult.rows.map((row) => {
    const proposal = proposalFor(row);
    return {
      bucket: `normalized_${row.record_type}_pending`,
      recommendedBucket: row.record_type === 'note' ? 'follow_up_note_attach_or_hold' : 'normalized_pending_other',
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      reviewType: '',
      ...proposal,
      reason: row.record_type === 'note'
        ? 'Parent evidence exists but exact promoted-note event does not.'
        : 'Pending normalized row remains after approved cleanup.',
    };
  });

  const reviewOnlyRows = reviewOnlyResult.rows.map((row) => {
    const bucket = reviewItemBucket(row.review_type);
    return {
      bucket: 'review_item_only',
      recommendedBucket: bucket.recommendedBucket,
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      reviewType: row.review_type,
      customerName: '',
      contactName: '',
      workDescription: '',
      reason: `${bucket.reason} Source parser reason: ${clean(row.reason)}`,
    };
  });

  const rows = [...normalizedRows, ...reviewOnlyRows];
  const byRecommendedBucket = {};
  for (const row of rows) {
    byRecommendedBucket[row.recommendedBucket] = (byRecommendedBucket[row.recommendedBucket] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    businessUnit: BUSINESS_UNIT,
    safeFingerprint,
    batchId: batch.id,
    summary: {
      totalResidualRows: rows.length,
      visibleNormalizedPending: normalizedRows.length,
      pendingReviewItems: reviewOnlyRows.length,
      byRecommendedBucket,
    },
    rows,
  };

  const md = `# ${ISSUE} AIT Signs Residual Import Review Buckets

- Generated at: ${report.generatedAt}
- No DB writes in this residual export.

## Summary

- Total residual rows: ${report.summary.totalResidualRows}
- Visible normalized pending rows: ${report.summary.visibleNormalizedPending}
- Pending review-item-only rows: ${report.summary.pendingReviewItems}

## Buckets

${Object.entries(byRecommendedBucket).map(([bucket, count]) => `- ${bucket}: ${count}`).join('\n')}

## Recommendation

- Do not attack the parser for this one-off cleanup. The parser preserved noisy/context rows because the workbook mixes headers, follow-up text, financial totals, and records in the same sheets.
- Treat headers/section labels and identityless financial lines as safe ignore/reject candidates after approval.
- Review loose follow-up/context text, review-only notes, record candidates, and the 19 normalized notes as the only meaningful remainder.
`;

  await mkdir(path.dirname(options.outputBase), { recursive: true });
  await writeFile(`${options.outputBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${options.outputBase}.csv`, `${toCsv(rows)}\n`);
  await writeFile(`${options.outputBase}.md`, md);

  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
