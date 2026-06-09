#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const BUSINESS_UNIT = 'AIT Signs';
const EXPECTED_BRANCH_ID = 'br-broad-hill-aptjpyea';
const INPUT = 'docs/mis-170-ait-signs-after-rough-approval-remaining-review.json';
const DEFAULT_OUTPUT = 'docs/mis-171-ait-signs-final-rough-review-directions-dry-run.json';
const FOUR_BROTHERS_KEY = '3. 15 SIGNS WORK ORDER#109';
const FOUR_BROTHERS_TARGET = '4 BOTHERS IMPROVEMENT';
const FOUR_BROTHERS_PHONE = '9083338110';
const DISCARD_KEYS = ['1. INTERESADOS#41', '1. INTERESADOS#42'];

function parseArgs(argv) {
  const options = { apply: false, output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--output') {
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

function compactName(value) {
  return clean(value).toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, '');
}

function splitKey(value) {
  const index = value.lastIndexOf('#');
  return { sourceSheet: value.slice(0, index), sourceRowNumber: Number(value.slice(index + 1)) };
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

async function loadContext(client) {
  const result = await client.query(
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
  const batch = result.rows[0];
  if (!batch) throw new Error(`No latest XLSX batch found for ${BUSINESS_UNIT}`);
  return batch;
}

async function loadReviewItems(client, batchId, keys) {
  const result = await client.query(
    `
      select
        ri.id as review_item_id,
        ri.review_status,
        ri.review_type,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text
      from import_source_rows sr
      join import_review_items ri on ri.import_batch_id = sr.import_batch_id
        and ri.source_row_id = sr.id
      where sr.import_batch_id = $1
        and (sr.source_sheet, sr.source_row_number) in (
          select source_sheet, source_row_number
          from jsonb_to_recordset($2::jsonb) as x(source_sheet text, source_row_number int)
        )
    `,
    [batchId, JSON.stringify(keys.map((key) => ({ source_sheet: key.sourceSheet, source_row_number: key.sourceRowNumber })))],
  );
  return new Map(result.rows.map((row) => [`${row.source_sheet}#${Number(row.source_row_number)}`, row]));
}

async function resolveContactByExactName(client, batch, target) {
  const result = await client.query(
    `
      select id, name, company_name, phone, email
      from contacts
      where organization_id = $1
        and primary_business_unit_id = $2
        and (
          regexp_replace(upper(coalesce(company_name, '')), '[^A-Z0-9]', '', 'g') = $3
          or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]', '', 'g') = $3
        )
      order by created_at asc
      limit 5
    `,
    [batch.organization_id, batch.business_unit_id, compactName(target)],
  );
  if (result.rowCount === 1) return { status: 'resolved_existing_contact', contact: result.rows[0] };
  if (result.rowCount > 1) return { status: 'hold_ambiguous_target', matches: result.rows };
  return { status: 'hold_unresolved_target', matches: [] };
}

async function exactEvidence(client, batch, row) {
  const names = (row.sourceClientNames || []).filter((name) => compactName(name).length >= 3);
  const emails = row.sourceEmails || [];
  const nameResult = names.length ? await client.query(
    `
      select company_name, name, phone, email
      from contacts
      where organization_id = $1
        and primary_business_unit_id = $2
        and regexp_replace(upper(coalesce(company_name, name, '')), '[^A-Z0-9]', '', 'g') = any($3::text[])
      order by company_name nulls last, name
    `,
    [batch.organization_id, batch.business_unit_id, names.map(compactName)],
  ) : { rows: [] };
  const emailResult = emails.length ? await client.query(
    `
      select company_name, name, phone, email
      from contacts
      where organization_id = $1
        and primary_business_unit_id = $2
        and lower(coalesce(email, '')) = any($3::text[])
      order by company_name nulls last, name
    `,
    [batch.organization_id, batch.business_unit_id, emails.map((email) => clean(email).toLowerCase())],
  ) : { rows: [] };
  return {
    exactClientMatches: nameResult.rows.map((match) => [match.company_name || match.name, match.phone, match.email].filter(Boolean).join(' / ')),
    exactEmailMatches: emailResult.rows.map((match) => [match.company_name || match.name, match.phone, match.email].filter(Boolean).join(' / ')),
  };
}

function importReviewPageRows(rows) {
  return rows.filter((row) => {
    if (row.sourceKey === FOUR_BROTHERS_KEY || DISCARD_KEYS.includes(row.sourceKey)) return false;
    return row.roughMatchBucket === 'review_low_rough_client_match' || row.roughMatchBucket === 'no_rough_match';
  });
}

function toCsv(rows) {
  const columns = [
    'decision',
    'sourceKey',
    'sourceClientNames',
    'sourcePhones',
    'sourceEmails',
    'roughMatchBucket',
    'topRoughMatch',
    'exactClientMatches',
    'exactEmailMatches',
    'workbookOriginalText',
    'futureAction',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMarkdown(report) {
  return `# MIS-171 AIT Signs Final Rough-review Directions

- Generated at: ${report.generatedAt}
- Mode: ${report.mode}
- DB writes: ${report.mode === 'apply' ? '4 Brothers review status/metadata + contact phone, first two no-match rows rejected' : 'none'}

## Summary

- 4 Brothers action: ${report.summary.fourBrothersDecision}
- Discard rows reviewed: ${report.summary.discardRows}
- Import Review page set-aside rows: ${report.summary.importReviewPageRows}
- Updated review items: ${report.summary.updatedReviewItems}
- Contact phone updates: ${report.summary.updatedContactPhones}

## Guardrail

- The set-aside packet is read-only and stays pending for the future Import Review page.
- Only exact client-name/email evidence from the workbook original text should pull a row out of that future-review bucket.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const packet = JSON.parse(await readFile(INPUT, 'utf8'));
  const sourceByKey = new Map(packet.rows.map((row) => [row.sourceKey, row]));

  const dbUrl = await connectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const fingerprint = await safeFingerprint(client);
  const batch = await loadContext(client);
  const actionKeys = [FOUR_BROTHERS_KEY, ...DISCARD_KEYS].map(splitKey);
  const reviewByKey = await loadReviewItems(client, batch.id, actionKeys);

  const fourBrothersReview = reviewByKey.get(FOUR_BROTHERS_KEY);
  const fourBrothersSource = sourceByKey.get(FOUR_BROTHERS_KEY);
  const fourBrothersResolved = await resolveContactByExactName(client, batch, FOUR_BROTHERS_TARGET);
  let fourBrothersDecision = fourBrothersResolved.status;
  if (!fourBrothersReview || !fourBrothersSource) fourBrothersDecision = 'hold_missing_source_or_review_item';
  if (fourBrothersReview && fourBrothersReview.review_status !== 'pending') fourBrothersDecision = 'already_processed';

  const discardRows = DISCARD_KEYS.map((key) => {
    const source = sourceByKey.get(key);
    const review = reviewByKey.get(key);
    return {
      decision: review?.review_status === 'pending' ? 'discard_phone_only_no_identity' : 'already_processed',
      sourceKey: key,
      reviewItemId: review?.review_item_id || '',
      currentReviewStatus: review?.review_status || '',
      sourcePhones: source?.sourcePhones || [],
      workbookOriginalText: source?.workbookOriginalText || '',
    };
  });

  const setAsideRows = [];
  for (const row of importReviewPageRows(packet.rows)) {
    const evidence = await exactEvidence(client, batch, row);
    setAsideRows.push({
      decision: evidence.exactClientMatches.length || evidence.exactEmailMatches.length ? 'exact_match_found_needs_review' : 'set_aside_for_import_review_page',
      sourceKey: row.sourceKey,
      sourceClientNames: row.sourceClientNames || [],
      sourcePhones: row.sourcePhones || [],
      sourceEmails: row.sourceEmails || [],
      roughMatchBucket: row.roughMatchBucket,
      topRoughMatch: row.topRoughMatch || '',
      exactClientMatches: evidence.exactClientMatches,
      exactEmailMatches: evidence.exactEmailMatches,
      workbookOriginalText: row.workbookOriginalText,
      futureAction: evidence.exactClientMatches.length || evidence.exactEmailMatches.length
        ? 'Review exact staging match before future page bucket.'
        : 'Keep pending for future Import Review page.',
    });
  }

  let updatedReviewItems = [];
  let updatedContactPhones = [];
  if (options.apply) {
    await client.query('begin');
    try {
      if (fourBrothersDecision === 'resolved_existing_contact') {
        const updateReview = await client.query(
          `
            update import_review_items
            set review_status = 'imported',
                reviewed_at = now(),
                updated_at = now(),
                proposed_resolution_json = coalesce(proposed_resolution_json, '{}'::jsonb) || $2::jsonb
            where id = $1
              and review_status = 'pending'
            returning id, review_status, review_type
          `,
          [
            fourBrothersReview.review_item_id,
            JSON.stringify({
              action: 'approved_rough_match_existing_client_with_phone_update',
              issue: 'MIS-171',
              targetContactId: fourBrothersResolved.contact.id,
              targetContact: fourBrothersResolved.contact.company_name || fourBrothersResolved.contact.name,
              phoneAdded: FOUR_BROTHERS_PHONE,
              operatorReason: 'Alvaro directed medium rough-match row to 4 Brother client and requested adding contact phone number.',
            }),
          ],
        );
        updatedReviewItems.push(...updateReview.rows);
        const updateContact = await client.query(
          `
            update contacts
            set phone = $2,
                updated_at = now()
            where id = $1
              and nullif(trim(coalesce(phone, '')), '') is null
            returning id, company_name, phone
          `,
          [fourBrothersResolved.contact.id, FOUR_BROTHERS_PHONE],
        );
        updatedContactPhones = updateContact.rows;
      }

      const discardIds = discardRows
        .filter((row) => row.decision === 'discard_phone_only_no_identity' && row.reviewItemId)
        .map((row) => row.reviewItemId);
      if (discardIds.length) {
        const discardUpdate = await client.query(
          `
            update import_review_items ri
            set review_status = 'rejected',
                reviewed_at = now(),
                updated_at = now(),
                proposed_resolution_json = coalesce(ri.proposed_resolution_json, '{}'::jsonb)
                  || jsonb_build_object(
                    'action', 'discarded_phone_only_no_identity',
                    'issue', 'MIS-171',
                    'operatorReason', 'Alvaro discarded the first two no-rough-match rows.'
                  )
            where ri.id = any($1::uuid[])
              and ri.review_status = 'pending'
            returning ri.id, ri.review_status, ri.review_type
          `,
          [discardIds],
        );
        updatedReviewItems.push(...discardUpdate.rows);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  await client.end();

  const report = {
    issue: 'MIS-171',
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: BUSINESS_UNIT,
    safeFingerprint: fingerprint,
    input: INPUT,
    fourBrothers: {
      decision: fourBrothersDecision,
      sourceKey: FOUR_BROTHERS_KEY,
      target: FOUR_BROTHERS_TARGET,
      phone: FOUR_BROTHERS_PHONE,
      reviewItemId: fourBrothersReview?.review_item_id || '',
      resolvedContact: fourBrothersResolved.contact || null,
      sourceRow: fourBrothersSource || null,
    },
    discardRows,
    importReviewPageRows: setAsideRows,
    summary: {
      fourBrothersDecision,
      discardRows: discardRows.length,
      discardByDecision: by(discardRows, 'decision'),
      importReviewPageRows: setAsideRows.length,
      importReviewPageByDecision: by(setAsideRows, 'decision'),
      importReviewPageByRoughBucket: by(setAsideRows, 'roughMatchBucket'),
      updatedReviewItems: updatedReviewItems.length,
      updatedContactPhones: updatedContactPhones.length,
    },
    updatedReviewItems,
    updatedContactPhones,
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.output.replace(/\.json$/, '.md'), renderMarkdown(report));
  await writeFile(options.output.replace(/\.json$/, '.csv'), `${toCsv([
    {
      decision: fourBrothersDecision,
      sourceKey: FOUR_BROTHERS_KEY,
      sourceClientNames: fourBrothersSource?.sourceClientNames || [],
      sourcePhones: fourBrothersSource?.sourcePhones || [],
      sourceEmails: fourBrothersSource?.sourceEmails || [],
      roughMatchBucket: fourBrothersSource?.roughMatchBucket || '',
      topRoughMatch: FOUR_BROTHERS_TARGET,
      exactClientMatches: FOUR_BROTHERS_TARGET,
      exactEmailMatches: '',
      workbookOriginalText: fourBrothersSource?.workbookOriginalText || '',
      futureAction: `Attach to ${FOUR_BROTHERS_TARGET}; add ${FOUR_BROTHERS_PHONE}.`,
    },
    ...discardRows.map((row) => ({
      ...row,
      futureAction: 'Discard/reject phone-only row with no identity.',
    })),
    ...setAsideRows,
  ])}\n`);
  await writeFile('docs/mis-171-ait-signs-import-review-page-set-aside.csv', `${toCsv(setAsideRows)}\n`);
  await writeFile('docs/mis-171-ait-signs-import-review-page-set-aside.json', `${JSON.stringify({
    issue: 'MIS-171',
    generatedAt: report.generatedAt,
    businessUnit: BUSINESS_UNIT,
    rows: setAsideRows,
    summary: {
      rows: setAsideRows.length,
      byDecision: report.summary.importReviewPageByDecision,
      byRoughBucket: report.summary.importReviewPageByRoughBucket,
    },
  }, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(JSON.stringify(fingerprint, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
