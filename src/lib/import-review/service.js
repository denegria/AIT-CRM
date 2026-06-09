import { promoteFacebookLeadProposalToCrm } from '../ingestion/facebook-lead-ads.js';

export const DEFAULT_IMPORT_REVIEW_LIMIT = 120;
export const VALID_IMPORT_REVIEW_STATUSES = new Set(['approved', 'rejected', 'pending', 'needs_review']);

const MAX_IMPORT_REVIEW_LIMIT = 250;
const DEFAULT_SAMPLE_LIMIT = 10;
const OPERATOR_REVIEW_SOURCE_TYPES = ['xlsx', 'csv', 'spreadsheet'];
const REVIEWABLE_RECORD_STATUSES = ['pending', 'needs_review'];
const REVIEWABLE_ITEM_STATUSES = ['pending', 'needs_review'];
const AIT_SIGNS_DECISION_SHEETS = ['1. INTERESADOS', 'WORK ORDER TERMINADOS Y PAGADOS'];
const AIT_SIGNS_DECISION_TYPES = ['misc_text', 'note'];
const QUALITY_FLAG_FILTERS = {
  phone_only: ['phone_only'],
  dead_contact: ['wrong_number', 'disconnected', 'do_not_contact', 'not_current', 'repeated_no_answer'],
  old_or_stale: ['stale_or_old_lead'],
  source_unclear: ['source_unclear'],
};
const QUALITY_DISPOSITION_FILTERS = new Set(['ready_for_follow_up', 'needs_review', 'suppress_from_follow_up']);

function isWordSearchTerm(q) {
  return /^[A-Za-zÀ-ÿ]{3,}$/u.test(String(q || '').trim());
}

function escapePostgresRegex(value) {
  return String(value).replace(/[\\.^$*+?()[\]{}|]/g, '\\$&');
}

export function parseImportReviewLimit(rawLimit, fallback = DEFAULT_IMPORT_REVIEW_LIMIT) {
  const value = Number(rawLimit);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_IMPORT_REVIEW_LIMIT, Math.floor(value)));
}

export function parseImportReviewOffset(rawOffset) {
  const value = Number(rawOffset);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function parseImportReviewSampleLimit(rawLimit) {
  return parseImportReviewLimit(rawLimit, DEFAULT_SAMPLE_LIMIT);
}

export function normalizeImportReviewText(value, fallback = 'all') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

export function normalizeQualityFilter(value) {
  const normalized = normalizeImportReviewText(value, 'all');
  if (normalized === 'all') return 'all';
  if (QUALITY_DISPOSITION_FILTERS.has(normalized)) return normalized;
  if (QUALITY_FLAG_FILTERS[normalized]) return normalized;
  return 'all';
}

export async function resolveImportReviewBatchId(client, batchId, { organizationId = null, businessUnitId = null } = {}) {
  if (batchId) {
    if (!organizationId && !businessUnitId) return batchId;

    const params = [batchId];
    const clauses = ['id = $1'];
    if (organizationId) {
      params.push(organizationId);
      clauses.push(`organization_id = $${params.length}`);
    }
    if (businessUnitId) {
      params.push(businessUnitId);
      clauses.push(`business_unit_id = $${params.length}`);
    }
    const scopedBatch = await client.query(
      `select id from import_batches where ${clauses.join(' and ')} limit 1`,
      params,
    );
    const resolved = scopedBatch.rows[0]?.id;
    if (!resolved) throw new Error('No import batch found.');
    return resolved;
  }

  const batchParams = [OPERATOR_REVIEW_SOURCE_TYPES, REVIEWABLE_RECORD_STATUSES];
  const scopeClauses = [];
  if (organizationId) {
    batchParams.push(organizationId);
    scopeClauses.push(`and ib.organization_id = $${batchParams.length} `);
  }
  if (businessUnitId) {
    batchParams.push(businessUnitId);
    scopeClauses.push(`and ib.business_unit_id = $${batchParams.length} `);
  }

  const preferredPending = await client.query(
    'select ib.id ' +
    'from import_batches ib ' +
    'where ib.source_type = any($1::text[]) ' +
    'and exists (select 1 from import_normalized_records nr where nr.import_batch_id = ib.id and nr.status = any($2::text[])) ' +
    scopeClauses.join('') +
    'order by ib.created_at desc limit 1',
    batchParams,
  );
  if (preferredPending.rows[0]?.id) return preferredPending.rows[0].id;

  const preferredReviewItemParams = [OPERATOR_REVIEW_SOURCE_TYPES, REVIEWABLE_ITEM_STATUSES];
  const reviewItemScopeClauses = [];
  if (organizationId) {
    preferredReviewItemParams.push(organizationId);
    reviewItemScopeClauses.push(`and ib.organization_id = $${preferredReviewItemParams.length} `);
  }
  if (businessUnitId) {
    preferredReviewItemParams.push(businessUnitId);
    reviewItemScopeClauses.push(`and ib.business_unit_id = $${preferredReviewItemParams.length} `);
  }
  const preferredReviewItems = await client.query(
    'select ib.id ' +
    'from import_batches ib ' +
    'where ib.source_type = any($1::text[]) ' +
    'and exists (select 1 from import_review_items iri where iri.import_batch_id = ib.id and iri.review_status = any($2::text[])) ' +
    reviewItemScopeClauses.join('') +
    'order by ib.created_at desc limit 1',
    preferredReviewItemParams,
  );
  if (preferredReviewItems.rows[0]?.id) return preferredReviewItems.rows[0].id;

  const pendingParams = [REVIEWABLE_RECORD_STATUSES];
  const pendingScopeClauses = [];
  if (organizationId) {
    pendingParams.push(organizationId);
    pendingScopeClauses.push(`and ib.organization_id = $${pendingParams.length} `);
  }
  if (businessUnitId) {
    pendingParams.push(businessUnitId);
    pendingScopeClauses.push(`and ib.business_unit_id = $${pendingParams.length} `);
  }
  const anyPending = await client.query(
    'select ib.id ' +
    'from import_batches ib ' +
    'where exists (select 1 from import_normalized_records nr where nr.import_batch_id = ib.id and nr.status = any($1::text[])) ' +
    pendingScopeClauses.join('') +
    'order by ib.created_at desc limit 1',
    pendingParams,
  );
  if (anyPending.rows[0]?.id) return anyPending.rows[0].id;

  const anyReviewItemParams = [REVIEWABLE_ITEM_STATUSES];
  const anyReviewItemScopeClauses = [];
  if (organizationId) {
    anyReviewItemParams.push(organizationId);
    anyReviewItemScopeClauses.push(`and ib.organization_id = $${anyReviewItemParams.length} `);
  }
  if (businessUnitId) {
    anyReviewItemParams.push(businessUnitId);
    anyReviewItemScopeClauses.push(`and ib.business_unit_id = $${anyReviewItemParams.length} `);
  }
  const anyReviewItems = await client.query(
    'select ib.id ' +
    'from import_batches ib ' +
    'where exists (select 1 from import_review_items iri where iri.import_batch_id = ib.id and iri.review_status = any($1::text[])) ' +
    anyReviewItemScopeClauses.join('') +
    'order by ib.created_at desc limit 1',
    anyReviewItemParams,
  );
  if (anyReviewItems.rows[0]?.id) return anyReviewItems.rows[0].id;

  const fallbackParams = [OPERATOR_REVIEW_SOURCE_TYPES];
  const fallbackScopeClauses = [];
  if (organizationId) {
    fallbackParams.push(organizationId);
    fallbackScopeClauses.push(`and organization_id = $${fallbackParams.length} `);
  }
  if (businessUnitId) {
    fallbackParams.push(businessUnitId);
    fallbackScopeClauses.push(`and business_unit_id = $${fallbackParams.length} `);
  }
  const preferredFallback = await client.query(
    'select id from import_batches where source_type = any($1::text[]) ' +
    fallbackScopeClauses.join('') +
    'order by created_at desc limit 1',
    fallbackParams,
  );
  if (preferredFallback.rows[0]?.id) return preferredFallback.rows[0].id;

  const finalParams = [];
  const finalClauses = [];
  if (organizationId) {
    finalParams.push(organizationId);
    finalClauses.push(`organization_id = $${finalParams.length}`);
  }
  if (businessUnitId) {
    finalParams.push(businessUnitId);
    finalClauses.push(`business_unit_id = $${finalParams.length}`);
  }
  const fallback = await client.query(
    'select id from import_batches ' +
    (finalClauses.length ? `where ${finalClauses.join(' and ')} ` : '') +
    'order by created_at desc limit 1',
    finalParams,
  );
  const resolved = fallback.rows[0]?.id;
  if (!resolved) {
    throw new Error('No import batch found.');
  }
  return resolved;
}

function importBatchPayload(batch) {
  return {
    id: batch.id,
    sourceName: batch.source_name,
    sourceType: batch.source_type,
    fileName: batch.file_name,
    fileHash: batch.file_hash,
    sheetName: batch.sheet_name,
    status: batch.status,
    businessUnitId: batch.business_unit_id,
    businessUnitName: batch.business_unit_name,
    createdAt: batch.created_at,
  };
}

export async function loadImportReviewBatch(client, batchId) {
  const result = await client.query(
    `
      select
        ib.id,
        ib.source_name,
        ib.source_type,
        ib.file_name,
        ib.file_hash,
        ib.sheet_name,
        ib.status,
        ib.business_unit_id,
        bu.name as business_unit_name,
        ib.created_at
      from import_batches ib
      left join business_units bu on bu.id = ib.business_unit_id
      where ib.id = $1
    `,
    [batchId],
  );

  const batch = result.rows[0];
  if (!batch) return null;

  return importBatchPayload(batch);
}

export async function listImportReviewBatches(client, { organizationId = null, businessUnitId = null } = {}) {
  const params = [];
  const clauses = [];
  if (organizationId) {
    params.push(organizationId);
    clauses.push(`ib.organization_id = $${params.length}`);
  }
  if (businessUnitId) {
    params.push(businessUnitId);
    clauses.push(`ib.business_unit_id = $${params.length}`);
  }

  const result = await client.query(
    `
      select
        ib.id,
        ib.source_name,
        ib.source_type,
        ib.file_name,
        ib.file_hash,
        ib.sheet_name,
        ib.status,
        ib.business_unit_id,
        bu.name as business_unit_name,
        ib.created_at,
        count(nr.id)::int as normalized_count,
        (
          count(distinct nr.id) filter (where nr.status in ('pending', 'needs_review'))
          + count(distinct iri.id) filter (where iri.review_status in ('pending', 'needs_review'))
        )::int as reviewable_count
      from import_batches ib
      left join business_units bu on bu.id = ib.business_unit_id
      left join import_normalized_records nr on nr.import_batch_id = ib.id
      left join import_review_items iri on iri.import_batch_id = ib.id
      ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
      group by ib.id, bu.name
      order by ib.created_at desc
      limit 50
    `,
    params,
  );

  return result.rows.map((batch) => ({
    ...importBatchPayload(batch),
    normalizedCount: Number(batch.normalized_count || 0),
    reviewableCount: Number(batch.reviewable_count || 0),
  }));
}

export async function loadImportReviewSummary(client, batchId) {
  const [
    sourceRowStatusCounts,
    normalizedStatusCounts,
    reviewStatusCounts,
    sourceRowTotal,
    recordTypeCounts,
    reviewTypeCounts,
    qualityDispositionCounts,
    qualityFlagCounts,
    qualityDispositionSheetCounts,
    needsReviewReasonCounts,
    suppressReasonCounts,
  ] = await Promise.all([
    client.query(
      'select parse_status as status, count(*)::int as count from import_source_rows where import_batch_id = $1 group by parse_status',
      [batchId],
    ),
    client.query(
      'select status, count(*)::int as count from import_normalized_records where import_batch_id = $1 group by status',
      [batchId],
    ),
    client.query(
      'select review_status as status, count(*)::int as count from import_review_items where import_batch_id = $1 group by review_status',
      [batchId],
    ),
    client.query(
      'select count(*)::int as count from import_source_rows where import_batch_id = $1',
      [batchId],
    ),
    client.query(
      'select record_type, count(*)::int as count from import_normalized_records where import_batch_id = $1 group by record_type order by count(*)::int desc, record_type asc',
      [batchId],
    ),
    client.query(
      'select review_type, count(*)::int as count from import_review_items where import_batch_id = $1 group by review_type order by count(*)::int desc, review_type asc',
      [batchId],
    ),
    client.query(
      `
        select proposed_lead_json->'leadMetadata'->>'qualityDisposition' as disposition, count(*)::int as count
        from import_normalized_records
        where import_batch_id = $1
          and record_type = 'lead'
          and proposed_lead_json->'leadMetadata' ? 'qualityDisposition'
        group by 1
        order by count(*)::int desc, disposition asc
      `,
      [batchId],
    ),
    client.query(
      `
        select flag->>'code' as flag, count(*)::int as count
        from import_normalized_records,
          jsonb_array_elements(coalesce(proposed_lead_json->'leadMetadata'->'qualityFlags', '[]'::jsonb)) as flag
        where import_batch_id = $1
          and record_type = 'lead'
        group by 1
        order by count(*)::int desc, flag asc
      `,
      [batchId],
    ),
    client.query(
      `
        select
          coalesce(sr.source_sheet, 'Unknown sheet') as source_sheet,
          proposed_lead_json->'leadMetadata'->>'qualityDisposition' as disposition,
          count(*)::int as count
        from import_normalized_records nr
        join import_source_rows sr on sr.id = nr.source_row_id
        where nr.import_batch_id = $1
          and nr.record_type = 'lead'
          and nr.proposed_lead_json->'leadMetadata' ? 'qualityDisposition'
        group by 1, 2
        order by count(*)::int desc, source_sheet asc, disposition asc
      `,
      [batchId],
    ),
    client.query(
      `
        select reason, count(*)::int as count
        from (
          select
            case
              when (proposed_lead_json->'leadMetadata'->'contactability'->>'status') = 'attempted_no_answer'
                and coalesce((proposed_lead_json->'leadMetadata'->>'noAnswerAttemptCount')::int, 0) >= 2
                then '2 no-answer attempts'
              when (proposed_lead_json->'leadMetadata'->'contactability'->>'status') = 'attempted_no_answer'
                then '1 no-answer attempt'
              when (proposed_lead_json->'leadMetadata'->'contactability'->>'status') = 'no_whatsapp'
                then 'No WhatsApp signal'
              when exists (
                select 1
                from jsonb_array_elements(coalesce(proposed_lead_json->'leadMetadata'->'qualityFlags', '[]'::jsonb)) as quality_flag
                where quality_flag->>'code' = 'phone_only'
              )
                then 'Phone only / no name'
              when exists (
                select 1
                from jsonb_array_elements(coalesce(proposed_lead_json->'leadMetadata'->'qualityFlags', '[]'::jsonb)) as quality_flag
                where quality_flag->>'code' = 'source_unclear'
              )
                then 'Source unclear'
              else 'Warm no-name / operator decision'
            end as reason
          from import_normalized_records
          where import_batch_id = $1
            and record_type = 'lead'
            and proposed_lead_json->'leadMetadata'->>'qualityDisposition' = 'needs_review'
        ) reasons
        group by reason
        order by count(*)::int desc, reason asc
      `,
      [batchId],
    ),
    client.query(
      `
        select reason, count(*)::int as count
        from (
          select
            case proposed_lead_json->'leadMetadata'->'contactability'->>'status'
              when 'repeated_no_answer' then 'Repeated no-answer'
              when 'do_not_contact' then 'Do not contact / not interested'
              when 'disconnected' then 'Disconnected / unavailable'
              when 'wrong_number' then 'Wrong number'
              when 'not_current' then 'Not current / moved'
              when 'no_phone' then 'No usable phone'
              else 'Other suppress rule'
            end as reason
          from import_normalized_records
          where import_batch_id = $1
            and record_type = 'lead'
            and proposed_lead_json->'leadMetadata'->>'qualityDisposition' = 'suppress_from_follow_up'
        ) reasons
        group by reason
        order by count(*)::int desc, reason asc
      `,
      [batchId],
    ),
  ]);

  return {
    counts: {
      sourceRows: Number(sourceRowTotal.rows[0]?.count || 0),
      normalizedRecords: Number(normalizedStatusCounts.rows.reduce((sum, row) => sum + row.count, 0)),
      reviewItems: Number(reviewStatusCounts.rows.reduce((sum, row) => sum + row.count, 0)),
    },
    sourceRowStatusCounts: sourceRowStatusCounts.rows,
    normalizedStatusCounts: normalizedStatusCounts.rows,
    recordTypeCounts: recordTypeCounts.rows,
    reviewStatusCounts: reviewStatusCounts.rows,
    reviewTypeCounts: reviewTypeCounts.rows,
    qualityDispositionCounts: qualityDispositionCounts.rows,
    qualityFlagCounts: qualityFlagCounts.rows,
    qualityDispositionSheetCounts: qualityDispositionSheetCounts.rows,
    needsReviewReasonCounts: needsReviewReasonCounts.rows,
    suppressReasonCounts: suppressReasonCounts.rows,
  };
}

export function flattenImportReviewSummary(summary) {
  return [
    ...summary.sourceRowStatusCounts.map((row) => ({
      bucket: 'source_rows',
      status: row.status,
      count: row.count,
    })),
    ...summary.normalizedStatusCounts.map((row) => ({
      bucket: 'normalized_records',
      status: row.status,
      count: row.count,
    })),
    ...summary.reviewStatusCounts.map((row) => ({
      bucket: 'review_items',
      status: row.status,
      count: row.count,
    })),
  ].sort((a, b) => a.bucket.localeCompare(b.bucket) || String(a.status).localeCompare(String(b.status)));
}

export async function loadImportReviewRows(client, batchId, { status = 'all', type = 'all', quality = 'all', q = '', limit = DEFAULT_IMPORT_REVIEW_LIMIT, offset = 0 } = {}) {
  const params = [batchId];
  const clauses = ['nr.import_batch_id = $1'];

  if (status && status !== 'all') {
    params.push(status);
    clauses.push(`nr.status = $${params.length}`);
  }

  if (type && type !== 'all') {
    params.push(type);
    clauses.push(`nr.record_type = $${params.length}`);
  }

  if (quality && quality !== 'all') {
    clauses.push("nr.record_type = 'lead'");
    if (QUALITY_DISPOSITION_FILTERS.has(quality)) {
      params.push(quality);
      clauses.push(`nr.proposed_lead_json->'leadMetadata'->>'qualityDisposition' = $${params.length}`);
    } else if (QUALITY_FLAG_FILTERS[quality]) {
      params.push(QUALITY_FLAG_FILTERS[quality]);
      clauses.push(
        `exists (
          select 1
          from jsonb_array_elements(coalesce(nr.proposed_lead_json->'leadMetadata'->'qualityFlags', '[]'::jsonb)) as quality_flag
          where quality_flag->>'code' = any($${params.length}::text[])
        )`,
      );
    }
  }

  if (q) {
    const searchFields = [
      "coalesce(sr.raw_text, '')",
      "coalesce(sr.source_sheet, '')",
      "coalesce(nr.record_type, '')",
      "coalesce(nr.status, '')",
      "coalesce(nr.proposed_contact_json::text, '')",
      "coalesce(nr.proposed_lead_json::text, '')",
      "coalesce(nr.proposed_estimate_json::text, '')",
      "coalesce(nr.proposed_work_order_json::text, '')",
      "coalesce(nr.proposed_payment_json::text, '')",
      "coalesce(nr.proposed_note_json::text, '')",
    ];
    const trimmed = q.trim();
    const isWordSearch = isWordSearchTerm(trimmed);
    params.push(isWordSearch ? `(^|[^[:alnum:]])${escapePostgresRegex(trimmed)}` : `%${trimmed}%`);
    const placeholder = `$${params.length}`;
    const operator = isWordSearch ? '~*' : 'ilike';
    clauses.push(`(${searchFields.map((field) => `${field} ${operator} ${placeholder}`).join(' or ')})`);
  }

  const whereSql = clauses.join(' and ');
  const countResult = await client.query(
    `
      select count(*)::int as count
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      where ${whereSql}
    `,
    [...params],
  );
  const totalCount = Number(countResult.rows[0]?.count || 0);

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;
  const result = await client.query(
    `
      select
        nr.id,
        nr.record_type,
        nr.status,
        nr.confidence_score,
        nr.proposed_contact_json,
        nr.proposed_lead_json,
        nr.proposed_estimate_json,
        nr.proposed_work_order_json,
        nr.proposed_payment_json,
        nr.proposed_note_json,
        ib.business_unit_id,
        bu.name as business_unit_name,
        sr.id as source_row_id,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text,
        sr.parse_status,
        sr.created_at
      from import_normalized_records nr
      join import_batches ib on ib.id = nr.import_batch_id
      left join business_units bu on bu.id = ib.business_unit_id
      join import_source_rows sr on sr.id = nr.source_row_id
      where ${whereSql}
      order by
        case nr.record_type
          when 'lead' then 0
          when 'contact' then 1
          when 'work_order' then 2
          when 'estimate' then 3
          when 'payment_snapshot' then 4
          when 'note' then 5
          when 'activity_event' then 6
          else 9
        end asc,
        coalesce(nr.confidence_score, 0)::numeric desc,
        sr.source_sheet asc,
        sr.source_row_number asc
      limit ${limitPlaceholder}
      offset ${offsetPlaceholder}
    `,
    params,
  );

  const sourceRowIds = [...new Set(result.rows.map((row) => row.source_row_id).filter(Boolean))];
  const reviewBySourceRow = await loadReviewItemsBySourceRow(client, batchId, sourceRowIds);

  const rows = result.rows.map((row) => ({
    ...row,
    confidenceScore: row.confidence_score === null || row.confidence_score === undefined ? null : Number(row.confidence_score),
    reviewItems: reviewBySourceRow.get(row.source_row_id) || [],
  }));

  return {
    rows,
    pagination: {
      totalCount,
      limit,
      offset,
      returnedCount: rows.length,
      hasPreviousPage: offset > 0,
      hasNextPage: offset + rows.length < totalCount,
    },
  };
}

export async function loadImportReviewDecisionRows(client, batchId, { status = 'pending', type = 'all', q = '', limit = DEFAULT_IMPORT_REVIEW_LIMIT, offset = 0 } = {}) {
  const params = [batchId];
  const clauses = ['iri.import_batch_id = $1'];

  if (status && status !== 'all') {
    params.push(status);
    clauses.push(`iri.review_status = $${params.length}`);
  }

  if (type && type !== 'all') {
    params.push(type);
    clauses.push(`iri.review_type = $${params.length}`);
  }

  if (q) {
    const searchFields = [
      "coalesce(sr.raw_text, '')",
      "coalesce(sr.source_sheet, '')",
      "coalesce(iri.review_type, '')",
      "coalesce(iri.reason, '')",
      "coalesce(iri.review_status, '')",
      "coalesce(iri.proposed_resolution_json::text, '')",
    ];
    const trimmed = q.trim();
    const isWordSearch = isWordSearchTerm(trimmed);
    params.push(isWordSearch ? `(^|[^[:alnum:]])${escapePostgresRegex(trimmed)}` : `%${trimmed}%`);
    const placeholder = `$${params.length}`;
    const operator = isWordSearch ? '~*' : 'ilike';
    clauses.push(`(${searchFields.map((field) => `${field} ${operator} ${placeholder}`).join(' or ')})`);
  }

  params.push(AIT_SIGNS_DECISION_SHEETS);
  const aitSignsSheetsPlaceholder = `$${params.length}`;
  params.push(AIT_SIGNS_DECISION_TYPES);
  const aitSignsTypesPlaceholder = `$${params.length}`;
  clauses.push(`
    (
      (
        lower(coalesce(ib.source_name, '')) not like '%ait signs%'
        and lower(coalesce(ib.file_name, '')) not like '%signs%'
      )
      or (
        sr.source_sheet = any(${aitSignsSheetsPlaceholder}::text[])
        and iri.review_type = any(${aitSignsTypesPlaceholder}::text[])
      )
    )
  `);

  const whereSql = clauses.join(' and ');
  const countResult = await client.query(
    `
      select count(*)::int as count
      from import_review_items iri
      join import_batches ib on ib.id = iri.import_batch_id
      join import_source_rows sr on sr.id = iri.source_row_id
      where ${whereSql}
    `,
    [...params],
  );
  const totalCount = Number(countResult.rows[0]?.count || 0);

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;
  const result = await client.query(
    `
      select
        iri.id,
        iri.source_row_id,
        iri.review_type,
        iri.reason,
        iri.review_status,
        iri.proposed_resolution_json,
        iri.created_at,
        ib.business_unit_id,
        bu.name as business_unit_name,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text,
        sr.parse_status,
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
      join import_batches ib on ib.id = iri.import_batch_id
      left join business_units bu on bu.id = ib.business_unit_id
      join import_source_rows sr on sr.id = iri.source_row_id
      left join import_normalized_records nr on nr.source_row_id = sr.id
        and nr.import_batch_id = iri.import_batch_id
      where ${whereSql}
      group by iri.id, ib.business_unit_id, bu.name, sr.id
      order by
        case iri.review_status
          when 'pending' then 0
          when 'needs_review' then 1
          else 2
        end asc,
        sr.source_sheet asc,
        sr.source_row_number asc,
        iri.created_at desc
      limit ${limitPlaceholder}
      offset ${offsetPlaceholder}
    `,
    params,
  );

  return {
    rows: result.rows.map((row) => ({
      id: row.id,
      reviewItemId: row.id,
      source_row_id: row.source_row_id,
      record_type: row.review_type,
      status: row.review_status,
      confidenceScore: null,
      confidence_score: null,
      proposed_contact_json: row.proposed_resolution_json || {},
      proposed_lead_json: null,
      proposed_estimate_json: null,
      proposed_work_order_json: null,
      proposed_payment_json: null,
      proposed_note_json: null,
      business_unit_id: row.business_unit_id,
      business_unit_name: row.business_unit_name,
      source_sheet: row.source_sheet,
      source_row_number: row.source_row_number,
      raw_text: row.raw_text,
      parse_status: row.parse_status,
      created_at: row.created_at,
      isDecisionRow: true,
      decisionType: row.review_type,
      decisionReason: row.reason,
      proposedResolution: row.proposed_resolution_json || {},
      normalizedEvidence: row.normalized_evidence_json || [],
      reviewItems: [{
        id: row.id,
        review_type: row.review_type,
        reason: row.reason,
        review_status: row.review_status,
        proposed_resolution_json: row.proposed_resolution_json,
        created_at: row.created_at,
      }],
    })),
    pagination: {
      totalCount,
      limit,
      offset,
      returnedCount: result.rows.length,
      hasPreviousPage: offset > 0,
      hasNextPage: offset + result.rows.length < totalCount,
    },
  };
}

export async function updateImportReviewStatus(client, {
  batchId,
  status,
  recordIds = [],
  reviewItemIds = [],
  rowSelector = null,
  reason = null,
  operatorDecisionAction = null,
  organizationId = null,
}) {
  if (!VALID_IMPORT_REVIEW_STATUSES.has(status)) {
    throw new Error('Invalid review status.');
  }
  if (status === 'approved' && reviewItemIds.length) {
    throw new Error('Source-row decisions cannot be marked approved without an explicit CRM attach, create, or promotion action.');
  }

  const resolvedBatchId = await resolveImportReviewBatchId(client, batchId, { organizationId });

  await client.query('begin');
  try {
    const batch = await loadImportReviewBatch(client, resolvedBatchId);
    if (status === 'approved' && recordIds.length && OPERATOR_REVIEW_SOURCE_TYPES.includes(batch?.sourceType) && !batch?.businessUnitId) {
      throw new Error('Import batch must have a business unit before approval.');
    }

    if (reviewItemIds.length) {
      const reviewItemResult = await updateImportReviewItemsOnly(client, resolvedBatchId, {
        status,
        reviewItemIds,
        reason,
        operatorDecisionAction,
        organizationId,
      });

      await client.query('commit');
      return {
        batchId: resolvedBatchId,
        status,
        updatedIds: [],
        updatedRecords: [],
        sourceRowIds: reviewItemResult.sourceRowIds,
        updatedReviewItems: reviewItemResult.updatedIds.length,
        updatedReviewItemIds: reviewItemResult.updatedIds,
        promotedRecords: [],
      };
    }

    const records = await findRecordsForStatusUpdate(client, resolvedBatchId, { recordIds, rowSelector, organizationId });
    if (!records.length) {
      await client.query('commit');
      return {
        batchId: resolvedBatchId,
        status,
        updatedIds: [],
        updatedRecords: [],
        sourceRowIds: [],
        updatedReviewItems: 0,
      };
    }

    const updateIds = records.map((row) => row.id);
    const sourceRowIds = [...new Set(records.map((row) => row.source_row_id).filter(Boolean))];
    const updateResult = await client.query(
      `
        update import_normalized_records
        set status = $1
        where import_batch_id = $2
          and id = any($3::uuid[])
        returning id, record_type, status
      `,
      [status, resolvedBatchId, updateIds],
    );

    let updatedReviewItems = 0;
    if (sourceRowIds.length) {
      const reviewResult = await client.query(
        `
          update import_review_items
          set
            review_status = $1,
            proposed_resolution_json = case
              when $4::jsonb is null then proposed_resolution_json
              else coalesce(proposed_resolution_json, '{}'::jsonb) || $4::jsonb
            end,
            reviewed_at = now()
          where import_batch_id = $2
            and source_row_id = any($3::uuid[])
        `,
        [
          status,
          resolvedBatchId,
          sourceRowIds,
          reason ? JSON.stringify({ operatorReason: reason }) : null,
        ],
      );
      updatedReviewItems = reviewResult.rowCount;
    }

    let promotedRecords = [];
    if (status === 'approved') {
      promotedRecords = await promoteApprovedFacebookLeadRecords(client, resolvedBatchId, records);
    }

    await client.query('commit');

    return {
      batchId: resolvedBatchId,
      status,
      updatedIds: updateResult.rows.map((row) => row.id),
      updatedRecords: updateResult.rows,
      sourceRowIds,
      updatedReviewItems,
      promotedRecords,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function updateImportReviewItemsOnly(client, batchId, {
  status,
  reviewItemIds = [],
  reason = null,
  operatorDecisionAction = null,
  organizationId = null,
}) {
  const reviewPatch = buildOperatorReviewPatch({ reason, operatorDecisionAction, status });
  const params = [
    status,
    batchId,
    reviewItemIds,
    reviewPatch ? JSON.stringify(reviewPatch) : null,
  ];
  const organizationClause = organizationId ? `and ib.organization_id = $${params.push(organizationId)}` : '';
  const result = await client.query(
    `
      update import_review_items iri
      set
        review_status = $1,
        proposed_resolution_json = case
          when $4::jsonb is null then proposed_resolution_json
          else coalesce(proposed_resolution_json, '{}'::jsonb) || $4::jsonb
        end,
        reviewed_at = now()
      from import_batches ib
      where ib.id = iri.import_batch_id
        and iri.import_batch_id = $2
        and iri.id = any($3::uuid[])
        ${organizationClause}
      returning iri.id, iri.source_row_id
    `,
    params,
  );

  return {
    updatedIds: result.rows.map((row) => row.id),
    sourceRowIds: [...new Set(result.rows.map((row) => row.source_row_id).filter(Boolean))],
  };
}

function buildOperatorReviewPatch({ reason = null, operatorDecisionAction = null, status = null } = {}) {
  const patch = {};
  if (reason) patch.operatorReason = reason;
  if (operatorDecisionAction) {
    patch.operatorDecision = {
      action: operatorDecisionAction,
      status,
      recordedAt: new Date().toISOString(),
    };
  }
  return Object.keys(patch).length ? patch : null;
}

function isPendingFacebookLeadRecord(record) {
  const proposedLead = record.proposed_lead_json || {};
  return record.record_type === 'lead'
    && proposedLead.source_type === 'facebook_webhook'
    && proposedLead.lead_id === null;
}

async function promoteApprovedFacebookLeadRecords(client, batchId, records) {
  const promotedRecords = [];
  const facebookLeadRecords = records.filter(isPendingFacebookLeadRecord);

  for (const record of facebookLeadRecords) {
    const crmWrite = await promoteFacebookLeadProposalToCrm(client, record.organization_id, {
      proposedContact: record.proposed_contact_json || {},
      proposedLead: record.proposed_lead_json || {},
      sourceRowId: record.source_row_id,
      rowNumber: record.source_row_number,
    });

    if (!crmWrite.leadId) {
      throw new Error(`Facebook lead ${record.id} could not be promoted: ${crmWrite.reason || 'unknown reason'}.`);
    }

    const nextContact = {
      ...(record.proposed_contact_json || {}),
      contact_id: crmWrite.contactId,
    };
    const nextLead = {
      ...(record.proposed_lead_json || {}),
      contact_id: crmWrite.contactId,
      lead_id: crmWrite.leadId,
      assigned_user_id: crmWrite.assignedUserId || null,
      notes: 'Import review approved and promoted to CRM lead.',
    };

    await client.query(
      `
        update import_normalized_records
        set
          proposed_contact_json = $3::jsonb,
          proposed_lead_json = $4::jsonb,
          status = 'promoted'
        where import_batch_id = $1
          and id = $2
      `,
      [batchId, record.id, JSON.stringify(nextContact), JSON.stringify(nextLead)],
    );

    promotedRecords.push({
      id: record.id,
      sourceRowId: record.source_row_id,
      contactId: crmWrite.contactId,
      leadId: crmWrite.leadId,
    });
  }

  return promotedRecords;
}

async function loadReviewItemsBySourceRow(client, batchId, sourceRowIds) {
  const reviewBySourceRow = new Map();
  if (!sourceRowIds.length) return reviewBySourceRow;

  const reviewItems = await client.query(
    `
      select
        source_row_id,
        review_type,
        reason,
        review_status,
        proposed_resolution_json,
        created_at
      from import_review_items
      where import_batch_id = $1
        and source_row_id = any($2::uuid[])
      order by created_at desc
    `,
    [batchId, sourceRowIds],
  );

  for (const item of reviewItems.rows) {
    const list = reviewBySourceRow.get(item.source_row_id) || [];
    list.push(item);
    reviewBySourceRow.set(item.source_row_id, list);
  }

  return reviewBySourceRow;
}

async function findRecordsForStatusUpdate(client, batchId, { recordIds, rowSelector, organizationId = null }) {
  if (recordIds.length) {
    const params = organizationId ? [batchId, recordIds, organizationId] : [batchId, recordIds];
    const result = await client.query(
      `
        select
          nr.id,
          nr.source_row_id,
          sr.source_row_number,
          ib.organization_id,
          nr.record_type,
          nr.proposed_contact_json,
          nr.proposed_lead_json
        from import_normalized_records nr
        join import_batches ib on ib.id = nr.import_batch_id
        join import_source_rows sr on sr.id = nr.source_row_id
        where nr.import_batch_id = $1
          and nr.id = any($2::uuid[])
          ${organizationId ? 'and ib.organization_id = $3' : ''}
      `,
      params,
    );
    return result.rows;
  }

  if (rowSelector?.sheet && Number.isInteger(rowSelector.rowNumber)) {
    const params = organizationId
      ? [batchId, rowSelector.sheet, rowSelector.rowNumber, organizationId]
      : [batchId, rowSelector.sheet, rowSelector.rowNumber];
    const result = await client.query(
      `
        select
          nr.id,
          nr.source_row_id,
          sr.source_row_number,
          ib.organization_id,
          nr.record_type,
          nr.proposed_contact_json,
          nr.proposed_lead_json
        from import_normalized_records nr
        join import_batches ib on ib.id = nr.import_batch_id
        join import_source_rows sr on sr.id = nr.source_row_id
        where nr.import_batch_id = $1
          and sr.source_sheet = $2
          and sr.source_row_number = $3
          ${organizationId ? 'and ib.organization_id = $4' : ''}
        order by nr.record_type asc, nr.id asc
      `,
      params,
    );
    return result.rows;
  }

  throw new Error('recordIds or rowSelector is required.');
}
