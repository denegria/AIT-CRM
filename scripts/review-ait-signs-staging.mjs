#!/usr/bin/env node

import process from 'node:process';
import { Client } from 'pg';
import {
  flattenImportReviewSummary,
  loadImportReviewRows,
  loadImportReviewSummary,
  normalizeImportReviewText,
  parseImportReviewSampleLimit,
  resolveImportReviewBatchId,
  updateImportReviewStatus,
} from '../src/lib/import-review/service.js';

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

function toSampleRow(row) {
  return {
    id: row.id,
    record_type: row.record_type,
    status: row.status,
    source_sheet: row.source_sheet,
    source_row_number: row.source_row_number,
    sample: String(row.raw_text || '').slice(0, 220),
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const batchId = await resolveImportReviewBatchId(client, options.batchId);
    let output;
    let summary = null;
    let result = null;

    if (options.command === 'summary') {
      summary = await loadImportReviewSummary(client, batchId);
      output = flattenImportReviewSummary(summary);
    } else if (options.command === 'samples') {
      output = (await loadImportReviewRows(client, batchId, {
        status: normalizeImportReviewText(options.status),
        type: normalizeImportReviewText(options.type),
        limit: parseImportReviewSampleLimit(options.limit),
      })).map(toSampleRow);
    } else if (options.command === 'approve-row') {
      result = await updateImportReviewStatus(client, {
        batchId,
        status: 'approved',
        rowSelector: {
          sheet: options.sheet,
          rowNumber: options.row,
        },
        reason: options.reason,
      });
      output = result.updatedRecords;
    } else if (options.command === 'reject-row') {
      result = await updateImportReviewStatus(client, {
        batchId,
        status: 'rejected',
        rowSelector: {
          sheet: options.sheet,
          rowNumber: options.row,
        },
        reason: options.reason,
      });
      output = result.updatedRecords;
    } else {
      throw new Error(`Unknown command: ${options.command}`);
    }

    console.log(JSON.stringify({ batchId, command: options.command, summary, result, output }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
