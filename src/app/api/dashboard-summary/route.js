import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { loadDashboardSummary } from '@/lib/dashboard/service.js';

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  const searchParams = new URL(request.url).searchParams;
  const businessUnitId = String(searchParams.get('businessUnitId') || '').trim();
  if (!businessUnitId) {
    return NextResponse.json({ error: 'A business unit is required.' }, { status: 400 });
  }
  try {
    const employeeIds = String(searchParams.get('employeeIds') || '').split(',').map((value) => value.trim()).filter(Boolean);
    return NextResponse.json(await loadDashboardSummary({
      db: getDb(),
      session,
      businessUnitId,
      employeeIds,
    }));
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error('Dashboard summary load failed:', error);
    return NextResponse.json({ error: status === 403 ? error.message : 'Dashboard summary could not load.' }, { status });
  }
}
