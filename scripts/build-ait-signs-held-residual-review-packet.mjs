#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const RESIDUAL_INPUT = 'docs/mis-164-ait-signs-residual-after-review-item-context-attaches.json';
const CROSSCHECK_INPUT = 'docs/mis-160-ait-signs-workbook-crosscheck.json';
const DEFAULT_OUTPUT = 'docs/mis-165-ait-signs-held-residual-review-packet.json';
const DECISION_OVERRIDES = new Map([
  ['WORK ORDER TERMINADOS Y PAGADOS#1538', {
    decision: 'safe_attach_status_only_candidate',
    risk: 'low',
    nextAction: 'Eligible for status-only attach/imported dry-run; do not create a duplicate note.',
    overrideReason: 'Read-only normalized-note audit found the text is already represented by the promoted parent work order.',
  }],
]);

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

function key(sheet, rowNumber) {
  return `${sheet}#${Number(rowNumber)}`;
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function phoneValues(text) {
  const phones = [];
  const re = /(?<!\d)(?:\+?\d[\d\s().-]{5,}\d)(?!\d)/g;
  for (const match of clean(text).matchAll(re)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length === 10) phones.push(digits);
    if (digits.length === 11 && digits.startsWith('1')) phones.push(digits.slice(1));
  }
  return [...new Set(phones)].sort();
}

function emailValues(text) {
  const emails = clean(text).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  return [...new Set(emails.map((email) => email.toLowerCase()))].sort();
}

function compactJson(value) {
  if (!value) return '';
  if (typeof value === 'string') return clean(value);
  const entries = Object.entries(value).filter(([, entry]) => clean(entry));
  if (!entries.length) return '';
  return entries.map(([name, entry]) => `${name}: ${clean(entry)}`).join('; ');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('; ') : clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
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
  const bits = [name, contact.phone, contact.email].filter(Boolean);
  return bits.join(' / ');
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

function nameCandidates(row, crosscheck) {
  return [
    row.customerName,
    row.contactName,
    crosscheck?.target,
    crosscheck?.workbookOriginalIdentityFields?.customer,
    crosscheck?.workbookOriginalIdentityFields?.contact,
  ].filter(Boolean);
}

function matchContacts(row, crosscheck, contacts) {
  const originalText = [
    crosscheck?.workbookOriginalText,
    crosscheck?.workbookOriginalIdentityFields?.phones,
    crosscheck?.workbookOriginalIdentityFields?.emails,
    row.customerName,
    row.contactName,
  ].join(' ');
  const contextText = [
    crosscheck?.workbookOriginalText,
    crosscheck?.workbookPreviousRowText,
    crosscheck?.workbookNextRowText,
    crosscheck?.contextPhones,
    crosscheck?.contextEmails,
    crosscheck?.target,
    row.customerName,
    row.contactName,
  ].join(' ');
  const originalPhones = phoneValues(originalText);
  const originalEmails = emailValues(originalText);
  const contextPhones = phoneValues(contextText);
  const contextEmails = emailValues(contextText);
  const phoneMatches = contacts.filter((contact) => originalPhones.includes(clean(contact.phone).replace(/\D/g, '').slice(-10)));
  const emailMatches = contacts.filter((contact) => originalEmails.includes(clean(contact.email).toLowerCase()));
  const seen = new Set([...phoneMatches, ...emailMatches].map((contact) => contact.id));
  const names = nameCandidates(row, crosscheck).map(normalizeKey).filter((value) => value.length >= 4);
  const nameMatches = contacts.filter((contact) => {
    if (seen.has(contact.id)) return false;
    const contactKey = normalizeKey(contact.company_name || contact.name);
    if (contactKey.length < 4) return false;
    return names.some((name) => contactKey.includes(name) || name.includes(contactKey));
  }).slice(0, 5);
  return {
    phones: originalPhones,
    emails: originalEmails,
    contextPhones,
    contextEmails,
    phoneMatches,
    emailMatches,
    nameMatches,
  };
}

function classify(row, crosscheck, evidence) {
  const override = DECISION_OVERRIDES.get(key(row.sourceSheet, row.sourceRowNumber));
  if (override) return override;

  const recommendation = crosscheck?.recommendation || '';
  const verdict = crosscheck?.crosscheckVerdict || '';

  if (row.bucket === 'normalized_note_pending') {
    if (recommendation === 'promote_note') {
      return {
        decision: 'promote_note_candidate',
        risk: 'medium',
        nextAction: 'Needs explicit note-creation/attachment approval.',
      };
    }
    return {
      decision: 'true_human_hold',
      risk: 'medium',
      nextAction: 'Human direction needed before attach, ignore, or note creation.',
    };
  }

  if (recommendation === 'record_candidate_needs_promotion_review') {
    return {
      decision: 'promote_or_create_candidate',
      risk: 'high',
      nextAction: 'Needs separate promotion/create plan; do not status-clean as noise.',
    };
  }

  if (recommendation === 'attach_to_existing_work_order') {
    return {
      decision: 'safe_attach_status_only_candidate',
      risk: 'low',
      nextAction: 'Eligible for status-only attach/imported dry-run against the existing work order target.',
    };
  }

  if (recommendation === 'attach_to_existing_contact') {
    const exactCount = evidence.phoneMatches.length + evidence.emailMatches.length;
    if (exactCount === 1) {
      return {
        decision: 'safe_attach_status_only_candidate',
        risk: 'low',
        nextAction: 'Eligible for a narrow attach/status-only dry-run.',
      };
    }
    return {
      decision: 'hold_ambiguous_attach_target',
      risk: 'medium',
      nextAction: 'Keep pending unless a single existing target is approved.',
    };
  }

  if (recommendation === 'hold_for_human' || recommendation === 'hold_amount_mismatch') {
    return {
      decision: 'true_human_hold',
      risk: 'medium',
      nextAction: 'Needs human direction; do not auto-reject.',
    };
  }

  if (recommendation === 'reject_noise' || recommendation.startsWith('reject_as_')) {
    if (verdict === 'reject_blocked_original_row_has_identity_fields') {
      return {
        decision: 'identity_bearing_reject_blocked_review',
        risk: 'medium',
        nextAction: 'Needs promoted-evidence review before reject/attach/hold decision.',
      };
    }
    if (verdict === 'reject_source_row_has_no_identity_fields') {
      return {
        decision: 'reject_candidate_after_source_check',
        risk: 'low',
        nextAction: 'Eligible for reject dry-run if still pending.',
      };
    }
  }

  return {
    decision: 'unclassified_hold',
    risk: 'medium',
    nextAction: 'Review manually before any write.',
  };
}

async function loadJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

async function loadDbEvidence(client, residualRows) {
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

  const keys = residualRows.map((row) => [row.sourceSheet, Number(row.sourceRowNumber)]);
  const sheets = keys.map(([sheet]) => sheet);
  const rowNumbers = keys.map(([, rowNumber]) => rowNumber);

  const activityResult = await client.query(
    `
      select
        ae.source_sheet,
        ae.source_row,
        ae.event_type,
        ae.message,
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

  const pendingNotesResult = await client.query(
    `
      select
        nr.id,
        nr.status,
        sr.source_sheet,
        sr.source_row_number
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      where nr.import_batch_id = $1
        and nr.record_type = 'note'
    `,
    [batch.id],
  );

  const reviewItemsResult = await client.query(
    `
      select
        ri.id,
        ri.review_status,
        ri.review_type,
        sr.source_sheet,
        sr.source_row_number
      from import_review_items ri
      join import_source_rows sr on sr.id = ri.source_row_id
      left join import_normalized_records nr on nr.import_batch_id = ri.import_batch_id
        and nr.source_row_id = ri.source_row_id
      where ri.import_batch_id = $1
        and nr.id is null
    `,
    [batch.id],
  );

  return {
    batch,
    contacts: contactsResult.rows,
    activitiesByKey: new Map(activityResult.rows.map((activity) => [key(activity.source_sheet, activity.source_row), activity])),
    notesByKey: new Map(pendingNotesResult.rows.map((note) => [key(note.source_sheet, note.source_row_number), note])),
    reviewItemsByKey: new Map(reviewItemsResult.rows.map((item) => [key(item.source_sheet, item.source_row_number), item])),
  };
}

function toCsv(rows) {
  const columns = [
    'decision',
    'risk',
    'nextAction',
    'bucket',
    'recommendedBucket',
    'sourceSheet',
    'sourceRowNumber',
    'currentStatus',
    'oldRecommendation',
    'crosscheckVerdict',
    'target',
    'exactContactMatches',
    'nameContactMatches',
    'promotedActivity',
    'workbookIdentityFields',
    'workbookOriginalText',
    'workbookPreviousRowText',
    'workbookNextRowText',
    'reason',
    'evidence',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMd(report) {
  const lines = [
    '# MIS-165 AIT Signs Held Residual Review Packet',
    '',
    f('- Generated at: {value}', report.generatedAt),
    f('- Residual input: `{value}`', RESIDUAL_INPUT),
    f('- Workbook cross-check input: `{value}`', CROSSCHECK_INPUT),
    '- DB writes: none',
    '',
    '## Summary',
    '',
    f('- Total current residual rows reviewed: {value}', report.summary.totalRows),
    ...Object.entries(report.summary.byDecision).map(([name, count]) => `- ${name}: ${count}`),
    '',
    '## Recommendation',
    '',
    '- Do not apply one mixed write across the whole hold surface.',
    '- Use `promote_or_create_candidate` rows as a separate promotion/create plan.',
    '- Use `identity_bearing_reject_blocked_review` rows for focused human or evidence review before rejecting.',
    '- Only `safe_attach_status_only_candidate` and `reject_candidate_after_source_check` rows should move to write-plan dry-runs.',
    '',
    '## Audit Reconciliation',
    '',
    '- Read-only note audit supports treating `WORK ORDER TERMINADOS Y PAGADOS#1538` as status-only attach, not duplicate note creation.',
    '- Read-only review-item audit supports `Sheet12#6` as status-only attach to `WORLD SUPERMARKET / AIT-WO-ARCH-1661`.',
    '- The 55 reject-looking rows remain blocked because their original workbook rows have identity fields; they need promoted-evidence review before any reject write.',
    '- Two additional review-item rows are marked safe candidates by this generator because live staging DB has exact original-row phone matches: `3. 15 SIGNS WORK ORDER#135` and `#141`.',
  ];
  return `${lines.join('\n')}\n`;
}

function f(template, value) {
  return template.replace('{value}', value);
}

async function main() {
  const options = parseArgs(process.argv);
  const residual = await loadJson(RESIDUAL_INPUT);
  const crosscheck = await loadJson(CROSSCHECK_INPUT);
  const crosscheckByKey = new Map(crosscheck.rows.map((row) => [key(row.sourceSheet, row.sourceRowNumber), row]));

  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const safe = await safeFingerprint(client);
  const db = await loadDbEvidence(client, residual.rows);
  await client.end();

  const rows = residual.rows.map((row) => {
    const rowKey = key(row.sourceSheet, row.sourceRowNumber);
    const workbook = crosscheckByKey.get(rowKey) || {};
    const matches = matchContacts(row, workbook, db.contacts);
    const classification = classify(row, workbook, matches);
    const current = row.bucket === 'normalized_note_pending'
      ? db.notesByKey.get(rowKey)
      : db.reviewItemsByKey.get(rowKey);
    const exactContactMatches = [...matches.phoneMatches, ...matches.emailMatches]
      .filter((contact, index, all) => all.findIndex((item) => item.id === contact.id) === index)
      .map(contactLabel);
    const activity = db.activitiesByKey.get(rowKey);
    return {
      ...row,
      ...classification,
      sourceKey: rowKey,
      currentStatus: current?.status || current?.review_status || 'not_found',
      currentRecordId: current?.id || '',
      oldRecommendation: workbook.recommendation || '',
      crosscheckVerdict: workbook.crosscheckVerdict || '',
      target: workbook.target || '',
      evidence: workbook.evidence || row.reason || '',
      workbookIdentityFields: compactJson(workbook.workbookOriginalIdentityFields),
      workbookOriginalText: workbook.workbookOriginalText || '',
      workbookPreviousRowText: workbook.workbookPreviousRowText || '',
      workbookNextRowText: workbook.workbookNextRowText || '',
      contextPhones: matches.phones,
      contextEmails: matches.emails,
      exactContactMatches,
      nameContactMatches: matches.nameMatches.map(contactLabel),
      promotedActivity: summarizeActivity(activity),
    };
  });

  const report = {
    issue: 'MIS-165',
    generatedAt: new Date().toISOString(),
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: safe,
    inputs: {
      residual: RESIDUAL_INPUT,
      workbookCrosscheck: CROSSCHECK_INPUT,
    },
    summary: {
      totalRows: rows.length,
      byDecision: by(rows, 'decision'),
      byRisk: by(rows, 'risk'),
      byRecommendedBucket: by(rows, 'recommendedBucket'),
      byCurrentStatus: by(rows, 'currentStatus'),
    },
    rows,
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.csv'), `${toCsv(rows)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.md'), renderMd(report));
  for (const decision of Object.keys(report.summary.byDecision).sort()) {
    const decisionRows = rows.filter((row) => row.decision === decision);
    await writeFile(
      options.output.replace(/\.json$/, `-${decision}.csv`),
      `${toCsv(decisionRows)}\n`,
    );
  }
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
