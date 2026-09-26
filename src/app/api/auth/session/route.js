import { NextResponse } from 'next/server';
import { getRequestSessionState, setWorkOSAuthCookie } from '@/lib/auth';
import { getServerAppVersion } from '@/lib/app-version.js';

export async function GET(request) {
  const { session, refreshedSessionData } = await getRequestSessionState(request);
  const response = NextResponse.json({
    authenticated: Boolean(session),
    user: session?.user || null,
    appVersion: getServerAppVersion(),
  });
  if (session && refreshedSessionData) setWorkOSAuthCookie(response, refreshedSessionData);
  return response;
}
