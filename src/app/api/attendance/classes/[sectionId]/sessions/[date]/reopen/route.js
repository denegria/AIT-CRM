import { NextResponse } from 'next/server.js';
import { getDb } from '@/db/index.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { requireAttendanceWrite } from '@/lib/attendance/http.js';
import { canManageSubmittedAttendance } from '@/lib/attendance/policy.js';
import { reopenAttendanceSession, resolveAttendanceSection } from '@/lib/attendance/service.js';

export async function POST(request, { params }) {
  const { error, session } = await requireAttendanceWrite(request);
  if (error) return error;
  if (!canManageSubmittedAttendance(session.user)) {
    return NextResponse.json({ error: 'Only senior coordinators and administrators can reopen attendance.' }, { status: 403 });
  }
  const { sectionId, date } = await params;
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  try {
    const section = await resolveAttendanceSection({ db, session, sectionId });
    const saved = await reopenAttendanceSession({
      db,
      section,
      sessionDate: date,
      actorUserId: session.user.id,
      expectedRevision: body.expectedRevision,
      reason: body.reason,
    });
    return NextResponse.json({ session: saved });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
