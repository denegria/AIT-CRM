#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import {
  buildWorkbookCandidates,
  compareCandidatesToContacts,
  loadCurrentContacts,
  loadExistingPeople,
  loadWorkbookArtifact,
  normalizeName,
  resolveWorkbook,
  safeDbFingerprint,
} from './dry-run-ait-signs-canonical-replacement-plan.mjs';

const DEFAULT_OUTPUT = 'docs/mis-146-ait-signs-exact-linked-people-backfill-apply.json';
const DEFAULT_MARKDOWN = 'docs/mis-146-ait-signs-exact-linked-people-backfill-apply.md';
const SOURCE_LABEL = 'ait_signs_estimate_exact_backfill';
const EXPECTED_STAGING_BRANCH_ID = 'br-broad-hill-aptjpyea';

function parseArgs(argv) {
  const options = {
    workbook: null,
    output: DEFAULT_OUTPUT,
    markdown: DEFAULT_MARKDOWN,
    businessUnit: 'AIT Signs',
    apply: false,
    confirmStaging: false,
    sampleLimit: 25,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workbook') {
      options.workbook = argv[index + 1];
      index += 1;
    } else if (arg === '--output') {
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

function splitSourceRow(sourceRow) {
  const [sheet, row] = String(sourceRow || '').split('#');
  return {
    sourceSheet: sheet || null,
    sourceRow: Number.isFinite(Number(row)) ? Number(row) : null,
  };
}

function primaryCandidateFor(contactId, existingPeopleByContact, insertedByContact) {
  const existing = existingPeopleByContact.get(contactId) || [];
  if (existing.some((person) => person.is_primary)) return false;
  return !insertedByContact.has(contactId);
}

function buildPlan(compared, existingPeopleByContact) {
  const inserts = [];
  const skippedExisting = [];
  const insertedByContact = new Set();
  const safeCandidates = compared.filter((candidate) => candidate.action === 'safe_reuse_existing_contact');

  for (const candidate of safeCandidates) {
    const contact = candidate.currentMatches[0];
    if (!contact) continue;
    const existingNames = new Set((existingPeopleByContact.get(contact.id) || []).map((person) => normalizeName(person.name)));
    for (const person of candidate.plannedPeople) {
      const normalizedPerson = normalizeName(person.name);
      if (existingNames.has(normalizedPerson)) {
        skippedExisting.push({
          contactId: contact.id,
          contactName: contact.name,
          personName: person.name,
          reason: 'Existing linked person with same normalized name.',
        });
        continue;
      }
      const { sourceSheet, sourceRow } = splitSourceRow(person.sourceRows[0]);
      const isPrimary = primaryCandidateFor(contact.id, existingPeopleByContact, insertedByContact);
      inserts.push({
        contactId: contact.id,
        contactName: contact.name,
        businessUnitId: null,
        name: person.name,
        phone: person.phoneHints[0] || null,
        email: null,
        notes: null,
        isPrimary,
        sourceLabel: SOURCE_LABEL,
        sourceSheet,
        sourceRow,
        metadataJson: {
          issue: 'MIS-146',
          candidateClientName: candidate.clientName,
          evidenceCount: person.evidenceCount,
          sourceRows: person.sourceRows,
          phoneHints: person.phoneHints,
          classification: candidate.action,
        },
      });
      insertedByContact.add(contact.id);
    }
  }

  return { safeCandidates, inserts, skippedExisting };
}

async function loadBusinessUnit(client, businessUnit) {
  const result = await client.query(
    `
      select id, organization_id, name
      from business_units
      where name = $1
      limit 1
    `,
    [businessUnit],
  );
  if (!result.rows[0]) throw new Error(`Missing business unit: ${businessUnit}`);
  return result.rows[0];
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
  if (!options.confirmStaging) {
    throw new Error('Refusing to apply without --confirm-staging.');
  }
  if (fingerprint?.expectedNeonBranchId !== EXPECTED_STAGING_BRANCH_ID) {
    throw new Error(`Refusing to apply: expected staging branch ${EXPECTED_STAGING_BRANCH_ID}, received ${fingerprint?.expectedNeonBranchId || 'unknown'}.`);
  }
}

async function applyPlan(client, businessUnit, inserts, apply) {
  if (!apply || !inserts.length) return [];
  const applied = [];
  await client.query('begin');
  try {
    for (const item of inserts) {
      const result = await client.query(
        `
          insert into contact_people (
            organization_id,
            business_unit_id,
            contact_id,
            name,
            role,
            phone,
            email,
            notes,
            is_primary,
            source_label,
            source_sheet,
            source_row,
            metadata_json
          )
          values ($1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
          returning id, contact_id, name, is_primary
        `,
        [
          businessUnit.organization_id,
          businessUnit.id,
          item.contactId,
          item.name,
          item.phone,
          item.email,
          item.notes,
          item.isPrimary,
          item.sourceLabel,
          item.sourceSheet,
          item.sourceRow,
          JSON.stringify(item.metadataJson),
        ],
      );
      applied.push(result.rows[0]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return applied;
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-146 AIT Signs Exact Linked People Backfill',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Workbook: ${report.workbook.path}`,
    `- Workbook hash: ${report.workbook.hash}`,
    `- Business unit: ${report.businessUnit}`,
    `- Target base URL: ${report.safeFingerprint?.targetBaseUrl || 'unknown'}`,
    `- Neon branch id: ${report.safeFingerprint?.expectedNeonBranchId || 'unknown'}`,
    `- Current database: ${report.safeFingerprint?.currentDatabase || 'unknown'}`,
    '',
    '## Summary',
    '',
    `- Exact-match client candidates reviewed: ${report.summary.safeExactCandidates}`,
    `- Planned linked people inserts: ${report.summary.plannedInserts}`,
    `- Applied linked people inserts: ${report.summary.appliedInserts}`,
    `- Existing linked people skipped: ${report.summary.skippedExisting}`,
    `- Distinct contacts affected: ${report.summary.distinctContactsAffected}`,
    `- Primary person rows inserted: ${report.summary.primaryRows}`,
    '',
    '## Guardrails',
    '',
    `- Apply required --apply --confirm-staging: ${report.mode === 'apply' ? 'yes' : 'not used in dry-run mode'}`,
    '- Only safe_reuse_existing_contact candidates from MIS-145 were eligible.',
    '- Phone-only remaps, ambiguous candidates, new clients, archive/delete, and consolidation were not applied.',
    '- Existing linked people with the same normalized name were skipped.',
    '',
    '## Samples',
    '',
  ];

  if (!report.samples.appliedOrPlanned.length) {
    lines.push('- No linked people were planned.');
  } else {
    for (const item of report.samples.appliedOrPlanned) {
      lines.push(`- ${item.contactName}: ${item.name}${item.phone ? ` (${item.phone})` : ''}; primary=${item.isPrimary}; ${item.sourceSheet || 'unknown'}#${item.sourceRow || 'unknown'}`);
    }
  }

  lines.push('', '## Rollback Note', '');
  lines.push(`- Rows inserted by this script are tagged with source_label=${SOURCE_LABEL}.`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  const workbookPath = resolveWorkbook(options.workbook);
  const artifact = loadWorkbookArtifact(workbookPath);
  const { groups } = buildWorkbookCandidates(artifact);

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const businessUnit = await loadBusinessUnit(client, options.businessUnit);
  const fingerprint = await stagingRuntimeFingerprint(client);
  assertStagingApplyAllowed(options, fingerprint);
  const contacts = await loadCurrentContacts(client, options.businessUnit);
  const existingPeopleByContact = await loadExistingPeople(client, contacts);
  const comparison = compareCandidatesToContacts(groups, contacts, existingPeopleByContact);
  const plan = buildPlan(comparison.compared, existingPeopleByContact);
  const applied = await applyPlan(client, businessUnit, plan.inserts, options.apply);
  await client.end();

  const affectedContactIds = new Set(plan.inserts.map((item) => item.contactId));
  const report = {
    generatedAt: new Date().toISOString(),
    issue: 'MIS-146',
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: options.businessUnit,
    safeFingerprint: fingerprint,
    workbook: {
      path: workbookPath,
      hash: artifact.workbookFileHash,
    },
    summary: {
      safeExactCandidates: plan.safeCandidates.length,
      plannedInserts: plan.inserts.length,
      appliedInserts: applied.length,
      skippedExisting: plan.skippedExisting.length,
      distinctContactsAffected: affectedContactIds.size,
      primaryRows: plan.inserts.filter((item) => item.isPrimary).length,
    },
    samples: {
      appliedOrPlanned: plan.inserts.slice(0, options.sampleLimit),
      skippedExisting: plan.skippedExisting.slice(0, options.sampleLimit),
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
