import { promoteFacebookLeadProposalToCrm } from '../ingestion/facebook-lead-ads.js';

export const DEFAULT_IMPORT_REVIEW_LIMIT = 120;
export const VALID_IMPORT_REVIEW_STATUSES = new Set(['approved', 'rejected', 'pending', 'needs_review']);

const MAX_IMPORT_REVIEW_LIMIT = 250;
const DEFAULT_SAMPLE_LIMIT = 10;
const OPERATOR_REVIEW_SOURCE_TYPES = ['xlsx', 'csv', 'spreadsheet'];
const REVIEWABLE_RECORD_STATUSES = ['pending', 'needs_review'];

export function parseImportReviewLimit(rawLimit, fallback = DEFAULT_IMPORT_REVIEW_LIMIT) {
  const value = Number(rawLimit);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_IMPORT_REVIEW_LIMIT, Math.floor(value)));
}

export function parseImportReviewSampleLimit(rawLimit) {
  return parseImportReviewLimit(rawLimit, DEFAULT_SAMPLE_LIMIT);
}

export function normalizeImportReviewText(value, fallback = 'all') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

export async function resolveImportReviewBatchId(client, batchId, { organizationId = null } = {}) {
  if (batchId) {
    if (!organizationId) return batchId;

    const scopedBatch = await client.query(
      'select id from import_batches where id = $1 and organization_id = $2 limit 1',
      [batchId, organizationId],
    );
    const resolved = scopedBatch.rows[0]?.id;
    if (!resolved) throw new Error('No import batch found.');
    return resolved;
  }

  const organizationClause = organizationId ? 'and ib.organization_id = $3 ' : '';
  const batchParams = organizationId
    ? [OPERATOR_REVIEW_SOURCE_TYPES, REVIEWABLE_RECORD_STATUSES, organizationId]
    : [OPERATOR_REVIEW_SOURCE_TYPES, REVIEWABLE_RECORD_STATUSES];

  const preferredPending = await client.query(
    'select ib.id ' +
    'from import_batches ib ' +
    'where ib.source_type = any($1::text[]) ' +
    'and exists (select 1 from import_normalized_records nr where nr.import_batch_id = ib.id and nr.status = any($2::text[])) ' +
    organizationClause +
    'order by ib.created_at desc limit 1',
    batchParams,
  );
  if (preferredPending.rows[0]?.id) return preferredPending.rows[0].id;

  const pendingParams = organizationId ? [REVIEWABLE_RECORD_STATUSES, organizationId] : [REVIEWABLE_RECORD_STATUSES];
  const anyPending = await client.query(
    'select ib.id ' +
    'from import_batches ib ' +
    'where exists (select 1 from import_normalized_records nr where nr.import_batch_id = ib.id and nr.status = any($1::text[])) ' +
    (organizationId ? 'and ib.organization_id = $2 ' : '') +
    'order by ib.created_at desc limit 1',
    pendingParams,
  );
  if (anyPending.rows[0]?.id) return anyPending.rows[0].id;

  const fallbackParams = organizationId ? [OPERATOR_REVIEW_SOURCE_TYPES, organizationId] : [OPERATOR_REVIEW_SOURCE_TYPES];
  const preferredFallback = await client.query(
    'select id from import_batches where source_type = any($1::text[]) ' +
    (organizationId ? 'and organization_id = $2 ' : '') +
    'order by created_at desc limit 1',
    fallbackParams,
  );
  if (preferredFallback.rows[0]?.id) return preferredFallback.rows[0].id;

  const fallback = await client.query(
    'select id from import_batches ' +
    (organizationId ? 'where organization_id = $1 ' : '') +
    'order by created_at desc limit 1',
    organizationId ? [organizationId] : [],
  );
  const resolved = fallback.rows[0]?.id;
  if (!resolved) {
    throw new Error('No import batch found.');
  }
  return resolved;
}

export async function loadImportReviewBatch(client, batchId) {
  const result = await client.query(
    `
      select id, source_name, source_type, file_name, file_hash, sheet_name, status, created_at
      from import_batches
      where id = $1
    `,
    [batchId],
  );

  const batch = result.rows[0];
  if (!batch) return null;

  return {
    id: batch.id,
    sourceName: batch.source_name,
    sourceType: batch.source_type,
    fileName: batch.file_name,
    fileHash: batch.file_hash,
    sheetName: batch.sheet_name,
    status: batch.status,
    createdAt: batch.created_at,
  };
}

export async function loadImportReviewSummary(client, batchId) {
  const [
    sourceRowStatusCounts,
    normalizedStatusCounts,
    reviewStatusCounts,
    sourceRowTotal,
    recordTypeCounts,
    reviewTypeCounts,
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

export async function loadImportReviewRows(client, batchId, { status = 'all', type = 'all', q = '', limit = DEFAULT_IMPORT_REVIEW_LIMIT } = {}) {
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

  if (q) {
    params.push(`%${q}%`);
    const placeholder = `$${params.length}`;
    clauses.push(`(
      coalesce(sr.raw_text, '') ilike ${placeholder}
      or coalesce(sr.source_sheet, '') ilike ${placeholder}
      or coalesce(nr.record_type, '') ilike ${placeholder}
      or coalesce(nr.status, '') ilike ${placeholder}
    )`);
  }

  params.push(limit);
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
        sr.id as source_row_id,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text,
        sr.parse_status,
        sr.created_at
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      where ${clauses.join(' and ')}
      order by
        coalesce(nr.confidence_score, 999)::numeric asc,
        sr.source_sheet asc,
        sr.source_row_number asc
      limit $${params.length}
    `,
    params,
  );

  const sourceRowIds = [...new Set(result.rows.map((row) => row.source_row_id).filter(Boolean))];
  const reviewBySourceRow = await loadReviewItemsBySourceRow(client, batchId, sourceRowIds);

  return result.rows.map((row) => ({
    ...row,
    confidenceScore: row.confidence_score === null || row.confidence_score === undefined ? null : Number(row.confidence_score),
    reviewItems: reviewBySourceRow.get(row.source_row_id) || [],
  }));
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
