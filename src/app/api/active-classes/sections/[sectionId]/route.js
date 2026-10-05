import { NextResponse } from 'next/server.js';
import { scopedClassManagement, classManagementErrorResponse } from '../route.js';
import { writeManagedSection } from '@/lib/crm/class-sections.js';
import { createCrmError } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';

export async function PATCH(request, { params }) {
  try {
    const scope = await scopedClassManagement(request, true);
    if (scope.error) return scope.error;
    const { sectionId } = await params;
    if (!isUuid(sectionId)) throw createCrmError('Valid class section id required.', 400);
    const body = await request.json().catch(() => ({}));
    const result = await writeManagedSection({ db: scope.db, organizationId: scope.session.user.organizationId,
      businessUnitId: scope.businessUnitId, actorUserId: scope.session.user.id, sectionId,
      payload: body, expectedRevision: body.expectedRevision, effectiveDate: body.effectiveDate });
    return NextResponse.json(result);
  } catch (error) { return classManagementErrorResponse(error); }
}
