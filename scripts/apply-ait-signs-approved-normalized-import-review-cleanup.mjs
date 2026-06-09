#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_OUTPUT = 'docs/mis-159-ait-signs-normalized-import-review-cleanup-dry-run.json';

function parseArgs(argv) {
  const options = {
    apply: false,
    output: DEFAULT_OUTPUT,
  };

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

const candidateSql = `
  with latest_batch as (
    select ib.id, ib.organization_id, ib.business_unit_id
    from import_batches ib
    join business_units bu on bu.id = ib.business_unit_id
    where bu.name = $1
      and ib.source_type = 'xlsx'
    order by ib.created_at desc
    limit 1
  ),
  normalized as (
    select
      nr.id,
      nr.record_type,
      nr.status,
      sr.source_sheet,
      sr.source_row_number,
      case
        when nr.record_type = 'work_order'
          and lower(sr.source_sheet) like '%termin%' then 'AIT-WO-ARCH-' || sr.source_row_number::text
        when nr.record_type = 'work_order'
          and lower(sr.source_sheet) like '%pagad%' then 'AIT-WO-ARCH-' || sr.source_row_number::text
        when nr.record_type = 'work_order'
          and lower(sr.source_sheet) like '%15 signs%' then 'AIT-WO-ACT-' || sr.source_row_number::text
        when nr.record_type = 'work_order' then 'AIT-WO-' || sr.source_row_number::text
        when nr.record_type = 'estimate' then 'AIT-EST-' || sr.source_row_number::text
        else null
      end as entity_key
    from import_normalized_records nr
    join import_source_rows sr on sr.id = nr.source_row_id
    join latest_batch lb on lb.id = nr.import_batch_id
    where nr.status = 'pending'
  ),
  evidence as (
    select
      n.id,
      n.record_type,
      n.source_sheet,
      n.source_row_number,
      n.entity_key,
      exists (
        select 1
        from latest_batch lb
        join activity_events ae on ae.organization_id = lb.organization_id
          and ae.business_unit_id = lb.business_unit_id
          and ae.source_sheet = n.source_sheet
          and ae.source_row = n.source_row_number
          and ae.event_type = 'import_promoted_' || n.record_type
      ) as has_exact_event,
      case
        when n.record_type = 'estimate' then exists (
          select 1
          from latest_batch lb
          join estimates e on e.organization_id = lb.organization_id
            and e.business_unit_id = lb.business_unit_id
            and e.estimate_number = n.entity_key
        )
        when n.record_type = 'work_order' then exists (
          select 1
          from latest_batch lb
          join work_orders wo on wo.organization_id = lb.organization_id
            and wo.business_unit_id = lb.business_unit_id
            and wo.work_order_number = n.entity_key
        )
        when n.record_type = 'payment_snapshot' then exists (
          select 1
          from latest_batch lb
          join payment_snapshots ps on ps.organization_id = lb.organization_id
            and ps.business_unit_id = lb.business_unit_id
            and ps.source_sheet = n.source_sheet
            and ps.source_row = n.source_row_number
        )
        else false
      end as has_entity
    from normalized n
  )
  select *
  from evidence
  where has_exact_event or has_entity
  order by source_sheet, source_row_number, record_type, id
`;

function summarize(rows) {
  const byRecordType = {};
  const byEvidence = {};
  for (const row of rows) {
    byRecordType[row.record_type] = (byRecordType[row.record_type] || 0) + 1;
    const evidence = row.has_exact_event ? 'exact_activity_event' : 'entity_match';
    byEvidence[evidence] = (byEvidence[evidence] || 0) + 1;
  }
  return { byRecordType, byEvidence };
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const safeFingerprint = await runtimeFingerprint(client);

  const candidateResult = await client.query(candidateSql, [BUSINESS_UNIT]);
  const candidateRows = candidateResult.rows;

  let updatedRows = [];
  if (options.apply && candidateRows.length) {
    await client.query('begin');
    try {
      const updateResult = await client.query(
        `
          update import_normalized_records
          set status = 'imported'
          where id = any($1::uuid[])
            and status = 'pending'
          returning id, record_type, status
        `,
        [candidateRows.map((row) => row.id)],
      );
      updatedRows = updateResult.rows;
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: BUSINESS_UNIT,
    safeFingerprint,
    summary: {
      candidates: candidateRows.length,
      updatedRows: updatedRows.length,
      ...summarize(candidateRows),
    },
    samples: candidateRows.slice(0, 25),
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await client.end();

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
