import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { loadGlobalSearch } from '@/lib/search/service.js';

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  try {
    const searchParams = new URL(request.url).searchParams;
    return NextResponse.json(await loadGlobalSearch({
      db: getDb(),
      session,
      query: searchParams.get('q'),
      businessUnitId: searchParams.get('businessUnitId'),
    }));
  } catch (error) {
    console.error('Global search failed:', error);
    return NextResponse.json({ error: 'Search could not load.' }, { status: 500 });
  }
}
