import { NextResponse } from 'next/server.js';
import { getDb } from '@/db/index.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { requireAttendanceRead } from '@/lib/attendance/http.js';
import { getAttendanceWorkspace } from '@/lib/attendance/service.js';

export async function GET(request, { params }) {
  const { error, session } = await requireAttendanceRead(request);
  if (error) return error;
  const { sectionId } = await params;
  const search = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await getAttendanceWorkspace({
      db: getDb(),
      session,
      sectionId,
      weekOf: search.get('weekOf') || undefined,
      selectedDate: search.get('date') || undefined,
    }));
  } catch (err) {
    return crmErrorResponse(err);
  }
}
