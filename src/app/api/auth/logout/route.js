import { NextResponse } from 'next/server';
import { clearAuthCookie, revokeRequestSession } from '@/lib/auth';

export async function POST(request) {
  await revokeRequestSession(request);
  const response = NextResponse.json({ ok: true });
  clearAuthCookie(response);
  return response;
}
