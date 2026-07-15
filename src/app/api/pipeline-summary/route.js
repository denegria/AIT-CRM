import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { loadPipelineSummary } from '@/lib/pipeline/service.js';

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  try {
    const searchParams = new URL(request.url).searchParams;
    return NextResponse.json(await loadPipelineSummary({ db: getDb(), session, searchParams }));
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error('Pipeline summary load failed:', error);
    return NextResponse.json({ error: status === 403 ? error.message : 'Pipeline summary could not load.' }, { status });
  }
}
