import { NextResponse } from 'next/server.js';
import { PERMISSIONS, requirePermission } from '../auth.js';
import { isAttendanceEmployee } from './policy.js';

export async function requireAttendanceRead(request) {
  const result = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (result.error || isAttendanceEmployee(result.session?.user)) return result;
  return { error: NextResponse.json({ error: 'Attendance is limited to AIT coordinators and administrators.' }, { status: 403 }) };
}

export async function requireAttendanceWrite(request) {
  const result = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (result.error || isAttendanceEmployee(result.session?.user)) return result;
  return { error: NextResponse.json({ error: 'Attendance is limited to AIT coordinators and administrators.' }, { status: 403 }) };
}
