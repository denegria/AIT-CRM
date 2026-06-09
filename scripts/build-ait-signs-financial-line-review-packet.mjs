#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_BASENAME = 'docs/mis-160-ait-signs-financial-line-review';

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

function csvCell(value) {
  const text = clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function decisionFor(row) {
  if (row.source_sheet === 'Sheet12' && row.source_row_number === 6) {
    return {
      recommendation: 'attach_to_existing_work_order',
      target: 'WORLD SUPERMARKET / AIT-WO-ARCH-1661',
      evidence: 'Exact title, net, tax, and total match promoted WORK ORDER TERMINADOS Y PAGADOS row 1661: WORLD SUPERMARKET (BOUND BROOK), RUDY, 162 / 10.7325 / 172.7325.',
    };
  }
  if (row.source_sheet === 'Sheet12' && row.source_row_number === 7) {
    return {
      recommendation: 'hold_amount_mismatch',
      target: 'WORLD SUPERMARKET / AIT-WO-ARCH-1667',
      evidence: 'Title matches promoted row 1667, but residual row amount 350.0 / 373.1875 does not match promoted row amount 100.0; the amount appears to match adjacent promoted row 1666 with a different title.',
    };
  }
  return {
    recommendation: 'reject_as_identityless_after_audit',
    target: '',
    evidence: 'No reliable customer, contact, phone, or attachable work-order identity found in row-level audit.',
  };
}

function toCsv(rows) {
  const columns = [
    'recommendation',
    'sourceSheet',
    'sourceRowNumber',
    'reviewType',
    'target',
    'evidence',
    'reason',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMd(report) {
  return `# MIS-160 AIT Signs Financial Line Review

- Generated at: ${report.generatedAt}
- DB writes: none

## Summary

- Financial lines reviewed: ${report.summary.total}
- Reject as identityless after audit: ${report.summary.byRecommendation.reject_as_identityless_after_audit || 0}
- Attach to existing work order: ${report.summary.byRecommendation.attach_to_existing_work_order || 0}
- Hold because amount mismatch: ${report.summary.byRecommendation.hold_amount_mismatch || 0}

## Recommendation

- Reject the 28 identityless financial lines only after approval.
- Hold Sheet12 row 7 because the title matches World Supermarket but the amount does not.
- Attach Sheet12 row 6 to existing work order AIT-WO-ARCH-1661 if/when attachment cleanup is approved.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const fingerprint = await safeFingerprint(client);
  const result = await client.query(
    `
      with latest_batch as (
        select ib.id
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
        sr.source_row_number
      from latest_batch lb
      join import_review_items ri on ri.import_batch_id = lb.id
      left join import_source_rows sr on sr.id = ri.source_row_id
      left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
        and nr.source_row_id = ri.source_row_id
      where ri.review_status = 'pending'
        and nr.id is null
        and ri.review_type = 'financial_line'
      order by sr.source_sheet, sr.source_row_number, ri.id
    `,
    [BUSINESS_UNIT],
  );
  await client.end();

  const rows = result.rows.map((row) => ({
    ...decisionFor(row),
    sourceSheet: row.source_sheet,
    sourceRowNumber: row.source_row_number,
    reviewType: row.review_type,
    reason: clean(row.reason),
  }));
  const byRecommendation = {};
  for (const row of rows) {
    byRecommendation[row.recommendation] = (byRecommendation[row.recommendation] || 0) + 1;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: fingerprint,
    summary: {
      total: rows.length,
      byRecommendation,
    },
    rows,
  };

  await mkdir(path.dirname(options.outputBase), { recursive: true });
  await writeFile(`${options.outputBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${options.outputBase}.csv`, `${toCsv(rows)}\n`);
  await writeFile(`${options.outputBase}.md`, renderMd(report));
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
