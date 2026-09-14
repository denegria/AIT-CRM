import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { contacts } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { assertCanAccessContactLead, resolveContactById } from '@/lib/crm/access.js';
import { listContactPhoneHistory } from '@/lib/crm/contact-phone-history.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { latestLeadForContact } from '@/lib/crm/write-helpers.js';

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
    const lead = await latestLeadForContact(db, session.user.organizationId, contact.id);
    assertCanAccessContactLead(session, lead, contact);
    const phones = await listContactPhoneHistory({
      db,
      organizationId: session.user.organizationId,
      contactId: contact.id,
    });
    return NextResponse.json({ phones });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
