import fs from 'node:fs';
import { Client } from 'pg';

const REMAINING_PACKET_PATH = 'docs/mis-171-ait-signs-after-final-rough-review-remaining.json';
const SET_ASIDE_PACKET_PATH = 'docs/mis-171-ait-signs-import-review-page-set-aside.json';
const REPORT_BASENAME = 'docs/mis-176-ait-signs-import-review-decision-action-plan';
const AIT_SIGNS_DECISION_TYPES = ['misc_text', 'note'];
const AIT_SIGNS_DECISION_SHEETS = ['1. INTERESADOS', 'WORK ORDER TERMINADOS Y PAGADOS'];
const CREATE_CANDIDATE_SOURCE_KEYS = new Set([
  'WORK ORDER TERMINADOS Y PAGADOS#20',
  'WORK ORDER TERMINADOS Y PAGADOS#40',
  'WORK ORDER TERMINADOS Y PAGADOS#42',
  'WORK ORDER TERMINADOS Y PAGADOS#55',
  'WORK ORDER TERMINADOS Y PAGADOS#76',
  'WORK ORDER TERMINADOS Y PAGADOS#77',
  'WORK ORDER TERMINADOS Y PAGADOS#92',
  'WORK ORDER TERMINADOS Y PAGADOS#103',
  'WORK ORDER TERMINADOS Y PAGADOS#107',
]);

function parseSourceKey(sourceKey) {
  const match = String(sourceKey || '').match(/^(.*)#(\d+)$/);
  if (!match) throw new Error(`Invalid sourceKey: ${sourceKey}`);
  return {
    sourceSheet: match[1],
    sourceRowNumber: Number(match[2]),
  };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function validName(value) {
  const normalized = normalizeText(value);
  return normalized && normalized !== 'sin numero' && normalized !== 'no' && normalized !== 'si';
}

function hasPlaceholderIdentity(row) {
  const names = row.sourceClientNames || [];
  if (!names.length) return true;
  return names.every((name) => !validName(name) || /^[-\s]+$/.test(String(name || '')));
}

function originalText(row) {
  return String(row.workbookOriginalText || '');
}

function hasWrongNumberSignal(row) {
  return /numero equivocado|ya no es su whatsapp|wrong number/i.test(originalText(row));
}

function hasNoNumberSignal(row) {
  return /sin numero/i.test(originalText(row));
}

function contactChannels(row) {
  return {
    phones: row.sourcePhones || [],
    emails: row.sourceEmails || [],
  };
}

function classify(row) {
  const { phones, emails } = contactChannels(row);
  const hasContactChannel = phones.length > 0 || emails.length > 0;
  const hasExactTarget = (row.exactClientMatches || []).length > 0 || (row.exactEmailMatches || []).length > 0;
  const lowRough = row.roughMatchBucket === 'review_low_rough_client_match';

  if (hasWrongNumberSignal(row)) {
    return {
      recommendedAction: 'discard',
      approvalBucket: 'approve_discard_wrong_or_dead_contact',
      confidence: 'high',
      plannedWriteType: 'review_item_status_rejected',
      rationale: 'Original workbook text says the contact channel is wrong/dead; no CRM mutation should be inferred.',
      requiredApprovalOrData: 'Approval to discard this source-row decision.',
    };
  }

  if (hasPlaceholderIdentity(row)) {
    return {
      recommendedAction: 'discard',
      approvalBucket: 'approve_discard_no_identity',
      confidence: 'high',
      plannedWriteType: 'review_item_status_rejected',
      rationale: 'The source row has no usable customer/client identity.',
      requiredApprovalOrData: 'Approval to discard this source-row decision.',
    };
  }

  if (hasExactTarget) {
    return {
      recommendedAction: 'attach_existing',
      approvalBucket: 'review_attach_existing_exact_evidence',
      confidence: 'medium',
      plannedWriteType: 'review_item_status_imported_with_attach_metadata',
      rationale: 'The packet reports exact client or email evidence; attach/status-only may be possible without creating CRM records.',
      requiredApprovalOrData: 'Confirm exact target and whether status-only attach metadata is enough.',
    };
  }

  if (CREATE_CANDIDATE_SOURCE_KEYS.has(row.sourceKey)) {
    return {
      recommendedAction: 'create_lead_or_client',
      approvalBucket: emails.length > 0 ? 'review_create_with_email' : 'review_create_business_candidate',
      confidence: 'medium',
      plannedWriteType: 'crm_contact_and_lead_create_plus_review_item_imported',
      rationale: 'The source row has business/client evidence but no exact existing CRM target.',
      requiredApprovalOrData: 'Human approval for display name, object type, contact point if any, and duplicate check before creating CRM records.',
    };
  }

  if (lowRough || !hasContactChannel || hasNoNumberSignal(row)) {
    return {
      recommendedAction: 'hold',
      approvalBucket: lowRough ? 'hold_low_rough_name_only_match' : 'hold_no_safe_target',
      confidence: 'low',
      plannedWriteType: 'none_until_target_approved',
      rationale: lowRough
        ? 'Low rough match is name-only suggestion evidence, not identity approval.'
        : 'No exact target, approved create path, or safe mutation path was found.',
      requiredApprovalOrData: lowRough
        ? 'Human target approval if this should attach to an existing client; otherwise discard/hold.'
        : 'Human decision on whether to discard, keep held, or approve a create path.',
    };
  }

  return {
    recommendedAction: 'hold',
    approvalBucket: 'hold_no_safe_target',
    confidence: 'low',
    plannedWriteType: 'none_until_target_approved',
    rationale: 'No safe exact target or mutation path was found.',
    requiredApprovalOrData: 'Human decision on target/action.',
  };
}

function keyBySource(rows) {
  return new Map(rows.map((row) => [row.sourceKey, row]));
}

async function loadLiveReviewItems(client, sourceKeys) {
  const sourceRows = sourceKeys.map(parseSourceKey);
  const result = await client.query(
    `
      select
        iri.id,
        iri.review_status,
        iri.review_type,
        iri.proposed_resolution_json,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', nr.id,
              'recordType', nr.record_type,
              'status', nr.status,
              'confidenceScore', nr.confidence_score
            )
            order by nr.record_type asc, nr.created_at desc
          ) filter (where nr.id is not null),
          '[]'::jsonb
        ) as normalized_evidence_json
      from import_review_items iri
      join import_source_rows sr on sr.id = iri.source_row_id
      left join import_normalized_records nr on nr.source_row_id = sr.id
        and nr.import_batch_id = iri.import_batch_id
      where (sr.source_sheet, sr.source_row_number) in (
        select source_sheet, source_row_number
        from jsonb_to_recordset($1::jsonb) as packet(source_sheet text, source_row_number int)
      )
        and sr.source_sheet = any($2::text[])
        and iri.review_type = any($3::text[])
      group by iri.id, sr.id
      order by sr.source_sheet asc, sr.source_row_number asc
    `,
    [JSON.stringify(sourceRows.map((row) => ({
      source_sheet: row.sourceSheet,
      source_row_number: row.sourceRowNumber,
    }))), AIT_SIGNS_DECISION_SHEETS, AIT_SIGNS_DECISION_TYPES],
  );

  return new Map(result.rows.map((row) => [`${row.source_sheet}#${row.source_row_number}`, row]));
}

async function loadExactContactEvidence(client, rows) {
  const names = [...new Set(rows.flatMap((row) => row.sourceClientNames || []).filter(validName))];
  const phones = [...new Set(rows.flatMap((row) => row.sourcePhones || []).filter(Boolean))];
  const emails = [...new Set(rows.flatMap((row) => row.sourceEmails || []).filter(Boolean))];
  const result = await client.query(
    `
      select
        c.id,
        c.name,
        c.company_name,
        c.phone,
        c.email,
        bu.name as business_unit_name
      from contacts c
      left join business_units bu on bu.id = c.primary_business_unit_id
      where bu.name = 'AIT Signs'
        and (
          lower(c.name) = any($1::text[])
          or lower(coalesce(c.company_name, '')) = any($1::text[])
          or regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = any($2::text[])
          or lower(coalesce(c.email, '')) = any($3::text[])
        )
      order by c.name asc
    `,
    [
      names.map((name) => String(name).toLowerCase()),
      phones.map((phone) => String(phone).replace(/[^0-9]/g, '')).filter(Boolean),
      emails.map((email) => String(email).toLowerCase()),
    ],
  );
  return result.rows;
}

function evidenceForRow(row, contacts) {
  const names = new Set((row.sourceClientNames || []).map((name) => String(name).toLowerCase()));
  const phones = new Set((row.sourcePhones || []).map((phone) => String(phone).replace(/[^0-9]/g, '')).filter(Boolean));
  const emails = new Set((row.sourceEmails || []).map((email) => String(email).toLowerCase()));
  return contacts.filter((contact) => (
    names.has(String(contact.name || '').toLowerCase())
    || names.has(String(contact.company_name || '').toLowerCase())
    || phones.has(String(contact.phone || '').replace(/[^0-9]/g, ''))
    || emails.has(String(contact.email || '').toLowerCase())
  ));
}

function csvEscape(value) {
  const string = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  if (/[",\n]/.test(string)) return `"${string.replace(/"/g, '""')}"`;
  return string;
}

function writeCsv(path, rows) {
  const columns = [
    'sourceKey',
    'recommendedAction',
    'approvalBucket',
    'confidence',
    'plannedWriteType',
    'currentReviewStatus',
    'reviewType',
    'sourceClientNames',
    'sourcePhones',
    'sourceEmails',
    'workbookIdentityFields',
    'roughMatchBucket',
    'topRoughMatch',
    'exactClientMatches',
    'exactContactPointMatches',
    'nameOnlyMatches',
    'liveExactContactEvidence',
    'normalizedEvidence',
    'rationale',
    'requiredApprovalOrData',
    'workbookOriginalText',
    'workbookPreviousRowText',
    'workbookNextRowText',
  ];
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ];
  fs.writeFileSync(path, `${lines.join('\n')}\n`);
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function writeMarkdown(path, report) {
  const lines = [
    '# MIS-176 AIT Signs Import Review Decision Action Plan',
    '',
    `- Generated at: ${report.generatedAt}`,
    '- DB writes: none',
    `- Source rows reviewed: ${report.summary.rows}`,
    `- Pending live decision rows: ${report.summary.pendingLiveDecisionRows}`,
    `- Database: ${report.safeFingerprint.database}`,
    `- Host suffix: ${report.safeFingerprint.hostSuffix}`,
    '',
    '## Recommended Actions',
    '',
    ...Object.entries(report.summary.byRecommendedAction).map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## Approval Buckets',
    '',
    ...Object.entries(report.summary.byApprovalBucket).map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## Recommended Next Gate',
    '',
    'Use this packet as the human approval surface before any CRM/data writes. Phone is contact-point evidence, not client identity. The safest first write slice is status-only discard/hold actions for rows Alvaro explicitly approves. Any create/attach/promote action should be a separate apply script with dry-run, apply, idempotence, and targeted DB readback.',
  ];
  fs.writeFileSync(path, `${lines.join('\n')}\n`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const databaseUrl = new URL(process.env.DATABASE_URL);

  const remainingPacket = JSON.parse(fs.readFileSync(REMAINING_PACKET_PATH, 'utf8'));
  const setAsidePacket = JSON.parse(fs.readFileSync(SET_ASIDE_PACKET_PATH, 'utf8'));
  const setAsideBySource = keyBySource(setAsidePacket.rows || []);
  const sourceRows = (remainingPacket.rows || [])
    .filter((row) => setAsideBySource.has(row.sourceKey));

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const liveBySource = await loadLiveReviewItems(client, sourceRows.map((row) => row.sourceKey));
    const contacts = await loadExactContactEvidence(client, sourceRows);
    const db = await client.query('select current_database() as database');

    const rows = sourceRows.map((row) => {
      const live = liveBySource.get(row.sourceKey);
      const merged = {
        ...setAsideBySource.get(row.sourceKey),
        ...row,
      };
      const classification = classify(merged);
      const contactEvidence = evidenceForRow(merged, contacts);
      return {
        sourceKey: merged.sourceKey,
        ...classification,
        currentReviewStatus: live?.review_status || merged.currentStatus || '',
        reviewType: live?.review_type || '',
        sourceClientNames: merged.sourceClientNames || [],
        sourcePhones: merged.sourcePhones || [],
        sourceEmails: merged.sourceEmails || [],
        workbookIdentityFields: merged.workbookIdentityFields || '',
        roughMatchBucket: merged.roughMatchBucket || '',
        topRoughMatch: merged.topRoughMatch || '',
        exactClientMatches: merged.exactClientMatches || [],
        exactContactPointMatches: merged.exactContactPointMatches || [],
        nameOnlyMatches: merged.nameOnlyMatches || [],
        liveExactContactEvidence: contactEvidence.map((contact) => [
          contact.name,
          contact.phone,
          contact.email,
        ].filter(Boolean).join(' / ')),
        normalizedEvidence: (live?.normalized_evidence_json || []).map((item) => `${item.recordType}:${item.status}`),
        workbookOriginalText: merged.workbookOriginalText || '',
        workbookPreviousRowText: merged.workbookPreviousRowText || '',
        workbookNextRowText: merged.workbookNextRowText || '',
      };
    });

    const report = {
      issue: 'MIS-176',
      generatedAt: new Date().toISOString(),
      packetSources: [REMAINING_PACKET_PATH, SET_ASIDE_PACKET_PATH],
      safeFingerprint: {
        database: db.rows[0]?.database,
        hostSuffix: databaseUrl.hostname.split('.').slice(-5).join('.'),
      },
      summary: {
        rows: rows.length,
        pendingLiveDecisionRows: rows.filter((row) => row.currentReviewStatus === 'pending').length,
        byRecommendedAction: countBy(rows, 'recommendedAction'),
        byApprovalBucket: countBy(rows, 'approvalBucket'),
        byPlannedWriteType: countBy(rows, 'plannedWriteType'),
      },
      rows,
    };

    fs.writeFileSync(`${REPORT_BASENAME}.json`, `${JSON.stringify(report, null, 2)}\n`);
    writeCsv(`${REPORT_BASENAME}.csv`, rows);
    writeMarkdown(`${REPORT_BASENAME}.md`, report);
    console.log(JSON.stringify(report.summary, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
