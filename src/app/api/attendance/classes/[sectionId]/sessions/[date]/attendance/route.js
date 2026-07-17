import { NextResponse } from 'next/server.js';
import { getDb } from '@/db/index.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { requireAttendanceWrite } from '@/lib/attendance/http.js';
import { resolveAttendanceSection, saveAttendanceSnapshot } from '@/lib/attendance/service.js';

export async function PUT(request, { params }) {
  const { error, session } = await requireAttendanceWrite(request);
  if (error) return error;
  const { sectionId, date } = await params;
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  try {
    const section = await resolveAttendanceSection({ db, session, sectionId });
    const saved = await saveAttendanceSnapshot({
      db,
      section,
      sessionDate: date,
      actorUserId: session.user.id,
      expectedRevision: body.expectedRevision,
      marks: body.marks,
    });
    return NextResponse.json({ session: saved });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
