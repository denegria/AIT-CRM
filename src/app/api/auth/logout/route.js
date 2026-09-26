import { NextResponse } from 'next/server';
import { clearAuthCookie, revokeRequestSession } from '@/lib/auth';

export async function POST(request) {
  let providerRevocationPending = false;
  try {
    await revokeRequestSession(request);
  } catch {
    providerRevocationPending = true;
  }
  const response = NextResponse.json({ ok: true });
  if (providerRevocationPending) response.headers.set('x-ait-auth-revocation', 'provider-pending');
  clearAuthCookie(response);
  return response;
}
