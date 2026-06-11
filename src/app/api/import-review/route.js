import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { hasConfiguredAdminToken, isAdminTokenUnlockEnabled, isImportReviewAdmin } from '@/lib/admin-guard';
import { getRequestSession, hasPermission, isAuthEnabled, PERMISSIONS } from '@/lib/auth';
import { isUuid } from '@/lib/crm/validation.js';
import {
  VALID_IMPORT_REVIEW_STATUSES,
  listImportReviewBatches,
  loadImportReviewBatch,
  loadImportReviewDecisionRows,
  loadImportReviewRows,
  loadImportReviewSummary,
  normalizeImportReviewText,
  normalizeQualityFilter,
  parseImportReviewLimit,
  parseImportReviewOffset,
  resolveImportReviewBatchId,
  updateImportReviewStatus,
} from '@/lib/import-review/service.js';

const VALID_DECISION_ACTIONS = new Set([
  'discard_source_row',
  'hold_for_future_action',
  'attach_existing_later',
  'create_crm_record_later',
  'promote_import_later',
]);

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
    if (hasPermission(session, permission)) {
      return {
        error: null,
        organizationId: session.user.organizationId,
      };
    }
  }

  if (isAdminTokenUnlockEnabled() && hasConfiguredAdminToken() && isImportReviewAdmin(request)) {
    return { error: null, organizationId: null };
  }

  if (!isAuthEnabled()) {
    return {
      error: NextResponse.json(
        { error: 'Real auth/RBAC is required before import review can be accessed.' },
        { status: 503 },
      ),
      organizationId: null,
    };
  }

  return {
    error: NextResponse.json(
      { error: 'Import-review permission required.' },
      { status: 401 },
    ),
    organizationId: null,
  };
}

export async function GET(request) {
  const auth = await requireImportReviewAdmin(request, PERMISSIONS.IMPORT_REVIEW_READ);
  if (auth.error) return auth.error;

  try {
    return await withClient(async (client) => {
      const url = new URL(request.url);
      const businessUnitId = url.searchParams.get('businessUnitId');
      if (businessUnitId && businessUnitId !== 'all' && !isUuid(businessUnitId)) {
        return NextResponse.json({ error: 'A valid businessUnitId is required.' }, { status: 400 });
      }

      const batchId = await resolveImportReviewBatchId(client, url.searchParams.get('batchId'), {
        organizationId: auth.organizationId,
        businessUnitId: businessUnitId && businessUnitId !== 'all' ? businessUnitId : null,
      });
      const batch = await loadImportReviewBatch(client, batchId);
      const summary = await loadImportReviewSummary(client, batchId);
      const batches = await listImportReviewBatches(client, {
        organizationId: auth.organizationId,
        businessUnitId: businessUnitId && businessUnitId !== 'all' ? businessUnitId : null,
      });
      const { rows, pagination } = await loadImportReviewRows(client, batchId, {
        status: normalizeImportReviewText(url.searchParams.get('status')),
        type: normalizeImportReviewText(url.searchParams.get('type')),
        quality: normalizeQualityFilter(url.searchParams.get('quality')),
        q: normalizeImportReviewText(url.searchParams.get('q'), ''),
        limit: parseImportReviewLimit(url.searchParams.get('limit')),
        offset: parseImportReviewOffset(url.searchParams.get('offset')),
      });
      const { rows: decisionRows, pagination: decisionPagination } = await loadImportReviewDecisionRows(client, batchId, {
        status: normalizeImportReviewText(url.searchParams.get('status'), 'pending'),
        type: normalizeImportReviewText(url.searchParams.get('decisionType'), 'all'),
        q: normalizeImportReviewText(url.searchParams.get('q'), ''),
        limit: parseImportReviewLimit(url.searchParams.get('limit')),
        offset: parseImportReviewOffset(url.searchParams.get('offset')),
      });
      const useDecisionRows = decisionRows.length > 0 || (url.searchParams.get('view') === 'decisions' && decisionPagination.totalCount > 0);

      return NextResponse.json({
        batch,
        batches,
        summary,
        rows: useDecisionRows ? decisionRows : rows,
        pagination: useDecisionRows ? decisionPagination : pagination,
        reviewMode: useDecisionRows ? 'decisions' : 'normalized_records',
        decisionPagination,
        normalizedPagination: pagination,
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
  const auth = await requireImportReviewAdmin(request, PERMISSIONS.IMPORT_REVIEW_WRITE);
  if (auth.error) return auth.error;

  try {
    return await withClient(async (client) => {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'JSON object body is required.' }, { status: 400 });
      }

      const status = normalizeImportReviewText(body.status, '');
      const batchId = body.batchId ? String(body.batchId) : null;
      const recordIds = Array.isArray(body.recordIds)
        ? [...new Set(body.recordIds.map((id) => String(id)).filter(Boolean))]
        : [];
      const reviewItemIds = Array.isArray(body.reviewItemIds)
        ? [...new Set(body.reviewItemIds.map((id) => String(id)).filter(Boolean))]
        : [];

      if (!VALID_IMPORT_REVIEW_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Invalid review status.' }, { status: 400 });
      }

      if (!recordIds.length && !reviewItemIds.length) {
        return NextResponse.json({ error: 'recordIds or reviewItemIds must be a non-empty array.' }, { status: 400 });
      }
      if (recordIds.length && reviewItemIds.length) {
        return NextResponse.json({ error: 'Update normalized records and review items separately.' }, { status: 400 });
      }
      if (batchId && !isUuid(batchId)) {
        return NextResponse.json({ error: 'A valid batchId is required.' }, { status: 400 });
      }
      if (recordIds.some((recordId) => !isUuid(recordId))) {
        return NextResponse.json({ error: 'recordIds must contain only valid UUIDs.' }, { status: 400 });
      }
      if (reviewItemIds.some((reviewItemId) => !isUuid(reviewItemId))) {
        return NextResponse.json({ error: 'reviewItemIds must contain only valid UUIDs.' }, { status: 400 });
      }
      if (reviewItemIds.length && status === 'approved') {
        return NextResponse.json(
          { error: 'Source-row decisions cannot be marked approved without an explicit CRM attach, create, or promotion action.' },
          { status: 400 },
        );
      }
      const operatorDecisionAction = body.operatorDecisionAction ? String(body.operatorDecisionAction) : null;
      if (operatorDecisionAction && !VALID_DECISION_ACTIONS.has(operatorDecisionAction)) {
        return NextResponse.json({ error: 'Invalid source-row decision action.' }, { status: 400 });
      }

      const result = await updateImportReviewStatus(client, {
        batchId,
        status,
        recordIds,
        reviewItemIds,
        operatorDecisionAction,
        organizationId: auth.organizationId,
      });

      if (!result.updatedIds.length && !result.updatedReviewItemIds?.length) {
        return NextResponse.json({ error: 'No matching staged records found.' }, { status: 404 });
      }

      return NextResponse.json(result);
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to update staged records.' },
      { status: 500 },
    );
  }
}
