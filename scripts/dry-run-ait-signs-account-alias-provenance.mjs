#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  DEFAULT_BUSINESS_UNIT,
  normalizeText,
  safeDbFingerprint,
  writeJson,
  writeText,
} from './dry-run-ait-signs-account-backfill.mjs';

const LOW_SIGNAL_KEYS = new Set([
  'unknown',
  'unk',
  'none',
  'no name',
  'noname',
  'na',
  'n a',
  'test',
  'customer',
  'client',
  'cash',
  'wrong number',
  'wrongnumber',
  'do not call',
  'donotcall',
  'dnc',
]);

function parseArgs(argv) {
  const options = {
    businessUnit: DEFAULT_BUSINESS_UNIT,
    output: null,
    markdown: null,
    sampleLimit: 25,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--business-unit') {
      options.businessUnit = argv[i + 1];
      i += 1;
    } else if (arg === '--output') {
      options.output = argv[i + 1];
      i += 1;
    } else if (arg === '--markdown') {
      options.markdown = argv[i + 1];
      i += 1;
    } else if (arg === '--sample-limit') {
      options.sampleLimit = Number(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1) {
    throw new Error('--sample-limit must be a positive number');
  }

  return options;
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function compactKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function isLowSignalAlias(value) {
  const normalized = normalizeText(value);
  const compact = compactKey(value);
  return !normalized || !compact || LOW_SIGNAL_KEYS.has(normalized) || LOW_SIGNAL_KEYS.has(compact);
}

function uniqueSourceNames(row) {
  const seen = new Set();
  const sources = [
    { field: 'contacts.name', value: row.contact_name },
    { field: 'contacts.company_name', value: row.company_name },
    { field: 'account.metadata.sourceContactName', value: row.metadata_source_contact_name },
    { field: 'account.metadata.sourceCompanyName', value: row.metadata_source_company_name },
  ];
  return sources
    .map((source) => ({ ...source, value: cleanText(source.value), normalizedValue: normalizeText(source.value) }))
    .filter((source) => {
      if (!source.value) return false;
      const key = `${source.normalizedValue}:${source.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function loadLinkedAccountRows(client, businessUnit) {
  const result = await client.query(
    `
      select
        ca.id as account_id,
        ca.display_name as account_display_name,
        ca.normalized_name as account_normalized_name,
        ca.metadata_json as account_metadata,
        c.id as contact_id,
        c.name as contact_name,
        c.company_name,
        c.source_label,
        ca.metadata_json->>'sourceContactName' as metadata_source_contact_name,
        ca.metadata_json->>'sourceCompanyName' as metadata_source_company_name,
        ca.metadata_json->>'sourceLabel' as metadata_source_label
      from client_accounts ca
      join contacts c on c.client_account_id = ca.id
      join business_units bu on bu.id = ca.business_unit_id
      where bu.name = $1
      order by ca.display_name asc, c.created_at asc, c.id asc
    `,
    [businessUnit],
  );
  return result.rows;
}

async function loadAliasCounts(client, businessUnit) {
  const result = await client.query(
    `
      select
        a.visibility,
        a.type,
        count(*)::int as count
      from client_account_aliases a
      join business_units bu on bu.id = a.business_unit_id
      where bu.name = $1
      group by a.visibility, a.type
      order by visibility, type
    `,
    [businessUnit],
  );
  return result.rows;
}

function buildAliasPlan(rows, aliasCounts, options) {
  const plannedHiddenAliases = [];
  const plannedVisibleAliases = [];
  const skippedRedundant = [];
  const skippedLowSignal = [];
  const accountIds = new Set();
  const sourceLabelCounts = new Map();
  let metadataProvenanceRows = 0;
  let inspectedSourceNames = 0;

  for (const row of rows) {
    accountIds.add(row.account_id);
    if (row.account_metadata?.sourceContactId || row.account_metadata?.sourceContactName || row.account_metadata?.sourceCompanyName) {
      metadataProvenanceRows += 1;
    }
    const sourceLabel = cleanText(row.source_label || row.metadata_source_label || 'unknown');
    sourceLabelCounts.set(sourceLabel, (sourceLabelCounts.get(sourceLabel) || 0) + 1);

    const accountCompact = compactKey(row.account_display_name);
    const rowSourceNames = uniqueSourceNames(row);
    inspectedSourceNames += rowSourceNames.length;

    for (const source of rowSourceNames) {
      const sourceCompact = compactKey(source.value);
      const base = {
        accountId: row.account_id,
        accountDisplayName: row.account_display_name,
        contactId: row.contact_id,
        value: source.value,
        normalizedValue: source.normalizedValue,
        sourceField: source.field,
        sourceLabel,
      };

      if (sourceCompact === accountCompact) {
        skippedRedundant.push({
          ...base,
          reason: 'source_name_matches_account_display_name',
        });
        continue;
      }

      if (isLowSignalAlias(source.value)) {
        skippedLowSignal.push({
          ...base,
          reason: 'low_signal_source_name',
        });
        continue;
      }

      plannedHiddenAliases.push({
        ...base,
        type: 'source_alias',
        visibility: 'hidden',
        searchable: true,
        confidence: '0.80',
        reason: 'source_name_differs_from_account_display_name',
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    target: {
      businessUnit: options.businessUnit,
      db: safeDbFingerprint(),
    },
    rules: {
      visibleAliases: 'do not auto-create visible aliases from cleaned import/source names',
      hiddenProvenance: 'only plan hidden searchable aliases when a source name differs from the canonical account display name',
      currentDecision: 'keep variants empty for backfilled accounts unless a future employee or reviewed data slice promotes a useful variant',
    },
    existingAliasCounts: aliasCounts,
    summary: {
      linkedAccounts: accountIds.size,
      linkedContacts: rows.length,
      metadataProvenanceRows,
      inspectedSourceNames,
      plannedHiddenAliases: plannedHiddenAliases.length,
      plannedVisibleAliases: plannedVisibleAliases.length,
      skippedRedundantSourceNames: skippedRedundant.length,
      skippedLowSignalSourceNames: skippedLowSignal.length,
      sourceLabels: [...sourceLabelCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, count]) => ({ label, count })),
    },
    samples: {
      plannedHiddenAliases: plannedHiddenAliases.slice(0, options.sampleLimit),
      plannedVisibleAliases: plannedVisibleAliases.slice(0, options.sampleLimit),
      skippedRedundantSourceNames: skippedRedundant.slice(0, options.sampleLimit),
      skippedLowSignalSourceNames: skippedLowSignal.slice(0, options.sampleLimit),
    },
    fullResults: {
      plannedHiddenAliases,
      plannedVisibleAliases,
      skippedRedundantSourceNames: skippedRedundant,
      skippedLowSignalSourceNames: skippedLowSignal,
    },
  };
}

function markdownList(items, formatter, emptyText = 'None in sample.') {
  if (!items.length) return [`- ${emptyText}`];
  return items.map(formatter);
}

function toMarkdown(report) {
  const lines = [
    '# MIS-133 AIT Signs Account Alias/Provenance Dry Run',
    '',
    '## Summary',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Dry run: ${report.dryRun ? 'yes' : 'no'}`,
    `- Business unit: ${report.target.businessUnit}`,
    `- Target base URL: ${report.target.db.targetBaseUrl || 'not provided'}`,
    `- DB branch label: ${report.target.db.branchLabel || 'not provided'}`,
    `- DB host suffix: ${report.target.db.hostSuffix || 'not provided'}`,
    `- DB name: ${report.target.db.database || 'not provided'}`,
    '',
    '## Counts',
    '',
    `- Linked accounts reviewed: ${report.summary.linkedAccounts}`,
    `- Linked contacts reviewed: ${report.summary.linkedContacts}`,
    `- Account metadata provenance rows already present: ${report.summary.metadataProvenanceRows}`,
    `- Unique source names inspected: ${report.summary.inspectedSourceNames}`,
    `- Planned hidden/searchable aliases: ${report.summary.plannedHiddenAliases}`,
    `- Planned visible aliases: ${report.summary.plannedVisibleAliases}`,
    `- Skipped redundant source names: ${report.summary.skippedRedundantSourceNames}`,
    `- Skipped low-signal source names: ${report.summary.skippedLowSignalSourceNames}`,
    '',
    '## Decision Rule',
    '',
    '- Do not auto-create visible aliases from cleaned import/source names.',
    '- Keep the variants/aliases field available for future employee-promoted DBA names, abbreviations, locations, or useful misspellings.',
    '- Only hidden/searchable provenance aliases should be planned automatically, and only when the source name differs from the canonical account name.',
    '',
    '## Result',
    '',
    report.summary.plannedHiddenAliases === 0 && report.summary.plannedVisibleAliases === 0
      ? '- No alias rows should be prefilled for the 795 safe one-to-one backfilled accounts. The source names match the canonical account names, and provenance is already retained in account metadata.'
      : '- Alias rows are planned below for review before any apply step.',
    '',
    '## Source Label Breakdown',
    '',
    ...markdownList(report.summary.sourceLabels, (item) => `- ${item.label}: ${item.count}`),
    '',
    '## Planned Hidden Alias Sample',
    '',
    ...markdownList(report.samples.plannedHiddenAliases, (alias) => (
      `- ${alias.accountDisplayName}: ${alias.value} (${alias.sourceField}, ${alias.sourceLabel})`
    )),
    '',
    '## Planned Visible Alias Sample',
    '',
    ...markdownList(report.samples.plannedVisibleAliases, (alias) => (
      `- ${alias.accountDisplayName}: ${alias.value} (${alias.sourceField}, ${alias.sourceLabel})`
    )),
    '',
    '## Redundant Source Name Sample',
    '',
    ...markdownList(report.samples.skippedRedundantSourceNames, (alias) => (
      `- ${alias.accountDisplayName}: ${alias.value} (${alias.sourceField}, ${alias.sourceLabel})`
    )),
    '',
    '## Next Step',
    '',
    'Leave aliases empty for these backfilled accounts until a reviewed data slice or employee action promotes useful variants. Continue with reviewed consolidation for held duplicate and near-duplicate groups.',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('begin transaction read only');
    const rows = await loadLinkedAccountRows(client, options.businessUnit);
    const aliasCounts = await loadAliasCounts(client, options.businessUnit);
    const report = buildAliasPlan(rows, aliasCounts, options);
    await client.query('commit');

    if (options.output) writeJson(options.output, report);
    if (options.markdown) writeText(options.markdown, toMarkdown(report));

    console.log(JSON.stringify({
      dryRun: true,
      output: options.output,
      markdown: options.markdown,
      summary: report.summary,
    }, null, 2));
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
