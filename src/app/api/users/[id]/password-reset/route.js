import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { users } from '@/db/schema.js';
import {
  PERMISSIONS,
  requirePermission,
  sendAdminWorkOSPasswordReset,
  usesWorkOSAuth,
} from '@/lib/auth';
import { isUuid } from '@/lib/crm/validation.js';

export async function POST(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;
  if (!usesWorkOSAuth()) {
    return NextResponse.json({ error: 'Managed password reset requires WorkOS authentication.' }, { status: 409 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'A valid user id is required.' }, { status: 400 });
  const [user] = await getDb()
    .select({ id: users.id, email: users.email, workosUserId: users.workosUserId })
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, session.user.organizationId)))
    .limit(1);
  if (!user?.email || !user.workosUserId) {
    return NextResponse.json({ error: 'This employee is not linked to WorkOS.' }, { status: 409 });
  }

  try {
    await sendAdminWorkOSPasswordReset({
      email: user.email,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      subjectUserId: user.id,
    });
    return NextResponse.json({ accepted: true });
  } catch (resetError) {
    return NextResponse.json(
      { error: resetError?.status === 429 ? 'Password reset is temporarily rate limited.' : 'Password reset could not be sent.' },
      { status: resetError?.status || 502 },
    );
  }
}
