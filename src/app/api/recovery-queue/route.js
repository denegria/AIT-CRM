import { NextResponse } from 'next/server';
import { getDb, getPool } from '@/db/index.js';
import { businessUnits } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { canManageAitUsaAssignments } from '@/lib/crm/ait-usa-assignment-policy.js';
import {
  isRegularCoordinatorSession,
  resolveBusinessUnitId,
} from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { buildRecoveryQueuePayload, normalizeRecoveryQueueRequest } from '@/lib/recovery-queue/model.js';
import { loadRecoveryQueue } from '@/lib/recovery-queue/service.js';

function value(searchParams, key) {
  return String(searchParams.get(key) || '').trim();
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const requestedBusinessUnitId = value(searchParams, 'businessUnitId');
  const canViewUnassigned = canManageAitUsaAssignments(session);
  const queueRequest = normalizeRecoveryQueueRequest({
    lane: value(searchParams, 'lane'),
    page: value(searchParams, 'page'),
    pageSize: value(searchParams, 'pageSize'),
    canViewUnassigned,
  });
  const regularCoordinatorUserId = isRegularCoordinatorSession(session)
    ? session.user.id
    : null;

  let client;
  try {
    let businessUnitIds = session.user.canAccessAllBusinessUnits
      ? null
      : session.user.businessUnitIds;
    if (requestedBusinessUnitId) {
      const businessUnitId = await resolveBusinessUnitId({
        db: getDb(),
        session,
        businessUnitsTable: businessUnits,
        requestedId: requestedBusinessUnitId,
      });
      businessUnitIds = [businessUnitId];
    }

    client = await getPool().connect();
    const result = await loadRecoveryQueue(client, {
      organizationId: session.user.organizationId,
      regularCoordinatorUserId,
      businessUnitIds,
      canViewUnassigned,
      lane: queueRequest.lane,
      page: queueRequest.page,
      pageSize: queueRequest.pageSize,
    });
    return NextResponse.json({
      ...buildRecoveryQueuePayload(result.rows, queueRequest, result.counts),
      scope: {
        businessUnitIds,
        ownerUserId: regularCoordinatorUserId,
        canViewUnassigned,
      },
    });
  } catch (err) {
    return crmErrorResponse(err);
  } finally {
    client?.release();
  }
}
