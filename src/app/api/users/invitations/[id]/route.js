import { NextResponse } from 'next/server';
import {
  PERMISSIONS,
  requirePermission,
  resendWorkOSEmployeeInvitation,
  revokeWorkOSEmployeeInvitation,
  usesWorkOSAuth,
} from '@/lib/auth';
import { isUuid } from '@/lib/crm/validation.js';

export async function PATCH(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;
  if (!usesWorkOSAuth()) {
    return NextResponse.json({ error: 'Managed invitations require WorkOS authentication.' }, { status: 409 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'A valid invitation id is required.' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  const options = {
    invitationId: id,
    organizationId: session.user.organizationId,
    actorUserId: session.user.id,
  };

  try {
    const invitation = action === 'resend'
      ? await resendWorkOSEmployeeInvitation(options)
      : action === 'revoke'
        ? await revokeWorkOSEmployeeInvitation(options)
        : null;
    if (!invitation) return NextResponse.json({ error: 'Action must be resend or revoke.' }, { status: 400 });
    return NextResponse.json({ invitation });
  } catch (actionError) {
    return NextResponse.json(
      { error: actionError?.status === 409 ? 'This invitation is no longer pending.' : 'Invitation action failed.' },
      { status: actionError?.status || 502 },
    );
  }
}
