import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  createUserSession,
  findCredentialByEmail,
  isAuthEnabled,
  SESSION_SECRET_ENV,
  setAuthCookie,
  verifyPassword,
} from '@/lib/auth';
import { userPasswordCredentials } from '@/db/schema.js';

export async function POST(request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is required for sign in.' }, { status: 503 });
  }

  if (!isAuthEnabled()) {
    return NextResponse.json({ error: `${SESSION_SECRET_ENV} is required for sign in.` }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const row = await findCredentialByEmail(email);
  if (!row || !row.user?.isActive || !verifyPassword(password, row.credential)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  await getDb()
    .update(userPasswordCredentials)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(userPasswordCredentials.id, row.credential.id));

  const { token, expiresAt } = await createUserSession(row.user.id);
  const response = NextResponse.json({ ok: true });
  setAuthCookie(response, token, expiresAt);
  return response;
}
