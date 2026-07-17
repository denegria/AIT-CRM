import { NextResponse } from 'next/server.js';
import { getDb } from '@/db/index.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { requireAttendanceRead } from '@/lib/attendance/http.js';
import { listAttendanceClasses } from '@/lib/attendance/service.js';
import { todayInAttendanceTimeZone } from '@/lib/attendance/policy.js';

export async function GET(request) {
  const { error, session } = await requireAttendanceRead(request);
  if (error) return error;
  const date = new URL(request.url).searchParams.get('date') || todayInAttendanceTimeZone();
  try {
    return NextResponse.json(await listAttendanceClasses({ db: getDb(), session, date }));
  } catch (err) {
    return crmErrorResponse(err);
  }
}
