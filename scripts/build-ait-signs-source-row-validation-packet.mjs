#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const REFINED_INPUT = 'docs/mis-166-ait-signs-refined-residual-approval.json';
const HELD_INPUT = 'docs/mis-165-ait-signs-held-residual-review-packet.json';
const DEFAULT_OUTPUT = 'docs/mis-167-ait-signs-source-row-validation-packet.csv';

function parseArgs(argv) {
  const options = { output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function loadSecrets() {
  try {
    return JSON.parse(await readFile('/root/.openclaw/secrets.json', 'utf8'));
  } catch {
    return {};
  }
}

async function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const secrets = await loadSecrets();
  return secrets.aitCrm?.staging?.databaseUrl || '';
}

async function safeFingerprint(client) {
  const secrets = await loadSecrets();
  const databaseUrl = secrets.aitCrm?.staging?.databaseUrl || '';
  const url = databaseUrl ? new URL(databaseUrl) : null;
  const db = await client.query('select current_database() as database');
  return {
    expectedNeonBranchId: EXPECTED_BRANCH_ID,
    targetBaseUrl: secrets.aitCrm?.staging?.baseUrl || null,
    hostSuffix: url ? url.hostname.split('.').slice(0, 2).join('.') : null,
    currentDatabase: db.rows[0]?.database || null,
  };
}

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('; ') : clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function sourceKey(row) {
  return `${row.sourceSheet}#${Number(row.sourceRowNumber)}`;
}

function normalizeName(value) {
  return clean(value).toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeComparable(value) {
  return normalizeName(value).replace(/[^A-Z0-9]/g, '');
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function phoneValues(text) {
  const phones = [];
  const re = /(?<!\d)(?:\+?\d[\d\s().-]{5,}\d)(?!\d)/g;
  for (const match of clean(text).matchAll(re)) {
    const normalized = normalizePhone(match[0]);
    if (normalized.length === 10) phones.push(normalized);
  }
  return [...new Set(phones)].sort();
}

function emailValues(text) {
  const emails = clean(text).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  return [...new Set(emails.map((email) => email.toLowerCase()))].sort();
}

function parseIdentityFields(value) {
  const result = {};
  const text = clean(value);
  for (const part of text.split(';')) {
    const [rawKey, ...rest] = part.split(':');
    const key = clean(rawKey).toLowerCase();
    const item = clean(rest.join(':'));
    if (key && item) result[key] = item;
  }
  return result;
}

function by(rows, field) {
  return rows.reduce((acc, row) => {
    const value = row[field] || '';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function contactLabel(contact) {
  if (!contact) return '';
  const name = contact.company_name || contact.name || '';
  return [name, contact.phone, contact.email].filter(Boolean).join(' / ');
}

function summarizeActivity(activity) {
  if (!activity) return '';
  const target = [
    activity.work_order_number,
    activity.work_order_title,
    activity.contact_company || activity.contact_name,
    activity.contact_phone,
  ].filter(Boolean).join(' / ');
  return `${activity.event_type}${target ? ` -> ${target}` : ''}`;
}

async function loadDbEvidence(client, rows) {
  const batchResult = await client.query(
    `
      select ib.id, ib.organization_id, ib.business_unit_id
      from import_batches ib
      join business_units bu on bu.id = ib.business_unit_id
      where bu.name = $1
        and ib.source_type = 'xlsx'
      order by ib.created_at desc
      limit 1
    `,
    [BUSINESS_UNIT],
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new Error(`No latest XLSX batch found for ${BUSINESS_UNIT}`);

  const contactsResult = await client.query(
    `
      select id, name, company_name, phone, email
      from contacts
      where organization_id = $1
        and primary_business_unit_id = $2
    `,
    [batch.organization_id, batch.business_unit_id],
  );

  const sheets = rows.map((row) => row.sourceSheet);
  const rowNumbers = rows.map((row) => Number(row.sourceRowNumber));
  const activityResult = await client.query(
    `
      select
        ae.source_sheet,
        ae.source_row,
        ae.event_type,
        c.name as contact_name,
        c.company_name as contact_company,
        c.phone as contact_phone,
        wo.work_order_number,
        wo.title as work_order_title
      from activity_events ae
      left join contacts c on c.id = ae.contact_id
      left join work_orders wo on wo.id = ae.work_order_id
      where ae.business_unit_id = $1
        and ae.source_sheet = any($2::text[])
        and ae.source_row = any($3::int[])
      order by ae.source_sheet, ae.source_row, ae.created_at asc
    `,
    [batch.business_unit_id, sheets, rowNumbers],
  );

  return {
    batch,
    contacts: contactsResult.rows,
    activitiesByKey: new Map(activityResult.rows.map((activity) => [
      `${activity.source_sheet}#${Number(activity.source_row)}`,
      activity,
    ])),
  };
}

function buildEvidence(row, heldRow, contacts, activity) {
  const identity = parseIdentityFields(row.workbookIdentityFields);
  const originalText = [
    row.workbookOriginalText,
    row.workbookIdentityFields,
    heldRow?.customerName,
    heldRow?.contactName,
  ].join(' ');
  const contextText = [
    row.workbookPreviousRowText,
    row.workbookNextRowText,
    heldRow?.target,
    heldRow?.workDescription,
  ].join(' ');
  const phones = [...new Set([
    ...phoneValues(originalText),
    ...(heldRow?.contextPhones || []),
  ].map(normalizePhone).filter((phone) => phone.length === 10))].sort();
  const emails = [...new Set([
    ...emailValues(originalText),
    ...(heldRow?.contextEmails || []),
  ])].sort();
  const clientCandidates = [
    identity.customer,
    identity.client,
    heldRow?.customerName,
  ].filter(Boolean);
  const normalizedClientCandidates = [...new Set(clientCandidates.map(normalizeComparable).filter((name) => name.length >= 4))];

  const exactClientMatches = contacts.filter((contact) => {
    const company = normalizeComparable(contact.company_name || contact.name);
    return company && normalizedClientCandidates.includes(company);
  });
  const exactPhoneMatches = contacts.filter((contact) => phones.includes(normalizePhone(contact.phone)));
  const exactEmailMatches = contacts.filter((contact) => emails.includes(clean(contact.email).toLowerCase()));
  const exactContactMatches = [...exactPhoneMatches, ...exactEmailMatches]
    .filter((contact, index, all) => all.findIndex((item) => item.id === contact.id) === index);
  const nameOnlyMatches = row.nameContactMatches || [];

  return {
    identity,
    sourceClientNames: clientCandidates,
    sourcePhones: phones,
    sourceEmails: emails,
    exactClientMatches,
    exactContactMatches,
    nameOnlyMatches,
    promotedActivity: summarizeActivity(activity) || row.promotedActivity || '',
    hasPromotedSourceEvidence: Boolean(activity || clean(row.promotedActivity)),
    hasCompatibleExactClient: exactClientMatches.length === 1,
    hasCompatibleExactContactPoint: exactContactMatches.length === 1,
    hasMultipleExactTargets: exactClientMatches.length + exactContactMatches.length > 1,
    originalText: clean(row.workbookOriginalText),
    contextText: clean(contextText),
  };
}

function sourceTextLooksLikeNoise(row) {
  const text = `${row.workbookOriginalText} ${row.workbookIdentityFields}`.toLowerCase();
  const letters = (text.match(/[a-z]/gi) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  return (
    row.sourceSheet === 'Sheet12'
    || text.includes('ait signs')
    || text.includes('web page & digital ads')
    || text.includes('gran total')
    || (digits > 10 && letters < 8)
  );
}

function classify(row, evidence) {
  if (row.approvalBucket === 'approve_reject_or_ignore_candidates') {
    return {
      validationBucket: 'approve_reject_or_ignore_source_checked',
      workflowRecommendation: row.agentRecommendation,
      validationConfidence: row.confidence || 'medium',
      validationBasis: row.matchBasis,
      reviewerAction: 'Approve reject/ignore only if source-row debris/noise judgment is accepted.',
    };
  }

  if (row.approvalBucket === 'create_note_or_record_candidates') {
    return {
      validationBucket: 'create_or_promote_plan',
      workflowRecommendation: row.agentRecommendation,
      validationConfidence: row.agentRecommendation === 'create_note_candidate' ? 'medium' : 'low',
      validationBasis: evidence.hasPromotedSourceEvidence ? 'source_row_or_parent_activity_exists' : 'structured_source_row_no_safe_existing_match',
      reviewerAction: 'Keep out of cleanup writes; handle in a separate create/promote dry-run.',
    };
  }

  if (row.agentRecommendation === 'attach_status_only_candidate') {
    return {
      validationBucket: 'approve_status_only_existing_evidence',
      workflowRecommendation: 'approve_status_only_cleanup',
      validationConfidence: evidence.hasPromotedSourceEvidence || evidence.hasCompatibleExactClient || evidence.hasCompatibleExactContactPoint ? 'high' : 'medium',
      validationBasis: evidence.hasPromotedSourceEvidence ? 'promoted_source_activity' : evidence.hasCompatibleExactClient ? 'exact_client_name_match' : 'exact_phone_or_email_match',
      reviewerAction: 'Eligible for status-only cleanup; no CRM object creation or merge.',
    };
  }

  if (evidence.hasPromotedSourceEvidence && !row.agentRecommendation.includes('hold_for_human')) {
    return {
      validationBucket: 'approve_status_only_existing_evidence',
      workflowRecommendation: 'approve_status_only_cleanup',
      validationConfidence: 'high',
      validationBasis: 'promoted_source_activity',
      reviewerAction: 'Eligible for status-only cleanup if source row and promoted activity describe the same client/work.',
    };
  }

  if (evidence.hasMultipleExactTargets) {
    return {
      validationBucket: 'manual_conflicting_or_multiple_exact_targets',
      workflowRecommendation: 'hold_for_target_selection',
      validationConfidence: 'low',
      validationBasis: 'multiple_exact_client_or_contact_point_matches',
      reviewerAction: 'Human target selection required; do not merge by phone.',
    };
  }

  if (evidence.hasCompatibleExactClient) {
    return {
      validationBucket: 'manual_exact_client_match_review',
      workflowRecommendation: 'review_status_or_note_attach',
      validationConfidence: 'medium',
      validationBasis: 'exact_client_name_match',
      reviewerAction: 'Review whether source text is useful note/context or just status cleanup.',
    };
  }

  if (evidence.hasCompatibleExactContactPoint) {
    return {
      validationBucket: 'manual_exact_phone_email_context_review',
      workflowRecommendation: 'review_contact_point_context',
      validationConfidence: 'medium',
      validationBasis: 'exact_phone_or_email_match_not_client_identity',
      reviewerAction: 'Use phone/email as contact-point evidence only; confirm workbook client context before attach.',
    };
  }

  if (sourceTextLooksLikeNoise(row)) {
    return {
      validationBucket: 'manual_rejectable_noise_review',
      workflowRecommendation: 'review_reject_or_ignore',
      validationConfidence: 'medium',
      validationBasis: 'source_row_noise_pattern_no_exact_target',
      reviewerAction: 'Likely reject/ignore after source-row review.',
    };
  }

  if ((row.nameContactMatches || []).length) {
    return {
      validationBucket: 'manual_name_only_ambiguous',
      workflowRecommendation: 'hold_name_only_not_enough',
      validationConfidence: 'low',
      validationBasis: 'name_only_match',
      reviewerAction: 'Name-only match is not approval evidence.',
    };
  }

  return {
    validationBucket: 'manual_no_exact_match',
    workflowRecommendation: 'hold_no_safe_target',
    validationConfidence: 'low',
    validationBasis: 'no_exact_client_phone_email_or_source_activity',
    reviewerAction: 'Hold unless source row has business value worth creating separately.',
  };
}

function toCsv(rows) {
  const columns = [
    'alvaro_decision',
    'validationBucket',
    'workflowRecommendation',
    'validationConfidence',
    'validationBasis',
    'reviewerAction',
    'sourceKey',
    'sourceSheet',
    'sourceRowNumber',
    'currentStatus',
    'sourceClientNames',
    'sourcePhones',
    'sourceEmails',
    'exactClientMatches',
    'exactContactPointMatches',
    'nameOnlyMatches',
    'promotedActivity',
    'mis166Recommendation',
    'mis166Bucket',
    'mis166Reason',
    'target',
    'workbookIdentityFields',
    'workbookOriginalText',
    'workbookPreviousRowText',
    'workbookNextRowText',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-167 AIT Signs Source-Row Validation Packet',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Refined input: \`${REFINED_INPUT}\``,
    `- Held packet input: \`${HELD_INPUT}\``,
    '- DB writes: none',
    '- CRM/source/schema changes: none',
    '- First CSV column is intentionally blank: `alvaro_decision`.',
    '',
    '## Summary',
    '',
    `- Total rows: ${report.summary.totalRows}`,
    '',
    '### By Validation Bucket',
    '',
    ...Object.entries(report.summary.byValidationBucket).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '### By Workflow Recommendation',
    '',
    ...Object.entries(report.summary.byWorkflowRecommendation).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Rules Encoded',
    '',
    '- Original workbook row is treated as the primary review surface.',
    '- Exact client/business-name matches are stronger than contact/person-name matches.',
    '- Exact phone/email matches are contact-point evidence, not automatic client-merge evidence.',
    '- Contact/person-name-only matches stay manual.',
    '- Create-note/create-record candidates are kept out of cleanup writes.',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  const refined = JSON.parse(await readFile(REFINED_INPUT, 'utf8'));
  const held = JSON.parse(await readFile(HELD_INPUT, 'utf8'));
  const heldByKey = new Map(held.rows.map((row) => [sourceKey(row), row]));

  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const safe = await safeFingerprint(client);
  const db = await loadDbEvidence(client, refined.rows);
  await client.end();

  const rows = refined.rows.map((row) => {
    const rowKey = sourceKey(row);
    const heldRow = heldByKey.get(rowKey);
    const evidence = buildEvidence(row, heldRow, db.contacts, db.activitiesByKey.get(rowKey));
    const classification = classify(row, evidence);
    return {
      alvaro_decision: '',
      ...classification,
      sourceKey: rowKey,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      currentStatus: row.currentStatus,
      sourceClientNames: evidence.sourceClientNames,
      sourcePhones: evidence.sourcePhones,
      sourceEmails: evidence.sourceEmails,
      exactClientMatches: evidence.exactClientMatches.map(contactLabel),
      exactContactPointMatches: evidence.exactContactMatches.map(contactLabel),
      nameOnlyMatches: evidence.nameOnlyMatches,
      promotedActivity: evidence.promotedActivity,
      mis166Recommendation: row.agentRecommendation,
      mis166Bucket: row.approvalBucket,
      mis166Reason: row.why,
      target: row.target,
      workbookIdentityFields: row.workbookIdentityFields,
      workbookOriginalText: row.workbookOriginalText,
      workbookPreviousRowText: row.workbookPreviousRowText,
      workbookNextRowText: row.workbookNextRowText,
    };
  });

  const report = {
    issue: 'MIS-167',
    generatedAt: new Date().toISOString(),
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: safe,
    inputs: {
      refined: REFINED_INPUT,
      held: HELD_INPUT,
    },
    summary: {
      totalRows: rows.length,
      byValidationBucket: by(rows, 'validationBucket'),
      byWorkflowRecommendation: by(rows, 'workflowRecommendation'),
      byValidationConfidence: by(rows, 'validationConfidence'),
      byMis166Bucket: by(rows, 'mis166Bucket'),
    },
    rows,
  };

  const jsonPath = options.output.replace(/\.csv$/, '.json');
  const mdPath = options.output.replace(/\.csv$/, '.md');
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${toCsv(rows)}\n`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(mdPath, renderMarkdown(report));
  for (const bucket of Object.keys(report.summary.byValidationBucket).sort()) {
    const bucketRows = rows.filter((row) => row.validationBucket === bucket);
    await writeFile(
      options.output.replace(/\.csv$/, `-${bucket}.csv`),
      `${toCsv(bucketRows)}\n`,
    );
  }
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
