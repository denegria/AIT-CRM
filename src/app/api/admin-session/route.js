import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  hasConfiguredAdminToken,
  isAdminTokenUnlockEnabled,
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
  if (!isAdminTokenUnlockEnabled()) {
    return NextResponse.json(
      { error: 'Admin token unlock is disabled for this environment.' },
      { status: 404 },
    );
  }

  if (!hasConfiguredAdminToken()) {
    return NextResponse.json(
      { error: 'Admin token unlock is not configured.' },
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
