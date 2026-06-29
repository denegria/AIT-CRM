import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { listConversationThreadMessages } from '@/lib/conversations/service.js';

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const db = getDb();
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 100);

  try {
    const messages = await listConversationThreadMessages({
      db,
      organizationId: session.user.organizationId,
      conversationId: id,
      businessUnitIds: session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
      limit,
    });

    return NextResponse.json({ messages });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
