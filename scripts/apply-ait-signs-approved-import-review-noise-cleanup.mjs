#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_OUTPUT = 'docs/mis-160-ait-signs-import-review-noise-cleanup-dry-run.json';

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

const candidateSql = `
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
  left join import_source_rows sr on sr.id = ri.source_row_id
  left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
    and nr.source_row_id = ri.source_row_id
  where ri.review_status = 'pending'
    and nr.id is null
    and ri.review_type in ('header', 'section_header')
  order by sr.source_sheet, sr.source_row_number, ri.id
`;

function byType(rows) {
  return rows.reduce((acc, row) => {
    acc[row.review_type] = (acc[row.review_type] || 0) + 1;
    return acc;
  }, {});
}

function renderMd(report) {
  return `# MIS-160 AIT Signs Import Review Noise Cleanup

- Generated at: ${report.generatedAt}
- Mode: ${report.mode}
- DB writes: ${report.mode === 'apply' ? 'review-item status updates only' : 'none'}

## Summary

- Candidate parser header/noise rows: ${report.summary.candidates}
- Updated rows: ${report.summary.updatedRows}
- Candidate types: ${Object.entries(report.summary.byReviewType).map(([type, count]) => `${type}=${count}`).join(', ') || 'none'}

## Guardrail

- Only pending AIT Signs XLSX review-item-only rows with review_type "header" or "section_header" are eligible.
- Rows with normalized records are excluded.
- No CRM records, contacts, clients, work orders, payments, estimates, leads, notes, source rows, or schema are changed.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const fingerprint = await safeFingerprint(client);
  const candidateResult = await client.query(candidateSql, [BUSINESS_UNIT]);
  const candidates = candidateResult.rows;

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
        [candidates.map((row) => row.id)],
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
      candidates: candidates.length,
      updatedRows: updatedRows.length,
      byReviewType: byType(candidates),
    },
    candidates,
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
