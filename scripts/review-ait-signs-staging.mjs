#!/usr/bin/env node

import process from 'node:process';
import { Client } from 'pg';

function parseArgs(argv) {
  const options = {
    command: argv[2] || 'summary',
    batchId: null,
    sheet: null,
    row: null,
    status: null,
    type: null,
    limit: 10,
    reason: null,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--batch-id') {
      options.batchId = argv[i + 1];
      i += 1;
    } else if (arg === '--sheet') {
      options.sheet = argv[i + 1];
      i += 1;
    } else if (arg === '--row') {
      options.row = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--status') {
      options.status = argv[i + 1];
      i += 1;
    } else if (arg === '--type') {
      options.type = argv[i + 1];
      i += 1;
    } else if (arg === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--reason') {
      options.reason = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function getLatestBatchId(client) {
  const result = await client.query('select id from import_batches order by created_at desc limit 1');
  return result.rows[0]?.id || null;
}

async function resolveBatchId(client, batchId) {
  const resolved = batchId || await getLatestBatchId(client);
  if (!resolved) throw new Error('No import batch found.');
  return resolved;
}

async function summary(client, batchId) {
  const result = await client.query(
    `
      select 'source_rows' as bucket, parse_status as status, count(*)::int as count
      from import_source_rows
      where import_batch_id = $1
      group by parse_status
      union all
      select 'normalized_records' as bucket, status, count(*)::int as count
      from import_normalized_records
      where import_batch_id = $1
      group by status
      union all
      select 'review_items' as bucket, review_status as status, count(*)::int as count
      from import_review_items
      where import_batch_id = $1
      group by review_status
      order by bucket, status
    `,
    [batchId],
  );
  return result.rows;
}

async function samples(client, batchId, options) {
  const params = [batchId];
  const filters = ['nr.import_batch_id = $1'];
  if (options.status) {
    params.push(options.status);
    filters.push(`nr.status = $${params.length}`);
  }
  if (options.type) {
    params.push(options.type);
    filters.push(`nr.record_type = $${params.length}`);
  }
  params.push(options.limit);

  const result = await client.query(
    `
      select
        nr.id,
        nr.record_type,
        nr.status,
        sr.source_sheet,
        sr.source_row_number,
        left(coalesce(sr.raw_text, ''), 220) as sample
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      where ${filters.join(' and ')}
      order by sr.source_sheet, sr.source_row_number
      limit $${params.length}
    `,
    params,
  );
  return result.rows;
}

async function setRowStatus(client, batchId, options, status) {
  if (!options.sheet || !options.row) {
    throw new Error(`${options.command} requires --sheet and --row`);
  }

  const result = await client.query(
    `
      update import_normalized_records nr
      set status = $1
      from import_source_rows sr
      where sr.id = nr.source_row_id
        and nr.import_batch_id = $2
        and sr.source_sheet = $3
        and sr.source_row_number = $4
      returning nr.id, nr.record_type, nr.status
    `,
    [status, batchId, options.sheet, options.row],
  );

  if (options.reason) {
    await client.query(
      `
        update import_review_items ri
        set
          review_status = $1,
          proposed_resolution_json = coalesce(ri.proposed_resolution_json, '{}'::jsonb) || $2::jsonb,
          reviewed_at = now()
        from import_source_rows sr
        where sr.id = ri.source_row_id
          and ri.import_batch_id = $3
          and sr.source_sheet = $4
          and sr.source_row_number = $5
      `,
      [
        status === 'approved' ? 'approved' : 'rejected',
        JSON.stringify({ operatorReason: options.reason }),
        batchId,
        options.sheet,
        options.row,
      ],
    );
  }

  return result.rows;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const batchId = await resolveBatchId(client, options.batchId);
    let output;

    if (options.command === 'summary') {
      output = await summary(client, batchId);
    } else if (options.command === 'samples') {
      output = await samples(client, batchId, options);
    } else if (options.command === 'approve-row') {
      output = await setRowStatus(client, batchId, options, 'approved');
    } else if (options.command === 'reject-row') {
      output = await setRowStatus(client, batchId, options, 'rejected');
    } else {
      throw new Error(`Unknown command: ${options.command}`);
    }

    console.log(JSON.stringify({ batchId, command: options.command, output }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
