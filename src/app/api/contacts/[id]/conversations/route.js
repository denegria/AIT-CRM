import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { contacts } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { resolveContactById } from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { listContactConversationMessages } from '@/lib/conversations/service.js';

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const messages = await listContactConversationMessages({
      db,
      organizationId: session.user.organizationId,
      contactId: contact.id,
      businessUnitIds: session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
    });

    return NextResponse.json({ messages });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
