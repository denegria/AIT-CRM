import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server.js';

import { getDb, getPool } from '@/db/index.js';
import { businessUnits } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { resolveBusinessUnitId } from '@/lib/crm/access.js';
import { crmErrorResponse, createCrmError } from '@/lib/crm/errors.js';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { loadBookFulfillmentQueue, transitionBookFulfillment } from '@/lib/fulfillment/service.js';

function searchValue(searchParams, key) {
  return String(searchParams.get(key) || '').trim();
}

async function assertAitUsaScope(db, session, businessUnitId) {
  const [businessUnit] = await db
    .select({ id: businessUnits.id, name: businessUnits.name })
    .from(businessUnits)
    .where(and(
      eq(businessUnits.id, businessUnitId),
      eq(businessUnits.organizationId, session.user.organizationId),
    ))
    .limit(1);
  if (!businessUnit || !isAitUsaBusinessUnit(businessUnit.name)) {
    throw createCrmError('Book fulfillment is limited to AIT USA.', 403);
  }
  return businessUnit;
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  const { searchParams } = new URL(request.url);
  const requestedBusinessUnitId = searchValue(searchParams, 'businessUnitId');
  let client;
  try {
    let businessUnitIds = session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds;
    if (requestedBusinessUnitId) {
      const resolvedId = await resolveBusinessUnitId({
        db: getDb(),
        session,
        businessUnitsTable: businessUnits,
        requestedId: requestedBusinessUnitId,
      });
      await assertAitUsaScope(getDb(), session, resolvedId);
      businessUnitIds = [resolvedId];
    }
    client = await getPool().connect();
    const queue = await loadBookFulfillmentQueue(client, {
      organizationId: session.user.organizationId,
      businessUnitIds,
      lane: searchValue(searchParams, 'lane'),
      page: searchValue(searchParams, 'page'),
      pageSize: searchValue(searchParams, 'pageSize'),
    });
    return NextResponse.json({
      ...queue,
      scope: { businessUnitIds },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return crmErrorResponse(err);
  } finally {
    client?.release();
  }
}

export async function PATCH(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  let client;
  try {
    const businessUnitId = await resolveBusinessUnitId({
      db: getDb(),
      session,
      businessUnitsTable: businessUnits,
      requestedId: String(body.businessUnitId || '').trim(),
    });
    await assertAitUsaScope(getDb(), session, businessUnitId);
    client = await getPool().connect();
    const fulfillment = await transitionBookFulfillment(client, {
      organizationId: session.user.organizationId,
      businessUnitId,
      fulfillmentId: String(body.fulfillmentId || '').trim(),
      actorUserId: session.user.id,
      expectedUpdatedAt: body.expectedUpdatedAt,
      action: body.action,
      carrier: body.carrier,
      trackingReference: body.trackingReference,
      notes: body.notes,
    });
    return NextResponse.json({ fulfillment }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return crmErrorResponse(err);
  } finally {
    client?.release();
  }
}
