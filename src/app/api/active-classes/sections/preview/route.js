import { NextResponse } from 'next/server.js';
import { scopedClassManagement, classManagementErrorResponse } from '../route.js';
import { previewManagedSection } from '@/lib/crm/class-sections.js';

export async function POST(request) {
  try {
    const scope = await scopedClassManagement(request, true);
    if (scope.error) return scope.error;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await previewManagedSection({ db: scope.db,
      organizationId: scope.session.user.organizationId, businessUnitId: scope.businessUnitId,
      sectionId: body.sectionId || null, payload: body, effectiveDate: body.effectiveDate }));
  } catch (error) { return classManagementErrorResponse(error); }
}
