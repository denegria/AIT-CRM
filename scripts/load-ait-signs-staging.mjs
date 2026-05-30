#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Client } from 'pg';

const DEFAULT_ARTIFACT = 'docs/ait-signs-import-staging.json';
const TARGET_BUSINESS_UNIT = 'AIT Signs';
const BUSINESS_UNITS = [
  { name: 'AIT Signs', label: 'Divisions', color: '#4a7aff' },
  { name: 'AIT USA Institute', label: 'Divisions', color: '#22c55e' },
  { name: 'AIT Photo & Video', label: 'Divisions', color: '#a78bfa' },
  { name: 'AIT Taxes', label: 'Divisions', color: '#ef4444' },
];

function parseArgs(argv) {
  const options = {
    artifactPath: DEFAULT_ARTIFACT,
    dryRun: false,
    replace: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--replace') {
      options.replace = true;
    } else if (arg === '--artifact') {
      options.artifactPath = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readArtifact(artifactPath) {
  const resolved = path.resolve(artifactPath);
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return { payload, resolved };
}

function sourceRowKey(sourceSheet, sourceRowNumber) {
  return `${sourceSheet}::${sourceRowNumber}`;
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] ?? 'unknown';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}

function validateArtifact(payload) {
  const errors = [];
  if (payload.businessUnit !== TARGET_BUSINESS_UNIT) {
    errors.push(`artifact businessUnit must be ${TARGET_BUSINESS_UNIT}; received ${payload.businessUnit || 'missing'}`);
  }

  const sourceKeys = new Set(
    payload.sourceRows.map((row) => sourceRowKey(row.sourceSheet, row.sourceRowNumber)),
  );

  for (const record of payload.normalizedRecords) {
    const key = sourceRowKey(record.sourceSheet, record.sourceRowNumber);
    if (!sourceKeys.has(key)) {
      errors.push(`normalized record references missing source row ${key}`);
    }
    const proposal = record.proposedContactJson ||
      record.proposedLeadJson ||
      record.proposedEstimateJson ||
      record.proposedWorkOrderJson ||
      record.proposedPaymentJson ||
      record.proposedNoteJson ||
      {};
    if (proposal.businessUnit !== TARGET_BUSINESS_UNIT) {
      errors.push(`normalized record ${key} must target ${TARGET_BUSINESS_UNIT}; received ${proposal.businessUnit || 'missing'}`);
    }
  }

  for (const item of payload.reviewItems) {
    const key = sourceRowKey(item.sourceSheet, item.sourceRowNumber);
    if (!sourceKeys.has(key)) {
      errors.push(`review item references missing source row ${key}`);
    }
    const resolutionBusinessUnit = item.proposedResolutionJson?.businessUnit;
    if (resolutionBusinessUnit && resolutionBusinessUnit !== TARGET_BUSINESS_UNIT) {
      errors.push(`review item ${key} must target ${TARGET_BUSINESS_UNIT}; received ${resolutionBusinessUnit}`);
    }
  }

  return {
    errors,
    summary: {
      sourceRows: payload.sourceRows.length,
      normalizedRecords: payload.normalizedRecords.length,
      reviewItems: payload.reviewItems.length,
      sourceRowStatuses: countBy(payload.sourceRows, 'parseStatus'),
      normalizedRecordTypes: countBy(payload.normalizedRecords, 'recordType'),
      reviewTypes: countBy(payload.reviewItems, 'reviewType'),
    },
  };
}

async function getOrganizationId(client) {
  const result = await client.query(
    `
      insert into organizations (name, slug)
      values ($1, $2)
      on conflict (slug) do update set name = excluded.name
      returning id
    `,
    ['AIT', 'ait'],
  );
  return result.rows[0].id;
}

async function ensureBusinessUnits(client, organizationId) {
  const ids = new Map();
  for (const unit of BUSINESS_UNITS) {
    const existing = await client.query(
      'select id from business_units where organization_id = $1 and name = $2 limit 1',
      [organizationId, unit.name],
    );
    if (existing.rowCount) {
      ids.set(unit.name, existing.rows[0].id);
      continue;
    }
    const inserted = await client.query(
      `
        insert into business_units (organization_id, name, label, color, is_active)
        values ($1, $2, $3, $4, true)
        returning id
      `,
      [organizationId, unit.name, unit.label, unit.color],
    );
    ids.set(unit.name, inserted.rows[0].id);
  }
  return ids;
}

async function createBatch(client, payload, organizationId, businessUnitId, replace) {
  const existing = await client.query(
    `
      select id
      from import_batches
      where source_name = $1
        and source_type = $2
        and file_hash = $3
        and business_unit_id = $4
      limit 1
    `,
    [payload.sourceName, payload.sourceType, payload.workbookFileHash, businessUnitId],
  );

  if (existing.rowCount && !replace) {
    throw new Error(
      `Import batch already exists for this workbook hash (${existing.rows[0].id}). ` +
      'Run with --replace to delete and recreate the staging batch.',
    );
  }

  if (existing.rowCount && replace) {
    await client.query('delete from import_batches where id = $1', [existing.rows[0].id]);
  }

  const result = await client.query(
    `
      insert into import_batches (
        organization_id,
        business_unit_id,
        source_name,
        source_type,
        file_name,
        file_hash,
        sheet_name,
        status
      )
      values ($1, $2, $3, $4, $5, $6, null, 'staged')
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      payload.sourceName,
      payload.sourceType,
      path.basename(payload.workbookPath),
      payload.workbookFileHash,
    ],
  );
  return result.rows[0].id;
}

async function insertSourceRows(client, batchId, sourceRows) {
  const sourceRowIds = new Map();

  for (const row of sourceRows) {
    const result = await client.query(
      `
        insert into import_source_rows (
          import_batch_id,
          source_sheet,
          source_row_number,
          raw_values_json,
          raw_text,
          parse_status
        )
        values ($1, $2, $3, $4::jsonb, $5, $6)
        returning id
      `,
      [
        batchId,
        row.sourceSheet,
        row.sourceRowNumber,
        JSON.stringify(row.rawValuesJson || []),
        row.rawText || null,
        row.parseStatus || 'pending',
      ],
    );
    sourceRowIds.set(sourceRowKey(row.sourceSheet, row.sourceRowNumber), result.rows[0].id);
  }

  return sourceRowIds;
}

async function insertNormalizedRecords(client, batchId, sourceRowIds, records) {
  for (const record of records) {
    const key = sourceRowKey(record.sourceSheet, record.sourceRowNumber);
    const sourceRowId = sourceRowIds.get(key);
    if (!sourceRowId) {
      throw new Error(`Missing source row id for normalized record ${key}`);
    }

    await client.query(
      `
        insert into import_normalized_records (
          import_batch_id,
          source_row_id,
          record_type,
          proposed_contact_json,
          proposed_lead_json,
          proposed_estimate_json,
          proposed_work_order_json,
          proposed_payment_json,
          proposed_note_json,
          confidence_score,
          status
        )
        values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
      `,
      [
        batchId,
        sourceRowId,
        record.recordType,
        JSON.stringify(record.proposedContactJson || null),
        JSON.stringify(record.proposedLeadJson || null),
        JSON.stringify(record.proposedEstimateJson || null),
        JSON.stringify(record.proposedWorkOrderJson || null),
        JSON.stringify(record.proposedPaymentJson || null),
        JSON.stringify(record.proposedNoteJson || null),
        record.confidenceScore ?? null,
        record.status || 'pending',
      ],
    );
  }
}

async function insertReviewItems(client, batchId, sourceRowIds, reviewItems) {
  for (const item of reviewItems) {
    const sourceRowId = sourceRowIds.get(sourceRowKey(item.sourceSheet, item.sourceRowNumber)) || null;
    await client.query(
      `
        insert into import_review_items (
          import_batch_id,
          source_row_id,
          review_type,
          reason,
          proposed_resolution_json,
          review_status
        )
        values ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        batchId,
        sourceRowId,
        item.reviewType,
        item.reason,
        JSON.stringify(item.proposedResolutionJson || null),
        item.reviewStatus || 'pending',
      ],
    );
  }
}

async function loadStaging(payload, replace) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required unless --dry-run is used');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('begin');
    const organizationId = await getOrganizationId(client);
    const businessUnitIds = await ensureBusinessUnits(client, organizationId);
    const businessUnitId = businessUnitIds.get(TARGET_BUSINESS_UNIT);
    if (!businessUnitId) throw new Error(`Missing ${TARGET_BUSINESS_UNIT} business unit.`);
    const batchId = await createBatch(client, payload, organizationId, businessUnitId, replace);
    const sourceRowIds = await insertSourceRows(client, batchId, payload.sourceRows);
    await insertNormalizedRecords(client, batchId, sourceRowIds, payload.normalizedRecords);
    await insertReviewItems(client, batchId, sourceRowIds, payload.reviewItems);
    await client.query('commit');
    return { batchId };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const { payload, resolved } = readArtifact(options.artifactPath);
  const validation = validateArtifact(payload);

  console.log(JSON.stringify({
    artifactPath: resolved,
    workbookHash: payload.workbookFileHash,
    ...validation.summary,
  }, null, 2));

  if (validation.errors.length) {
    console.error(validation.errors.join('\n'));
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log('Dry run complete. No database writes performed.');
    return;
  }

  const result = await loadStaging(payload, options.replace);
  console.log(`Loaded AIT Signs staging batch ${result.batchId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
