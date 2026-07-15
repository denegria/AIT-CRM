import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { crmErrorResponse, createCrmError } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import { loadTaskContactOptions } from '@/lib/tasks/contact-options.js';

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  try {
    const searchParams = new URL(request.url).searchParams;
    const contactId = String(searchParams.get('contactId') || '').trim();
    if (contactId && !isUuid(contactId)) throw createCrmError('contactId must be a valid id.');
    const contacts = await loadTaskContactOptions({
      db: getDb(),
      session,
      businessUnitId: searchParams.get('businessUnitId'),
      query: searchParams.get('q'),
      contactIds: contactId ? [contactId] : [],
    });
    return NextResponse.json({ contacts });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
