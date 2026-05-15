import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { ADMIN_TOKEN_ENV, hasConfiguredAdminToken, isImportReviewAdmin } from '@/lib/admin-guard';
import { getRequestSession, hasPermission, isAuthEnabled, PERMISSIONS } from '@/lib/auth';

const DEFAULT_LIMIT = 120;
const VALID_PATCH_STATUSES = new Set(['approved', 'rejected', 'pending', 'needs_review']);

function parseLimit(rawLimit) {
  const value = Number(rawLimit);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(250, Math.floor(value)));
}

function normalizeText(value, fallback = 'all') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'DATABASE_URL is required to access import review data.' },
      { status: 503 },
    );
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function requireImportReviewAdmin(request, permission) {
  if (isAuthEnabled()) {
    const session = await getRequestSession(request);
    if (hasPermission(session, permission)) return null;
  }

  if (hasConfiguredAdminToken() && isImportReviewAdmin(request)) return null;

  if (!hasConfiguredAdminToken() && !isAuthEnabled()) {
    return NextResponse.json(
      { error: `${ADMIN_TOKEN_ENV} or real auth/RBAC is required before import review can be accessed.` },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: 'Admin unlock or import-review permission required.' },
    { status: 401 },
  );
}

async function resolveBatchId(client, batchId) {
  if (batchId) return batchId;
  const result = await client.query(
    'select ib.id ' +
    'from import_batches ib ' +
    'where exists (select 1 from import_normalized_records nr where nr.import_batch_id = ib.id and nr.status in (\'pending\', \'needs_review\')) ' +
    'order by ib.created_at desc limit 1',
  );
  if (result.rows[0]?.id) return result.rows[0].id;

  const fallback = await client.query('select id from import_batches order by created_at desc limit 1');
  const resolved = fallback.rows[0]?.id;
  if (!resolved) {
    throw new Error('No import batch found.');
  }
  return resolved;
}

async function loadSummary(client, batchId) {
  const [
    sourceRows,
    normalizedRecords,
    reviewItems,
    statusCounts,
    recordTypeCounts,
    reviewStatusCounts,
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
      sourceRows: Number(sourceRows.rows.reduce((sum, row) => sum + row.count, 0)),
      normalizedRecords: Number(normalizedRecords.rows.reduce((sum, row) => sum + row.count, 0)),
      reviewItems: Number(reviewItems.rows.reduce((sum, row) => sum + row.count, 0)),
    },
    sourceRowStatusCounts: sourceRows.rows,
    normalizedStatusCounts: statusCounts.rows,
    recordTypeCounts: recordTypeCounts.rows,
    reviewStatusCounts: reviewStatusCounts.rows,
  };
}

async function loadRows(client, batchId, { status, type, q, limit }) {
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
      order by created_at desc
    `,
    [batchId],
  );

  const reviewBySourceRow = new Map();
  for (const item of reviewItems.rows) {
    const list = reviewBySourceRow.get(item.source_row_id) || [];
    list.push(item);
    reviewBySourceRow.set(item.source_row_id, list);
  }

  return result.rows.map((row) => ({
    ...row,
    confidenceScore: row.confidence_score === null || row.confidence_score === undefined ? null : Number(row.confidence_score),
    reviewItems: reviewBySourceRow.get(row.source_row_id) || [],
  }));
}

export async function GET(request) {
  const authError = await requireImportReviewAdmin(request, PERMISSIONS.IMPORT_REVIEW_READ);
  if (authError) return authError;

  try {
    return await withClient(async (client) => {
      const url = new URL(request.url);
      const batchId = await resolveBatchId(client, url.searchParams.get('batchId'));
      const summary = await loadSummary(client, batchId);
      const rows = await loadRows(client, batchId, {
        status: normalizeText(url.searchParams.get('status')),
        type: normalizeText(url.searchParams.get('type')),
        q: normalizeText(url.searchParams.get('q'), ''),
        limit: parseLimit(url.searchParams.get('limit')),
      });

      const batchResult = await client.query(
        `
          select id, source_name, source_type, file_name, file_hash, sheet_name, status, created_at
          from import_batches
          where id = $1
        `,
        [batchId],
      );

      const batch = batchResult.rows[0];

      return NextResponse.json({
        batch: batch ? {
          id: batch.id,
          sourceName: batch.source_name,
          sourceType: batch.source_type,
          fileName: batch.file_name,
          fileHash: batch.file_hash,
          sheetName: batch.sheet_name,
          status: batch.status,
          createdAt: batch.created_at,
        } : null,
        summary,
        rows,
      });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to load import review data.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request) {
  const authError = await requireImportReviewAdmin(request, PERMISSIONS.IMPORT_REVIEW_WRITE);
  if (authError) return authError;

  try {
    return await withClient(async (client) => {
      const body = await request.json();
      const status = normalizeText(body.status, '');
      const batchId = body.batchId || null;
      const recordIds = Array.isArray(body.recordIds)
        ? [...new Set(body.recordIds.map((id) => String(id)).filter(Boolean))]
        : [];

      if (!VALID_PATCH_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Invalid review status.' }, { status: 400 });
      }

      if (!recordIds.length) {
        return NextResponse.json({ error: 'recordIds must be a non-empty array.' }, { status: 400 });
      }

      const resolvedBatchId = await resolveBatchId(client, batchId);

      await client.query('begin');
      try {
        const lookup = await client.query(
          `
            select id, source_row_id
            from import_normalized_records
            where import_batch_id = $1
              and id = any($2::uuid[])
          `,
          [resolvedBatchId, recordIds],
        );

        if (!lookup.rows.length) {
          await client.query('rollback');
          return NextResponse.json({ error: 'No matching staged records found.' }, { status: 404 });
        }

        const sourceRowIds = [...new Set(lookup.rows.map((row) => row.source_row_id).filter(Boolean))];

        const updateResult = await client.query(
          `
            update import_normalized_records
            set status = $1
            where import_batch_id = $2
              and id = any($3::uuid[])
            returning id
          `,
          [status, resolvedBatchId, recordIds],
        );

        if (sourceRowIds.length) {
          await client.query(
            `
              update import_review_items
              set review_status = $1,
                  reviewed_at = now()
              where import_batch_id = $2
                and source_row_id = any($3::uuid[])
            `,
            [status, resolvedBatchId, sourceRowIds],
          );
        }

        await client.query('commit');

        return NextResponse.json({
          batchId: resolvedBatchId,
          status,
          updatedIds: updateResult.rows.map((row) => row.id),
          sourceRowIds,
        });
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to update staged records.' },
      { status: 500 },
    );
  }
}
