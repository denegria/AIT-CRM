#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const INPUT = 'docs/mis-167-ait-signs-source-row-validation-packet.json';
const DEFAULT_OUTPUT = 'docs/mis-169-ait-signs-post-approval-remaining-review.csv';

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

function splitKey(key) {
  const index = key.lastIndexOf('#');
  return { sourceSheet: key.slice(0, index), sourceRowNumber: Number(key.slice(index + 1)) };
}

function parseIdentityFields(value) {
  const result = {};
  for (const part of clean(value).split(';')) {
    const [rawKey, ...rest] = part.split(':');
    const key = clean(rawKey).toLowerCase();
    const item = clean(rest.join(':'));
    if (key && item) result[key] = item;
  }
  return result;
}

function normalizeName(value) {
  return clean(value)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\b(L L C|LLC|INC|CORP|CORPORATION|COMPANY|CO|THE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactName(value) {
  return normalizeName(value).replace(/[^A-Z0-9]/g, '');
}

function tokens(value) {
  return normalizeName(value).split(' ').filter((token) => token.length >= 2);
}

const GENERIC_NAME_TOKENS = new Set([
  'CONSTRUCTION',
  'CLEANING',
  'HOME',
  'IMPROVEMENT',
  'LANDSCAPING',
  'LANDSCOPING',
  'RESTAURANT',
  'SUPERMARKET',
  'TRANSPORTATION',
  'SERVICE',
  'SERVICES',
  'TAXI',
  'PAINTING',
  'FINANCIAL',
  'DESIGN',
  'WORLD',
]);

function levenshtein(a, b) {
  const left = compactName(a);
  const right = compactName(b);
  if (!left && !right) return 0;
  if (!left || !right) return Math.max(left.length, right.length);
  const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  let curr = new Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
    curr = new Array(right.length + 1);
  }
  return prev[right.length];
}

function similarity(a, b) {
  const left = compactName(a);
  const right = compactName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    if (ratio >= 0.65) return 0.92;
  }
  const distance = levenshtein(left, right);
  const editScore = 1 - distance / Math.max(left.length, right.length);
  const leftTokens = tokens(a);
  const rightTokens = tokens(b);
  const tokenScores = leftTokens.map((leftToken) => Math.max(0, ...rightTokens.map((rightToken) => {
    if (leftToken === rightToken) return 1;
    const d = levenshtein(leftToken, rightToken);
    return 1 - d / Math.max(leftToken.length, rightToken.length);
  })));
  let tokenScore = tokenScores.length ? tokenScores.reduce((sum, value) => sum + value, 0) / tokenScores.length : 0;
  if (leftTokens.length > 1 && rightTokens.length === 1) tokenScore *= 0.7;
  if (rightTokens.length > 1 && leftTokens.length === 1) tokenScore *= 0.7;
  let score = Math.max(editScore, tokenScore * 0.9);
  const leftDistinctive = leftTokens.filter((token) => !GENERIC_NAME_TOKENS.has(token));
  const rightDistinctive = rightTokens.filter((token) => !GENERIC_NAME_TOKENS.has(token));
  if (leftDistinctive.length && rightDistinctive.length) {
    const distinctiveScore = Math.max(0, ...leftDistinctive.flatMap((leftToken) => rightDistinctive.map((rightToken) => {
      if (leftToken === rightToken) return 1;
      const d = levenshtein(leftToken, rightToken);
      return 1 - d / Math.max(leftToken.length, rightToken.length);
    })));
    if (distinctiveScore < 0.7 && score > 0.69) score = 0.66;
  }
  return score;
}

function contactLabel(contact) {
  const names = [contact.company_name, contact.name]
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex((item) => compactName(item) === compactName(value)) === index);
  return [...names, contact.phone, contact.email].filter(Boolean).join(' / ');
}

function sourceNames(row) {
  const identity = parseIdentityFields(row.workbookIdentityFields);
  return [
    ...(row.sourceClientNames || []),
    identity.customer,
    identity.client,
    identity.company,
    identity.business,
  ].filter(Boolean).filter((value, index, all) => all.findIndex((item) => compactName(item) === compactName(value)) === index);
}

function roughMatches(row, contacts) {
  const names = sourceNames(row);
  if (!names.length) return [];
  const matches = [];
  for (const sourceName of names) {
    for (const contact of contacts) {
      const contactName = contact.company_name || contact.name || '';
      const score = similarity(sourceName, contactName);
      if (score >= 0.65) {
        matches.push({
          sourceName,
          score,
          confidence: score >= 0.85 ? 'high' : score >= 0.72 ? 'medium' : 'low',
          contactId: contact.id,
          contactLabel: contactLabel(contact),
        });
      }
    }
  }
  return matches
    .sort((a, b) => b.score - a.score || a.contactLabel.localeCompare(b.contactLabel))
    .filter((match, index, all) => all.findIndex((item) => item.contactId === match.contactId && item.sourceName === match.sourceName) === index)
    .slice(0, 5);
}

function by(rows, field) {
  return rows.reduce((acc, row) => {
    const value = row[field] || '';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

async function loadDbState(client, rows) {
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

  const keys = rows.map((row) => splitKey(row.sourceKey));
  const rowStateResult = await client.query(
    `
      select
        sr.source_sheet,
        sr.source_row_number,
        array_remove(array_agg(distinct nr.status), null) as normalized_statuses,
        array_remove(array_agg(distinct nr.record_type), null) as normalized_types,
        array_remove(array_agg(distinct ri.review_status), null) as review_statuses,
        array_remove(array_agg(distinct ri.review_type), null) as review_types
      from import_source_rows sr
      left join import_normalized_records nr on nr.import_batch_id = sr.import_batch_id
        and nr.source_row_id = sr.id
      left join import_review_items ri on ri.import_batch_id = sr.import_batch_id
        and ri.source_row_id = sr.id
      where sr.import_batch_id = $1
        and (sr.source_sheet, sr.source_row_number) in (
          select source_sheet, source_row_number
          from jsonb_to_recordset($2::jsonb) as x(source_sheet text, source_row_number int)
        )
      group by sr.source_sheet, sr.source_row_number
    `,
    [batch.id, JSON.stringify(keys.map((key) => ({ source_sheet: key.sourceSheet, source_row_number: key.sourceRowNumber })))],
  );

  const contactsResult = await client.query(
    `
      select id, name, company_name, phone, email
      from contacts
      where organization_id = $1
        and primary_business_unit_id = $2
    `,
    [batch.organization_id, batch.business_unit_id],
  );

  return {
    batch,
    contacts: contactsResult.rows,
    rowStateByKey: new Map(rowStateResult.rows.map((row) => [
      `${row.source_sheet}#${Number(row.source_row_number)}`,
      row,
    ])),
  };
}

function isRemaining(row, state) {
  if (!state) return true;
  const normalizedStatuses = state.normalized_statuses || [];
  const reviewStatuses = state.review_statuses || [];
  if (normalizedStatuses.includes('pending')) return true;
  if (reviewStatuses.includes('pending')) return true;
  if (!normalizedStatuses.length && !reviewStatuses.length) return true;
  return false;
}

function currentStatus(state) {
  if (!state) return 'not_found';
  const bits = [];
  if ((state.normalized_statuses || []).length) bits.push(`normalized:${state.normalized_statuses.join('|')}`);
  if ((state.review_statuses || []).length) bits.push(`review:${state.review_statuses.join('|')}`);
  return bits.join('; ') || 'no_import_record';
}

function classifyRoughMatch(matches) {
  if (!matches.length) return 'no_rough_match';
  const top = matches[0];
  if (top.confidence === 'high') return 'review_high_rough_client_match';
  if (top.confidence === 'medium') return 'review_medium_rough_client_match';
  return 'review_low_rough_client_match';
}

function toCsv(rows) {
  const columns = [
    'alvaro_decision',
    'roughMatchBucket',
    'topRoughMatch',
    'topRoughMatchScore',
    'roughMatchCandidates',
    'sourceClientNames',
    'currentDbStatus',
    'validationBucket',
    'workflowRecommendation',
    'validationConfidence',
    'validationBasis',
    'reviewerAction',
    'sourceKey',
    'sourceSheet',
    'sourceRowNumber',
    'sourcePhones',
    'sourceEmails',
    'exactClientMatches',
    'exactContactPointMatches',
    'nameOnlyMatches',
    'promotedActivity',
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
    '# MIS-169 AIT Signs Post-approval Remaining Review',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Input: \`${INPUT}\``,
    '- DB writes: none',
    '',
    '## Summary',
    '',
    `- Input review rows: ${report.summary.inputRows}`,
    `- Remaining rows: ${report.summary.remainingRows}`,
    `- Resolved/skipped rows: ${report.summary.resolvedRows}`,
    '',
    '### By Rough Match Bucket',
    '',
    ...Object.entries(report.summary.byRoughMatchBucket).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '### By Validation Bucket',
    '',
    ...Object.entries(report.summary.byValidationBucket).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Notes',
    '',
    '- Rough matches are suggestions only; they do not approve merges or imports.',
    '- Contact/person-name-only evidence remains manual unless Alvaro approves a target.',
    '- Current DB status is read live from staging after MIS-168.',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  const input = JSON.parse(await readFile(INPUT, 'utf8'));

  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const safe = await safeFingerprint(client);
  const db = await loadDbState(client, input.rows);
  await client.end();

  const rows = input.rows
    .map((row) => {
      const state = db.rowStateByKey.get(row.sourceKey);
      const matches = roughMatches(row, db.contacts);
      const top = matches[0] || null;
      return {
        ...row,
        alvaro_decision: '',
        currentDbStatus: currentStatus(state),
        roughMatchBucket: classifyRoughMatch(matches),
        topRoughMatch: top ? top.contactLabel : '',
        topRoughMatchScore: top ? top.score.toFixed(3) : '',
        roughMatchCandidates: matches.map((match) => `${match.confidence}:${match.score.toFixed(3)}:${match.sourceName}->${match.contactLabel}`),
        remaining: isRemaining(row, state),
      };
    });
  const remainingRows = rows.filter((row) => row.remaining);
  const resolvedRows = rows.filter((row) => !row.remaining);

  const report = {
    issue: 'MIS-169',
    generatedAt: new Date().toISOString(),
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: safe,
    input: INPUT,
    summary: {
      inputRows: rows.length,
      remainingRows: remainingRows.length,
      resolvedRows: resolvedRows.length,
      byRoughMatchBucket: by(remainingRows, 'roughMatchBucket'),
      byValidationBucket: by(remainingRows, 'validationBucket'),
      byWorkflowRecommendation: by(remainingRows, 'workflowRecommendation'),
      byCurrentDbStatus: by(remainingRows, 'currentDbStatus'),
    },
    rows: remainingRows,
    resolvedRows,
  };

  const jsonPath = options.output.replace(/\.csv$/, '.json');
  const mdPath = options.output.replace(/\.csv$/, '.md');
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${toCsv(remainingRows)}\n`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(mdPath, renderMarkdown(report));
  for (const bucket of Object.keys(report.summary.byRoughMatchBucket).sort()) {
    const bucketRows = remainingRows.filter((row) => row.roughMatchBucket === bucket);
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
