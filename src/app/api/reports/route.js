import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { loadLeadPerformanceReport } from '@/lib/reports/service.js';
import { csvCell } from '@/lib/reports/metrics.js';

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.REPORTS_READ);
  if (error) return error;
  try {
    const payload = await loadLeadPerformanceReport({ db: getDb(), session, searchParams: new URL(request.url).searchParams });
    if (new URL(request.url).searchParams.get('format') === 'csv') {
      const headers = ['Lead date', 'Lead', 'Email', 'Source', 'Current coordinator', 'Status', 'Successful contact', 'Enrolled'];
      const rows = payload.leads.map((lead) => [lead.leadDate.slice(0, 10), lead.name, lead.email, lead.source, lead.coordinator, lead.status, lead.contacted ? 'Yes' : 'No', lead.enrollmentSupported ? (lead.enrolled ? 'Yes' : 'No') : 'N/A']);
      return new NextResponse([headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ait-crm-lead-performance.csv"' } });
    }
    return NextResponse.json(payload);
  } catch (cause) {
    const status = Number(cause?.status || 500);
    if (status >= 500) console.error('Lead performance report load failed:', cause);
    return NextResponse.json({ error: status === 403 ? cause.message : 'Reports could not load.' }, { status });
  }
}
