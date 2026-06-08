#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { safeDbFingerprint } from './dry-run-ait-signs-canonical-replacement-plan.mjs';

const SOURCE_LABEL = 'ait_signs_shared_contact_variant_backfill';
const EXPECTED_STAGING_BRANCH_ID = 'br-broad-hill-aptjpyea';
const DEFAULT_OUTPUT = 'docs/mis-148-ait-signs-spelling-variant-backfill-rollback-dryrun.json';
const DEFAULT_MARKDOWN = 'docs/mis-148-ait-signs-spelling-variant-backfill-rollback-dryrun.md';

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    markdown: DEFAULT_MARKDOWN,
    businessUnit: 'AIT Signs',
    apply: false,
    confirmStaging: false,
    sampleLimit: 40,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = argv[index + 1];
      index += 1;
    } else if (arg === '--markdown') {
      options.markdown = argv[index + 1];
      index += 1;
    } else if (arg === '--business-unit') {
      options.businessUnit = argv[index + 1];
      index += 1;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-staging') {
      options.confirmStaging = true;
    } else if (arg === '--sample-limit') {
      options.sampleLimit = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1) {
    throw new Error('--sample-limit must be a positive number');
  }

  return options;
}

async function stagingRuntimeFingerprint(client) {
  const currentDb = await client.query('select current_database() as database');
  const secrets = await safeDbFingerprint();
  return {
    ...secrets,
    currentDatabase: currentDb.rows[0]?.database || null,
  };
}

function assertStagingApplyAllowed(options, fingerprint) {
  if (!options.apply) return;
  if (!options.confirmStaging) throw new Error('Refusing to apply without --confirm-staging.');
  if (fingerprint?.expectedNeonBranchId !== EXPECTED_STAGING_BRANCH_ID) {
    throw new Error(`Refusing to apply: expected staging branch ${EXPECTED_STAGING_BRANCH_ID}, received ${fingerprint?.expectedNeonBranchId || 'unknown'}.`);
  }
}

async function loadRows(client, businessUnitName) {
  const result = await client.query(
    `
      select
        cp.id,
        cp.contact_id,
        cp.name,
        cp.phone,
        cp.is_primary,
        cp.source_sheet,
        cp.source_row,
        cp.metadata_json ->> 'candidateClientName' as candidate_client_name,
        cp.metadata_json ->> 'matchedClientName' as matched_client_name,
        c.name as current_contact_name,
        bu.name as business_unit_name
      from contact_people cp
      join contacts c on c.id = cp.contact_id
      join business_units bu on bu.id = cp.business_unit_id
      where cp.source_label = $1
        and bu.name = $2
      order by c.name, cp.name, cp.source_sheet, cp.source_row
    `,
    [SOURCE_LABEL, businessUnitName],
  );
  return result.rows;
}

async function deleteRows(client, businessUnitName) {
  const result = await client.query(
    `
      delete from contact_people cp
      using business_units bu
      where cp.business_unit_id = bu.id
        and cp.source_label = $1
        and bu.name = $2
      returning cp.id
    `,
    [SOURCE_LABEL, businessUnitName],
  );
  return result.rows;
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-148 AIT Signs Spelling-Variant Backfill Rollback',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Business unit: ${report.businessUnit}`,
    `- Source label: ${report.sourceLabel}`,
    `- Target base URL: ${report.safeFingerprint?.targetBaseUrl || 'unknown'}`,
    `- Neon branch id: ${report.safeFingerprint?.expectedNeonBranchId || 'unknown'}`,
    `- Current database: ${report.safeFingerprint?.currentDatabase || 'unknown'}`,
    '',
    '## Summary',
    '',
    `- Rows found before rollback: ${report.summary.rowsBefore}`,
    `- Rows deleted: ${report.summary.rowsDeleted}`,
    `- Rows remaining after rollback: ${report.summary.rowsAfter}`,
    `- Distinct contacts affected: ${report.summary.distinctContactsBefore}`,
    '',
    '## Guardrails',
    '',
    '- Deletes only contact_people rows tagged with the MIS-147 spelling-variant source label.',
    '- Does not touch exact-match backfill rows, contacts, client names, work orders, estimates, payments, tasks, or notes.',
    '- This rollback reflects the product rule that obvious spelling variants are review/provenance-only.',
    '',
    '## Sample Rows',
    '',
  ];

  for (const row of report.samples.beforeRows) {
    lines.push(`- ${row.current_contact_name}: ${row.name} from ${row.candidate_client_name || 'unknown candidate'} (${row.source_sheet || 'unknown sheet'}#${row.source_row || 'unknown row'})`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const fingerprint = await stagingRuntimeFingerprint(client);
  assertStagingApplyAllowed(options, fingerprint);

  const beforeRows = await loadRows(client, options.businessUnit);
  let deletedRows = [];
  if (options.apply && beforeRows.length) {
    await client.query('begin');
    try {
      deletedRows = await deleteRows(client, options.businessUnit);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  const afterRows = await loadRows(client, options.businessUnit);
  await client.end();

  const report = {
    generatedAt: new Date().toISOString(),
    issue: 'MIS-148',
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: options.businessUnit,
    sourceLabel: SOURCE_LABEL,
    safeFingerprint: fingerprint,
    summary: {
      rowsBefore: beforeRows.length,
      rowsDeleted: deletedRows.length,
      rowsAfter: afterRows.length,
      distinctContactsBefore: new Set(beforeRows.map((row) => row.contact_id)).size,
    },
    samples: {
      beforeRows: beforeRows.slice(0, options.sampleLimit),
      afterRows: afterRows.slice(0, options.sampleLimit),
    },
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.markdown, renderMarkdown(report));

  console.log(JSON.stringify({
    output: options.output,
    markdown: options.markdown,
    summary: report.summary,
    mode: report.mode,
    safeFingerprint: report.safeFingerprint,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
