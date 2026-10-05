import { NextResponse } from 'next/server.js';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { canManageSubmittedAttendance, isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { listManagedSections, writeManagedSection } from '@/lib/crm/class-sections.js';
import { crmErrorResponse, createCrmError } from '@/lib/crm/errors.js';
import { classManagementAccess } from './access.js';

export async function scopedClassManagement(request, write = false) {
  const { error, session } = await requirePermission(request, write ? PERMISSIONS.CRM_WRITE : PERMISSIONS.CRM_READ);
  if (error) return { error };
  const businessUnitId = write
    ? (await request.clone().json().catch(() => ({}))).businessUnitId
    : new URL(request.url).searchParams.get('businessUnitId');
  const access = classManagementAccess(session.user, businessUnitId, write);
  if (access) return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  const db = getDb();
  const [unit] = await db.select({ id: businessUnits.id, name: businessUnits.name })
    .from(businessUnits).where(and(eq(businessUnits.id, businessUnitId),
      eq(businessUnits.organizationId, session.user.organizationId))).limit(1);
  if (!unit || !isAitUsaBusinessUnit(unit.name)) {
    return { error: NextResponse.json({ error: 'AIT USA business unit not found.' }, { status: 404 }) };
  }
  return { db, session, businessUnitId };
}

export function classManagementErrorResponse(error) {
  if (error?.code === '23505') return NextResponse.json({ error: 'Class key or effective date already exists. Refresh and try again.' }, { status: 409 });
  return crmErrorResponse(error);
}

export async function GET(request) {
  try {
    const scope = await scopedClassManagement(request);
    if (scope.error) return scope.error;
    return NextResponse.json({ sections: await listManagedSections({ db: scope.db,
      organizationId: scope.session.user.organizationId, businessUnitId: scope.businessUnitId,
      canManage: canManageSubmittedAttendance(scope.session.user) }),
    capabilities: { canManage: canManageSubmittedAttendance(scope.session.user) } });
  } catch (error) { return classManagementErrorResponse(error); }
}

export async function POST(request) {
  try {
    const scope = await scopedClassManagement(request, true);
    if (scope.error) return scope.error;
    const body = await request.json().catch(() => ({}));
    if (body.expectedRevision !== 0) throw createCrmError('New classes require expectedRevision 0.', 400);
    const result = await writeManagedSection({ db: scope.db, organizationId: scope.session.user.organizationId,
      businessUnitId: scope.businessUnitId, actorUserId: scope.session.user.id,
      payload: body, expectedRevision: 0, effectiveDate: body.effectiveDate });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return classManagementErrorResponse(error); }
}
