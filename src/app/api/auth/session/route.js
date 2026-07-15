import { NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { getServerAppVersion } from '@/lib/app-version.js';

export async function GET(request) {
  const session = await getRequestSession(request);
  return NextResponse.json({
    authenticated: Boolean(session),
    user: session?.user || null,
    appVersion: getServerAppVersion(),
  });
}
