#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const DEFAULT_ARTIFACT = 'docs/ait-usa-import-staging.json';
const TARGET_BUSINESS_UNIT = 'AIT USA Institute';

function parseArgs(argv) {
  const options = {
    artifactPath: DEFAULT_ARTIFACT,
    sampleLimit: 10,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--artifact') {
      options.artifactPath = argv[i + 1];
      i += 1;
    } else if (arg === '--sample-limit') {
      options.sampleLimit = Number(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function clean(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function phoneTail(value) {
  const digits = normalizePhone(value);
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function parseLeadNoteFields(value = '') {
  const fields = {};
  for (const part of clean(value).split('|')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = clean(part.slice(0, separatorIndex));
    const rawValue = clean(part.slice(separatorIndex + 1));
    if (!key || !rawValue || rawValue === 'none' || rawValue === 'unknown') continue;
    fields[key] = rawValue;
  }
  return fields;
}

function increment(map, key) {
  const value = key || 'unknown';
  map.set(value, (map.get(value) || 0) + 1);
}

function sortedCounts(map) {
  return Object.fromEntries([...map.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return String(left[0]).localeCompare(String(right[0]));
  }));
}

function byKey(records, key) {
  const index = new Map();
  for (const record of records) {
    const value = record[key];
    if (!value) continue;
    const list = index.get(value) || [];
    list.push(record);
    index.set(value, list);
  }
  return index;
}

function artifactLeadRecord(record) {
  const lead = record.proposedLeadJson || {};
  const metadata = lead.leadMetadata || {};
  const contactability = metadata.contactability || {};
  return {
    sourceSheet: record.sourceSheet,
    sourceRowNumber: record.sourceRowNumber,
    sourceRowKey: `${record.sourceSheet}::${record.sourceRowNumber}`,
    name: clean(lead.contactHint),
    normalizedName: normalizeText(lead.contactHint),
    phone: normalizePhone(lead.phoneHint || lead.originalPhoneHint),
    phoneTail: phoneTail(lead.phoneHint || lead.originalPhoneHint),
    email: normalizeEmail(lead.emailHint),
    location: normalizeText(lead.locationHint),
    contactabilityStatus: clean(contactability.status),
    qualityDisposition: clean(metadata.qualityDisposition),
    noAnswerAttemptCount: Number(metadata.noAnswerAttemptCount || 0),
    sourceTags: metadata.sourceTags || [],
    sourceLabel: clean(lead.sourceLabel),
  };
}

function crmLeadRecord(row) {
  const fields = parseLeadNoteFields(row.original_notes);
  return {
    contactId: row.contact_id,
    leadId: row.lead_id,
    name: clean(row.name),
    normalizedName: normalizeText(row.name),
    phone: normalizePhone(row.phone),
    phoneTail: phoneTail(row.phone),
    email: normalizeEmail(row.email),
    location: normalizeText(row.address || fields.address),
    sourceRowId: clean(fields.source_row_id),
    sourceKey: clean(fields.source_key),
    sourceName: clean(row.source_name),
    sourceType: clean(row.source_type),
  };
}

function uniqueMatchCount(crmRecords, xlsxIndex, crmKey) {
  let exact = 0;
  let ambiguous = 0;
  const examples = [];
  const exactContactIds = new Set();
  for (const crm of crmRecords) {
    const key = crm[crmKey];
    if (!key) continue;
    const matches = xlsxIndex.get(key) || [];
    if (matches.length === 1) {
      exact += 1;
      exactContactIds.add(crm.contactId);
      if (examples.length < 5) {
        examples.push({
          crmContactId: crm.contactId,
          crmLeadId: crm.leadId,
          xlsxSourceRow: matches[0].sourceRowKey,
          contactabilityStatus: matches[0].contactabilityStatus,
          qualityDisposition: matches[0].qualityDisposition,
        });
      }
    } else if (matches.length > 1) {
      ambiguous += 1;
    }
  }
  return { exact, ambiguous, exactContactIds: [...exactContactIds], examples };
}

function publicMatchResult(result) {
  const { exactContactIds, ...publicResult } = result;
  return publicResult;
}

async function fetchCrmRecords() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the read-only reconciliation report');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const contacts = await client.query(
      `
        select
          c.id as contact_id,
          l.id as lead_id,
          c.name,
          c.phone,
          c.email,
          c.address,
          l.source_type,
          l.source_name,
          l.original_notes
        from contacts c
        join leads l on l.contact_id = c.id
        join business_units bu on bu.id = l.business_unit_id
        where bu.name = $1
        order by c.created_at, c.id
      `,
      [TARGET_BUSINESS_UNIT],
    );

    const sourceRowIds = contacts.rows
      .map((row) => parseLeadNoteFields(row.original_notes).source_row_id)
      .filter(Boolean);

    let sourceMetadata = {
      sourceRows: 0,
      normalizedRows: 0,
      normalizedWithQuality: 0,
      normalizedWithContactability: 0,
      sourceTypes: {},
    };

    if (sourceRowIds.length) {
      const sourceResult = await client.query(
        `
          select
            count(distinct sr.id)::int as source_rows,
            count(nr.id)::int as normalized_rows,
            count(nr.id) filter (
              where nr.proposed_lead_json->'leadMetadata' ? 'qualityDisposition'
            )::int as normalized_with_quality,
            count(nr.id) filter (
              where nr.proposed_lead_json->'leadMetadata'->'contactability' ? 'status'
            )::int as normalized_with_contactability
          from import_source_rows sr
          left join import_normalized_records nr on nr.source_row_id = sr.id
          where sr.id = any($1::uuid[])
        `,
        [sourceRowIds],
      );
      const sourceTypes = await client.query(
        `
          select ib.source_type, ib.source_name, count(distinct sr.id)::int as source_rows
          from import_source_rows sr
          join import_batches ib on ib.id = sr.import_batch_id
          where sr.id = any($1::uuid[])
          group by ib.source_type, ib.source_name
          order by source_rows desc
        `,
        [sourceRowIds],
      );
      sourceMetadata = {
        ...sourceMetadata,
        ...sourceResult.rows[0],
        sourceTypes: sourceTypes.rows,
      };
    }

    return {
      contacts: contacts.rows.map(crmLeadRecord),
      sourceMetadata,
    };
  } finally {
    await client.end();
  }
}

function analyze(payload, crmRecords, sourceMetadata, sampleLimit) {
  const xlsxLeads = payload.normalizedRecords
    .filter((record) => record.recordType === 'lead')
    .map(artifactLeadRecord);

  const contactabilityCounts = new Map();
  const dispositionCounts = new Map();
  const sourceLabelCounts = new Map();
  for (const lead of xlsxLeads) {
    increment(contactabilityCounts, lead.contactabilityStatus);
    increment(dispositionCounts, lead.qualityDisposition);
    increment(sourceLabelCounts, lead.sourceLabel);
  }

  const crmCounts = {
    contacts: crmRecords.length,
    withPhone: crmRecords.filter((record) => record.phone).length,
    withPhoneTail: crmRecords.filter((record) => record.phoneTail).length,
    withEmail: crmRecords.filter((record) => record.email).length,
    withSourceRowId: crmRecords.filter((record) => record.sourceRowId).length,
    withNormalizedName: crmRecords.filter((record) => record.normalizedName).length,
  };

  const xlsxCounts = {
    sourceRows: payload.sourceRows.length,
    normalizedRecords: payload.normalizedRecords.length,
    leadRecords: xlsxLeads.length,
    activityEventRecords: payload.normalizedRecords.filter((record) => record.recordType === 'activity_event').length,
    reviewItems: payload.reviewItems.length,
    withPhone: xlsxLeads.filter((record) => record.phone).length,
    withPhoneTail: xlsxLeads.filter((record) => record.phoneTail).length,
    withEmail: xlsxLeads.filter((record) => record.email).length,
    withNormalizedName: xlsxLeads.filter((record) => record.normalizedName).length,
    withContactability: xlsxLeads.filter((record) => record.contactabilityStatus).length,
    withQualityDisposition: xlsxLeads.filter((record) => record.qualityDisposition).length,
  };

  const phone = uniqueMatchCount(crmRecords, byKey(xlsxLeads, 'phone'), 'phone');
  const phoneTailResult = uniqueMatchCount(crmRecords, byKey(xlsxLeads, 'phoneTail'), 'phoneTail');
  const email = uniqueMatchCount(crmRecords, byKey(xlsxLeads, 'email'), 'email');
  const name = uniqueMatchCount(crmRecords, byKey(xlsxLeads, 'normalizedName'), 'normalizedName');
  const nameLocation = uniqueMatchCount(
    crmRecords.map((record) => ({
      ...record,
      nameLocation: record.normalizedName && record.location ? `${record.normalizedName}::${record.location}` : '',
    })),
    byKey(
      xlsxLeads.map((record) => ({
        ...record,
        nameLocation: record.normalizedName && record.location ? `${record.normalizedName}::${record.location}` : '',
      })),
      'nameLocation',
    ),
    'nameLocation',
  );

  const exactCandidateIds = new Set([
    ...phone.exactContactIds,
    ...phoneTailResult.exactContactIds,
    ...email.exactContactIds,
    ...nameLocation.exactContactIds,
  ]);

  const candidateSamples = [
    ...phone.examples.map((example) => ({ matchType: 'phone_exact', ...example })),
    ...phoneTailResult.examples.map((example) => ({ matchType: 'phone_last10', ...example })),
    ...email.examples.map((example) => ({ matchType: 'email_exact', ...example })),
    ...nameLocation.examples.map((example) => ({ matchType: 'name_location', ...example })),
  ].slice(0, sampleLimit);

  return {
    artifact: {
      workbookPath: payload.workbookPath,
      workbookFileHash: payload.workbookFileHash,
      sourceName: payload.sourceName,
      sourceType: payload.sourceType,
      businessUnit: payload.businessUnit,
    },
    crm: {
      counts: crmCounts,
      linkedSourceRows: sourceMetadata,
    },
    xlsx: {
      counts: xlsxCounts,
      contactabilityCounts: sortedCounts(contactabilityCounts),
      qualityDispositionCounts: sortedCounts(dispositionCounts),
      sourceLabelCounts: sortedCounts(sourceLabelCounts),
    },
    matching: {
      safeExactCandidateContacts: exactCandidateIds.size,
      phoneExact: publicMatchResult(phone),
      phoneLast10: publicMatchResult(phoneTailResult),
      emailExact: publicMatchResult(email),
      nameLocation: publicMatchResult(nameLocation),
      nameOnly: publicMatchResult(name),
    },
    candidateSamples,
    recommendation: {
      safeExactMatchBackfillCandidates: exactCandidateIds.size,
      safeToBlanketBackfillAllCrmContacts: false,
      summary: 'Exact phone/email matches are candidates for a narrowly scoped review/backfill. Do not blanket-attach XLSX contactability metadata to all current CRM contacts. Name-only matches are review candidates, not safe identity links.',
    },
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const resolved = path.resolve(options.artifactPath);
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const { contacts, sourceMetadata } = await fetchCrmRecords();
  const report = analyze(payload, contacts, sourceMetadata, options.sampleLimit);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
