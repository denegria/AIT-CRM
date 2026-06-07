import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { canAccessBusinessUnit } from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import { listClientAccountResults } from '@/lib/client-accounts/read-model.js';

function stringParam(value) {
  return String(value || '').trim();
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 1000);
}

function accessibleBusinessUnitIds(session) {
  if (session.user.canAccessAllBusinessUnits) return null;
  return session.user.businessUnitIds || [];
}

async function resolveBusinessUnitIds(db, session, requestedBusinessUnitId) {
  if (!requestedBusinessUnitId) return accessibleBusinessUnitIds(session);
  if (!isUuid(requestedBusinessUnitId)) {
    throw createCrmError('A valid business unit id is required.');
  }

  const [businessUnit] = await db
    .select({ id: businessUnits.id })
    .from(businessUnits)
    .where(and(
      eq(businessUnits.id, requestedBusinessUnitId),
      eq(businessUnits.organizationId, session.user.organizationId),
    ))
    .limit(1);

  if (!businessUnit) {
    throw createCrmError('Business unit not found.', 404);
  }

  if (!canAccessBusinessUnit(session, requestedBusinessUnitId)) {
    throw createCrmError('Insufficient business-unit access.', 403);
  }

  return [businessUnit.id];
}

async function listScopedBusinessUnits(db, session, businessUnitIds) {
  const where = [
    eq(businessUnits.organizationId, session.user.organizationId),
  ];
  if (Array.isArray(businessUnitIds)) {
    if (!businessUnitIds.length) return [];
    where.push(inArray(businessUnits.id, businessUnitIds));
  }

  return db
    .select({ id: businessUnits.id, name: businessUnits.name })
    .from(businessUnits)
    .where(and(...where))
    .orderBy(businessUnits.name);
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const requestedBusinessUnitId = stringParam(searchParams.get('businessUnitId'));
    const query = stringParam(searchParams.get('q'));
    const limit = parseLimit(searchParams.get('limit'));
    const businessUnitIds = await resolveBusinessUnitIds(db, session, requestedBusinessUnitId);
    const accounts = await listClientAccountResults({
      db,
      organizationId: session.user.organizationId,
      businessUnitIds,
      query,
      limit,
    });
    const scopedBusinessUnits = await listScopedBusinessUnits(db, session, businessUnitIds);

    return NextResponse.json({
      accounts,
      count: accounts.length,
      query,
      businessUnits: scopedBusinessUnits,
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
