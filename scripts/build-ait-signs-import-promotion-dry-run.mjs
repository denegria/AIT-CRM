#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import {
  cleanText,
  contactIdentityFromProposal,
  normalizeIdentityKey,
} from './promote-ait-signs-staging.mjs';

const ISSUE = 'MIS-157';
const BUSINESS_UNIT = 'AIT Signs';
const DEFAULT_OUTPUT_JSON = 'docs/mis-157-ait-signs-import-promotion-dry-run.json';
const DEFAULT_OUTPUT_CSV = 'docs/mis-157-ait-signs-import-promotion-dry-run.csv';
const DEFAULT_OUTPUT_MD = 'docs/mis-157-ait-signs-import-promotion-dry-run.md';

function parseArgs(argv) {
  const options = {
    outputJson: DEFAULT_OUTPUT_JSON,
    outputCsv: DEFAULT_OUTPUT_CSV,
    outputMarkdown: DEFAULT_OUTPUT_MD,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-json') {
      options.outputJson = argv[index + 1];
      index += 1;
    } else if (arg === '--output-csv') {
      options.outputCsv = argv[index + 1];
      index += 1;
    } else if (arg === '--output-md') {
      options.outputMarkdown = argv[index + 1];
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
    const url = secrets.aitCrm?.staging?.databaseUrl ? new URL(secrets.aitCrm.staging.databaseUrl) : null;
    return {
      expectedNeonBranchId: 'br-broad-hill-aptjpyea',
      targetBaseUrl: secrets.aitCrm?.staging?.baseUrl || null,
      hostSuffix: url ? url.hostname.split('.').slice(0, 2).join('.') : null,
    };
  } catch {
    return {
      expectedNeonBranchId: 'br-broad-hill-aptjpyea',
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

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? 'null';
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function proposalFor(row) {
  return row.proposed_lead_json
    || row.proposed_estimate_json
    || row.proposed_work_order_json
    || row.proposed_payment_json
    || row.proposed_note_json
    || {};
}

function rowKey(sheet, row) {
  return `${sheet || ''}::${row || ''}`;
}

function eventTypeFor(recordType) {
  return `import_promoted_${recordType}`;
}

function workOrderNumberFor(record) {
  const sourceRow = Number(record.source_row_number || 0) || null;
  if (!sourceRow) return null;
  const sheet = String(record.source_sheet || '').toLowerCase();
  if (sheet.includes('termin') || sheet.includes('pagad')) return `AIT-WO-ARCH-${sourceRow}`;
  if (sheet.includes('15 signs')) return `AIT-WO-ACT-${sourceRow}`;
  return `AIT-WO-${sourceRow}`;
}

function estimateNumberFor(record) {
  const sourceRow = Number(record.source_row_number || 0) || null;
  return sourceRow ? `AIT-EST-${sourceRow}` : null;
}

function entityKeyFor(record) {
  if (record.record_type === 'work_order') return workOrderNumberFor(record);
  if (record.record_type === 'estimate') return estimateNumberFor(record);
  if (record.record_type === 'payment_snapshot') return rowKey(record.source_sheet, record.source_row_number);
  return null;
}

function prepareContactIndexes(contacts) {
  const byPhone = new Map();
  const byEmail = new Map();
  const byCompanyKey = new Map();
  const sorted = [...contacts].sort((a, b) => {
    const aPhone = a.phone ? 0 : 1;
    const bPhone = b.phone ? 0 : 1;
    if (aPhone !== bPhone) return aPhone - bPhone;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  for (const contact of sorted) {
    if (contact.phone && !byPhone.has(contact.phone)) byPhone.set(contact.phone, contact);
    const email = cleanText(contact.email).toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, contact);
    for (const name of [contact.company_name, contact.name]) {
      const key = normalizeIdentityKey(name);
      if (key.length >= 4 && !byCompanyKey.has(key)) byCompanyKey.set(key, contact);
    }
  }

  return { byPhone, byEmail, byCompanyKey };
}

function contactMatch(identity, indexes) {
  if (identity.phone && indexes.byPhone.has(identity.phone)) {
    return { matchType: 'phone', contact: indexes.byPhone.get(identity.phone) };
  }

  const email = cleanText(identity.email).toLowerCase();
  if (email && indexes.byEmail.has(email)) {
    return { matchType: 'email', contact: indexes.byEmail.get(email) };
  }

  const companyKey = normalizeIdentityKey(identity.companyName);
  if (companyKey.length >= 4 && indexes.byCompanyKey.has(companyKey)) {
    return { matchType: 'company_key', contact: indexes.byCompanyKey.get(companyKey) };
  }

  return { matchType: 'new_contact_if_imported', contact: null };
}

function promotionSafety({ record, exactEventCount, anyEventCount, existingEntityCount }) {
  if (exactEventCount > 0 || existingEntityCount > 0) return 'already_promoted_do_not_import';
  if (record.record_type === 'note' && anyEventCount > 0) return 'parent_promoted_note_needs_manual_attach_review';
  return 'not_found_requires_human_review';
}

function recommendationFor(safety) {
  if (safety === 'already_promoted_do_not_import') {
    return 'do_not_import_mark_or_archive_queue_after_approval';
  }
  if (safety === 'parent_promoted_note_needs_manual_attach_review') {
    return 'review_note_attachment_before_any_write';
  }
  return 'block_until_source_and_duplicate_review';
}

function renderCsv(rows) {
  const headers = [
    'issue',
    'promotionSafety',
    'recommendation',
    'sourceSheet',
    'sourceRowNumber',
    'recordType',
    'importStatus',
    'existingExactPromotionEvents',
    'existingAnyPromotionEvents',
    'existingPromotionEventTypes',
    'existingEntityCount',
    'entityKey',
    'contactMatchType',
    'contactId',
    'customerName',
    'contactName',
    'phone',
    'statusHint',
    'moneyHint',
    'paymentHint',
    'workDescription',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-157 AIT Signs Import Promotion Dry Run',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Staging branch id: ${report.safeFingerprint.expectedNeonBranchId}`,
    `- Current database: ${report.safeFingerprint.currentDatabase}`,
    `- Host suffix: ${report.safeFingerprint.hostSuffix || 'unknown'}`,
    `- Target base URL: ${report.safeFingerprint.targetBaseUrl || 'unknown'}`,
    '',
    '## Verdict',
    '',
    '- No DB writes were made.',
    '- Do not bulk approve/import the pending AIT Signs Import Review queue as-is.',
    `- ${report.summary.byPromotionSafety.already_promoted_do_not_import || 0} normalized rows already have matching promoted CRM evidence.`,
    `- ${report.summary.byPromotionSafety.parent_promoted_note_needs_manual_attach_review || 0} note rows have promoted parent rows but no matching promoted-note event.`,
    `- ${report.summary.byPromotionSafety.not_found_requires_human_review || 0} normalized rows were not matched to promoted evidence.`,
    '- Current Import Review status is misleading: the normalized rows are still pending even though the CRM promotion evidence already exists for almost all rows.',
    '- Import Review approval for this XLSX batch only marks staging/review statuses; it does not promote AIT Signs CRM records through the UI/API.',
    '',
    '## Current Pending Queue',
    '',
    ...Object.entries(report.summary.byRecordType).map(([type, count]) => `- ${type}: ${count}`),
    '',
    '## Current Staging Statuses',
    '',
    ...Object.entries(report.summary.importStatusCounts).map(([status, count]) => `- normalized ${status}: ${count}`),
    ...Object.entries(report.summary.reviewStatusCounts).map(([status, count]) => `- review ${status}: ${count}`),
    '',
    '## Promotion Evidence',
    '',
    ...Object.entries(report.summary.byPromotionSafety).map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## Recommendation',
    '',
    '- Treat the queue as a stale/unfinalized staging review queue, not fresh data waiting to import.',
    '- Next write should be a narrow metadata/status cleanup plan after approval, not a CRM object import.',
    '- Review the 19 unmatched note rows before deciding whether to attach them as notes or leave them held/context-only.',
    '- Do not use the existing bulk promotion script for these pending rows unless idempotence guards are added first.',
    '- Add/import idempotence guards before any future bulk promotion path is trusted.',
    '',
    '## Artifacts',
    '',
    `- CSV: ${report.artifacts.csv}`,
    `- JSON: ${report.artifacts.json}`,
  ];

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const safeFingerprint = await runtimeFingerprint(client);

  const businessUnit = await client.query(
    'select id, organization_id from business_units where name = $1 limit 1',
    [BUSINESS_UNIT],
  );
  if (!businessUnit.rows[0]) throw new Error(`Business unit not found: ${BUSINESS_UNIT}`);
  const businessUnitId = businessUnit.rows[0].id;
  const organizationId = businessUnit.rows[0].organization_id;

  const batchResult = await client.query(
    `
      select id, source_name, source_type, file_name, status, created_at
      from import_batches
      where business_unit_id = $1
      order by created_at desc
      limit 1
    `,
    [businessUnitId],
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new Error('No AIT Signs import batch found');

  const normalizedResult = await client.query(
    `
        select
          nr.id,
          nr.record_type,
          nr.status as import_status,
          nr.confidence_score,
          sr.source_sheet,
          sr.source_row_number,
          nr.proposed_lead_json,
          nr.proposed_estimate_json,
          nr.proposed_work_order_json,
          nr.proposed_payment_json,
          nr.proposed_note_json
        from import_normalized_records nr
        join import_source_rows sr on sr.id = nr.source_row_id
        where nr.import_batch_id = $1
        order by sr.source_sheet, sr.source_row_number, nr.record_type, nr.id
      `,
    [batch.id],
  );
  const contactsResult = await client.query(
    `
        select id, name, company_name, phone, email, created_at
        from contacts
        where organization_id = $1
          and primary_business_unit_id = $2
      `,
    [organizationId, businessUnitId],
  );
  const eventsResult = await client.query(
    `
        select source_sheet, source_row, event_type, count(*)::int as count
        from activity_events
        where organization_id = $1
          and business_unit_id = $2
          and event_type like 'import_promoted_%'
          and source_sheet is not null
          and source_row is not null
        group by 1, 2, 3
      `,
    [organizationId, businessUnitId],
  );
  const estimatesResult = await client.query(
    `
        select estimate_number, count(*)::int as count
        from estimates
        where organization_id = $1
          and business_unit_id = $2
          and estimate_number is not null
        group by estimate_number
      `,
    [organizationId, businessUnitId],
  );
  const workOrdersResult = await client.query(
    `
        select work_order_number, count(*)::int as count
        from work_orders
        where organization_id = $1
          and business_unit_id = $2
          and work_order_number is not null
        group by work_order_number
      `,
    [organizationId, businessUnitId],
  );
  const paymentsResult = await client.query(
    `
        select source_sheet, source_row, count(*)::int as count
        from payment_snapshots
        where organization_id = $1
          and business_unit_id = $2
          and source_sheet is not null
          and source_row is not null
        group by 1, 2
      `,
    [organizationId, businessUnitId],
  );
  const statusResult = await client.query(
    `
        select status, count(*)::int as count
        from import_normalized_records
        where import_batch_id = $1
        group by status
      `,
    [batch.id],
  );
  const reviewStatusResult = await client.query(
    `
      select review_status, count(*)::int as count
      from import_review_items
      where import_batch_id = $1
      group by review_status
    `,
    [batch.id],
  );

  await client.end();

  const contactIndexes = prepareContactIndexes(contactsResult.rows);
  const eventCounts = new Map();
  const anyEventTypes = new Map();
  for (const event of eventsResult.rows) {
    const key = `${rowKey(event.source_sheet, event.source_row)}::${event.event_type}`;
    eventCounts.set(key, Number(event.count));
    const anyKey = rowKey(event.source_sheet, event.source_row);
    const list = anyEventTypes.get(anyKey) || [];
    list.push({ eventType: event.event_type, count: Number(event.count) });
    anyEventTypes.set(anyKey, list);
  }

  const estimateCounts = new Map(estimatesResult.rows.map((row) => [row.estimate_number, Number(row.count)]));
  const workOrderCounts = new Map(workOrdersResult.rows.map((row) => [row.work_order_number, Number(row.count)]));
  const paymentCounts = new Map(paymentsResult.rows.map((row) => [rowKey(row.source_sheet, row.source_row), Number(row.count)]));

  const rows = normalizedResult.rows.map((record) => {
    const proposal = proposalFor(record);
    const identity = contactIdentityFromProposal(proposal);
    const contact = contactMatch(identity, contactIndexes);
    const exactEventType = eventTypeFor(record.record_type);
    const exactEventCount = eventCounts.get(`${rowKey(record.source_sheet, record.source_row_number)}::${exactEventType}`) || 0;
    const anyEvents = anyEventTypes.get(rowKey(record.source_sheet, record.source_row_number)) || [];
    const anyEventCount = anyEvents.reduce((sum, event) => sum + event.count, 0);
    const entityKey = entityKeyFor(record);
    let existingEntityCount = 0;
    if (record.record_type === 'estimate') existingEntityCount = estimateCounts.get(entityKey) || 0;
    if (record.record_type === 'work_order') existingEntityCount = workOrderCounts.get(entityKey) || 0;
    if (record.record_type === 'payment_snapshot') existingEntityCount = paymentCounts.get(entityKey) || 0;
    if (record.record_type === 'lead' || record.record_type === 'note') existingEntityCount = exactEventCount;
    const safety = promotionSafety({ record, exactEventCount, anyEventCount, existingEntityCount });

    return {
      issue: ISSUE,
      promotionSafety: safety,
      recommendation: recommendationFor(safety),
      sourceSheet: record.source_sheet,
      sourceRowNumber: record.source_row_number,
      recordType: record.record_type,
      importStatus: record.import_status,
      existingExactPromotionEvents: exactEventCount,
      existingAnyPromotionEvents: anyEventCount,
      existingPromotionEventTypes: anyEvents.map((event) => `${event.eventType}:${event.count}`).join('; '),
      existingEntityCount,
      entityKey,
      contactMatchType: contact.matchType,
      contactId: contact.contact?.id || '',
      customerName: proposal.customerName || '',
      contactName: proposal.contactName || identity.personName || '',
      phone: identity.phone || '',
      statusHint: proposal.statusHint || '',
      moneyHint: proposal.moneyHint || '',
      paymentHint: proposal.paymentHint || '',
      workDescription: proposal.workDescription || '',
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    businessUnit: BUSINESS_UNIT,
    safeFingerprint,
    batch,
    summary: {
      normalizedRows: rows.length,
      importStatusCounts: Object.fromEntries(statusResult.rows.map((row) => [row.status, row.count])),
      reviewStatusCounts: Object.fromEntries(reviewStatusResult.rows.map((row) => [row.review_status, row.count])),
      existingContacts: contactsResult.rowCount,
      byRecordType: countBy(rows, 'recordType'),
      byPromotionSafety: countBy(rows, 'promotionSafety'),
      byRecommendation: countBy(rows, 'recommendation'),
      byContactMatchType: countBy(rows, 'contactMatchType'),
    },
    samples: {
      notFound: rows.filter((row) => row.promotionSafety === 'not_found_requires_human_review').slice(0, 25),
      notesNeedingReview: rows.filter((row) => row.promotionSafety === 'parent_promoted_note_needs_manual_attach_review').slice(0, 25),
      alreadyPromoted: rows.filter((row) => row.promotionSafety === 'already_promoted_do_not_import').slice(0, 10),
    },
    artifacts: {
      csv: options.outputCsv,
      json: options.outputJson,
    },
  };

  await mkdir(path.dirname(options.outputJson), { recursive: true });
  await writeFile(options.outputJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.outputCsv, renderCsv(rows));
  await writeFile(options.outputMarkdown, renderMarkdown(report));

  console.log(JSON.stringify({
    outputJson: options.outputJson,
    outputCsv: options.outputCsv,
    outputMarkdown: options.outputMarkdown,
    summary: report.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
