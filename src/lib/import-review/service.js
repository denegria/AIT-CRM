import { promoteFacebookLeadProposalToCrm } from '../ingestion/facebook-lead-ads.js';

export const DEFAULT_IMPORT_REVIEW_LIMIT = 120;
export const VALID_IMPORT_REVIEW_STATUSES = new Set(['approved', 'rejected', 'pending', 'needs_review']);

const MAX_IMPORT_REVIEW_LIMIT = 250;
const DEFAULT_SAMPLE_LIMIT = 10;
const OPERATOR_REVIEW_SOURCE_TYPES = ['xlsx', 'csv', 'spreadsheet'];
const REVIEWABLE_RECORD_STATUSES = ['pending', 'needs_review'];
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
        count(nr.id) filter (where nr.status in ('pending', 'needs_review'))::int as reviewable_count
      from import_batches ib
      left join business_units bu on bu.id = ib.business_unit_id
      left join import_normalized_records nr on nr.import_batch_id = ib.id
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

export async function updateImportReviewStatus(client, {
  batchId,
  status,
  recordIds = [],
  rowSelector = null,
  reason = null,
  organizationId = null,
}) {
  if (!VALID_IMPORT_REVIEW_STATUSES.has(status)) {
    throw new Error('Invalid review status.');
  }

  const resolvedBatchId = await resolveImportReviewBatchId(client, batchId, { organizationId });

  await client.query('begin');
  try {
    const batch = await loadImportReviewBatch(client, resolvedBatchId);
    if (status === 'approved' && OPERATOR_REVIEW_SOURCE_TYPES.includes(batch?.sourceType) && !batch?.businessUnitId) {
      throw new Error('Import batch must have a business unit before approval.');
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
