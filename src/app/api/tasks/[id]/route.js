import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import { loadTaskDetail } from '@/lib/tasks/detail.js';

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  if (!isUuid(id)) {
    return crmErrorResponse(createCrmError('Task not found.', 404));
  }

  try {
    const detail = await loadTaskDetail({
      db: getDb(),
      organizationId: session.user.organizationId,
      session,
      taskId: id,
    });
    return NextResponse.json(detail);
  } catch (err) {
    return crmErrorResponse(err);
  }
}
