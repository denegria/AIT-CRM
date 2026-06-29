import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { listInboxConversations } from '@/lib/conversations/service.js';

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const db = getDb();
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 100);
  const scanLimit = Number(searchParams.get('scanLimit') || 1000);

  try {
    const conversations = await listInboxConversations({
      db,
      organizationId: session.user.organizationId,
      businessUnitIds: session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
      limit,
      scanLimit,
    });

    return NextResponse.json({ conversations });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
