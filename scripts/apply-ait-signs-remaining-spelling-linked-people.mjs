#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { normalizeName, safeDbFingerprint } from './dry-run-ait-signs-canonical-replacement-plan.mjs';

const DEFAULT_INPUT = 'docs/mis-150-ait-signs-remaining-spelling-approval.json';
const DEFAULT_OUTPUT = 'docs/mis-150-ait-signs-remaining-spelling-linked-people-apply.json';
const DEFAULT_MARKDOWN = 'docs/mis-150-ait-signs-remaining-spelling-linked-people-apply.md';
const ISSUE = 'MIS-150';
const SOURCE_LABEL = 'ait_signs_remaining_spelling_latest_source_linked_people';
const EXPECTED_STAGING_BRANCH_ID = 'br-broad-hill-aptjpyea';

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    markdown: DEFAULT_MARKDOWN,
    businessUnit: 'AIT Signs',
    apply: false,
    confirmStaging: false,
    sampleLimit: 50,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      options.input = argv[index + 1];
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

function personEntries(value) {
  return String(value || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*) x(\d+)$/);
      return {
        name: match ? match[1].trim() : entry,
        evidenceCount: match ? Number(match[2]) : 1,
      };
    });
}

function splitSourceReference(value) {
  const match = String(value || '').match(/^([^:]+):\s+(.+)\s+from\s+(.+)#(\d+)$/);
  if (!match) return null;
  return {
    phone: match[1].trim(),
    name: match[2].trim(),
    sourceSheet: match[3].trim(),
    sourceRow: Number(match[4]),
    sourceRef: `${match[3].trim()}#${match[4]}`,
  };
}

function latestReferences(value) {
  return String(value || '')
    .split(';')
    .map((entry) => splitSourceReference(entry.trim()))
    .filter(Boolean);
}

function sheetPriority(sheetName) {
  const normalized = String(sheetName || '').toUpperCase();
  if (normalized.includes('WORK ORDER TERMINADOS Y PAGADOS')) return 30;
  if (normalized.includes('SIGNS WORK ORDER')) return 20;
  if (normalized.includes('ESTIMADOS')) return 10;
  return 0;
}

function sourcePosition(ref) {
  return (sheetPriority(ref.sourceSheet) * 100000) + (Number.isFinite(ref.sourceRow) ? ref.sourceRow : 0);
}

function latestReferenceForPerson(row, personName) {
  const normalized = normalizeName(personName);
  const refs = latestReferences(row.latestSourceReference)
    .filter((ref) => normalizeName(ref.name) === normalized)
    .sort((left, right) => sourcePosition(right) - sourcePosition(left));
  return refs[0] || null;
}

function phonesForPerson(row, personName) {
  const normalized = normalizeName(personName);
  const refs = latestReferences(row.latestSourceReference)
    .filter((ref) => normalizeName(ref.name) === normalized)
    .map((ref) => ref.phone);
  if (refs.length) return [...new Set(refs)];
  return String(row.phoneHints || '').split(';').map((phone) => phone.trim()).filter(Boolean);
}

function buildApprovedPeople(packet) {
  const byContactAndPerson = new Map();
  for (const row of packet.approvalRows || []) {
    if (row.defaultRecommendation !== 'approve_latest_source_linked_people') continue;
    for (const person of personEntries(row.potentialLinkedPeopleToInsert)) {
      const key = `${row.canonicalClient}::${normalizeName(person.name)}`;
      const ref = latestReferenceForPerson(row, person.name);
      const phones = phonesForPerson(row, person.name);
      const existing = byContactAndPerson.get(key);
      const next = {
        canonicalClient: row.canonicalClient,
        name: person.name,
        evidenceCount: person.evidenceCount,
        phone: phones[0] || ref?.phone || null,
        phoneHints: phones,
        sourceSheet: ref?.sourceSheet || null,
        sourceRow: ref?.sourceRow || null,
        sourceRef: ref?.sourceRef || null,
        latestSourceReference: row.latestSourceReference,
        candidateClientNames: [row.candidateClientName],
        businessMatchReason: row.businessMatchReason,
        sourceRows: String(row.sourceRows || '').split(';').map((sourceRow) => sourceRow.trim()).filter(Boolean),
      };
      if (existing) {
        existing.evidenceCount += next.evidenceCount;
        existing.phoneHints = [...new Set([...existing.phoneHints, ...next.phoneHints])];
        existing.candidateClientNames = [...new Set([...existing.candidateClientNames, ...next.candidateClientNames])];
        existing.sourceRows = [...new Set([...existing.sourceRows, ...next.sourceRows])];
        if (ref && (!existing.sourceRef || sourcePosition(ref) > sourcePosition(existing))) {
          existing.phone = next.phone;
          existing.sourceSheet = next.sourceSheet;
          existing.sourceRow = next.sourceRow;
          existing.sourceRef = next.sourceRef;
          existing.latestSourceReference = next.latestSourceReference;
        }
      } else {
        byContactAndPerson.set(key, next);
      }
    }
  }
  return [...byContactAndPerson.values()];
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

async function loadBusinessUnit(client, businessUnitName) {
  const result = await client.query(
    `
      select id, organization_id, name
      from business_units
      where name = $1
      limit 1
    `,
    [businessUnitName],
  );
  if (!result.rows[0]) throw new Error(`Missing business unit: ${businessUnitName}`);
  return result.rows[0];
}

async function loadContacts(client, businessUnitId, names) {
  if (!names.length) return new Map();
  const result = await client.query(
    `
      select id, name
      from contacts
      where primary_business_unit_id = $1
        and name = any($2::text[])
      order by name, id
    `,
    [businessUnitId, names],
  );
  const byName = new Map();
  for (const row of result.rows) {
    if (!byName.has(row.name)) byName.set(row.name, []);
    byName.get(row.name).push(row);
  }
  return byName;
}

async function loadExistingPeople(client, contactIds) {
  if (!contactIds.length) return new Map();
  const result = await client.query(
    `
      select id, contact_id, name, is_primary, source_label
      from contact_people
      where contact_id = any($1::uuid[])
      order by contact_id, name, id
    `,
    [contactIds],
  );
  const byContact = new Map();
  for (const row of result.rows) {
    if (!byContact.has(row.contact_id)) byContact.set(row.contact_id, []);
    byContact.get(row.contact_id).push(row);
  }
  return byContact;
}

function buildPlan(approvedPeople, contactsByName, existingPeopleByContact, businessUnit) {
  const plannedInserts = [];
  const skipped = [];
  const blocked = [];

  for (const person of approvedPeople) {
    const contacts = contactsByName.get(person.canonicalClient) || [];
    if (contacts.length !== 1) {
      blocked.push({
        canonicalClient: person.canonicalClient,
        name: person.name,
        reason: contacts.length ? 'Multiple matching canonical contacts.' : 'Missing canonical contact.',
      });
      continue;
    }

    const contact = contacts[0];
    const existingPeople = existingPeopleByContact.get(contact.id) || [];
    const normalizedName = normalizeName(person.name);
    const existingMatch = existingPeople.find((existing) => normalizeName(existing.name) === normalizedName);
    if (existingMatch) {
      skipped.push({
        contactId: contact.id,
        contactName: contact.name,
        name: person.name,
        reason: 'Existing linked person with same normalized name.',
        existingSourceLabel: existingMatch.source_label,
      });
      continue;
    }

    plannedInserts.push({
      organizationId: businessUnit.organization_id,
      businessUnitId: businessUnit.id,
      contactId: contact.id,
      contactName: contact.name,
      name: person.name,
      phone: person.phone,
      email: null,
      notes: null,
      isPrimary: false,
      sourceLabel: SOURCE_LABEL,
      sourceSheet: person.sourceSheet,
      sourceRow: person.sourceRow,
      metadataJson: {
        issue: ISSUE,
        sourcePacket: DEFAULT_INPUT,
        canonicalClient: person.canonicalClient,
        candidateClientNames: person.candidateClientNames,
        evidenceCount: person.evidenceCount,
        latestSourceReference: person.latestSourceReference,
        sourceRows: person.sourceRows,
        phoneHints: person.phoneHints,
        businessMatchReason: person.businessMatchReason,
        rule: 'remaining_spelling_latest_source_reference_strong_business_match',
      },
    });
  }

  return { plannedInserts, skipped, blocked };
}

async function applyPlan(client, inserts, apply) {
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
          item.organizationId,
          item.businessUnitId,
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
    '# MIS-150 AIT Signs Remaining Spelling Linked People Apply',
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
    `- Approved unique people from packet: ${report.summary.approvedUniquePeople}`,
    `- Planned linked people inserts: ${report.summary.plannedInserts}`,
    `- Applied linked people inserts: ${report.summary.appliedInserts}`,
    `- Skipped existing linked people: ${report.summary.skippedExisting}`,
    `- Blocked rows: ${report.summary.blocked}`,
    `- Distinct contacts affected: ${report.summary.distinctContactsAffected}`,
    '',
    '## Guardrails',
    '',
    '- Inserts linked people only from MIS-150 strong spelling/suffix match recommendations.',
    '- De-dupes by contact plus normalized person name before applying.',
    '- Uses latest work-item/contact-point source evidence as temporary person-name truth.',
    '- Does not rename, merge, remap, create, archive, delete, consolidate, or add aliases to contacts.',
    '- Does not set inserted linked people as primary.',
    `- Inserted rows are tagged with source_label=${SOURCE_LABEL}.`,
    '',
    '## Planned Inserts',
    '',
  ];

  for (const item of report.samples.plannedInserts) {
    lines.push(`- ${item.contactName}: ${item.name} (${item.phone || 'no phone'}) from ${item.sourceSheet || 'unknown'}#${item.sourceRow || 'unknown'}`);
  }
  if (!report.samples.plannedInserts.length) lines.push('- none');

  if (report.samples.skipped.length) {
    lines.push('', '## Skipped Existing', '');
    for (const item of report.samples.skipped) lines.push(`- ${item.contactName}: ${item.name}; ${item.reason}`);
  }

  if (report.samples.blocked.length) {
    lines.push('', '## Blocked', '');
    for (const item of report.samples.blocked) lines.push(`- ${item.canonicalClient}: ${item.name}; ${item.reason}`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const packet = JSON.parse(await readFile(options.input, 'utf8'));
  const approvedPeople = buildApprovedPeople(packet);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const businessUnit = await loadBusinessUnit(client, options.businessUnit);
  const fingerprint = await stagingRuntimeFingerprint(client);
  assertStagingApplyAllowed(options, fingerprint);
  const contactsByName = await loadContacts(client, businessUnit.id, [...new Set(approvedPeople.map((person) => person.canonicalClient))]);
  const contactIds = [...contactsByName.values()].flat().map((contact) => contact.id);
  const existingPeopleByContact = await loadExistingPeople(client, contactIds);
  const plan = buildPlan(approvedPeople, contactsByName, existingPeopleByContact, businessUnit);
  const applied = await applyPlan(client, plan.plannedInserts, options.apply);
  await client.end();

  const report = {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: options.businessUnit,
    sourceLabel: SOURCE_LABEL,
    safeFingerprint: fingerprint,
    summary: {
      approvedUniquePeople: approvedPeople.length,
      plannedInserts: plan.plannedInserts.length,
      appliedInserts: applied.length,
      skippedExisting: plan.skipped.length,
      blocked: plan.blocked.length,
      distinctContactsAffected: new Set(plan.plannedInserts.map((item) => item.contactId)).size,
    },
    samples: {
      plannedInserts: plan.plannedInserts.slice(0, options.sampleLimit),
      skipped: plan.skipped.slice(0, options.sampleLimit),
      blocked: plan.blocked.slice(0, options.sampleLimit),
      applied: applied.slice(0, options.sampleLimit),
    },
    approvedPeople,
    plannedInserts: plan.plannedInserts,
    skipped: plan.skipped,
    blocked: plan.blocked,
    applied,
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
