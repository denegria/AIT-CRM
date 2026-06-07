import { NextResponse } from 'next/server';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { getDb } from '@/db/index.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import { listClientAccountResults } from '@/lib/client-accounts/read-model.js';

function accessibleBusinessUnitIds(session) {
  if (session.user.canAccessAllBusinessUnits) return null;
  return session.user.businessUnitIds || [];
}

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  try {
    const { id } = await params;
    if (!isUuid(id)) {
      throw createCrmError('A valid client account id is required.');
    }

    const accounts = await listClientAccountResults({
      db: getDb(),
      organizationId: session.user.organizationId,
      businessUnitIds: accessibleBusinessUnitIds(session),
      accountId: id,
      limit: 1,
      includeDetail: true,
    });
    const [account] = accounts;

    if (!account) {
      throw createCrmError('Client account not found.', 404);
    }

    return NextResponse.json({ account });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
