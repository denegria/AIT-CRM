import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_TOKEN_ENV,
  hasConfiguredAdminToken,
  isValidAdminToken,
} from '@/lib/admin-guard';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 8,
};

export async function POST(request) {
  if (!hasConfiguredAdminToken()) {
    return NextResponse.json(
      { error: `${ADMIN_TOKEN_ENV} is required before admin routes can be unlocked.` },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  if (!isValidAdminToken(token)) {
    return NextResponse.json({ error: 'Invalid admin token.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, COOKIE_OPTIONS);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
