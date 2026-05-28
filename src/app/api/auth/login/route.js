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

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_MAX_KEYS = 1000;
const LOGIN_ATTEMPT_STATE_KEY = '__aitCrmLoginAttemptState';

function loginAttemptState() {
  globalThis[LOGIN_ATTEMPT_STATE_KEY] ||= new Map();
  return globalThis[LOGIN_ATTEMPT_STATE_KEY];
}

function loginAttemptKey(email) {
  return email;
}

function pruneLoginAttempts(now = Date.now()) {
  const attempts = loginAttemptState();
  for (const [key, attempt] of attempts.entries()) {
    if ((attempt.lockedUntil || 0) <= now && now - attempt.firstAttemptAt > LOGIN_WINDOW_MS) {
      attempts.delete(key);
    }
  }

  if (attempts.size <= LOGIN_ATTEMPT_MAX_KEYS) return;

  const sortedByOldest = [...attempts.entries()]
    .sort((a, b) => a[1].firstAttemptAt - b[1].firstAttemptAt);
  const overflow = attempts.size - LOGIN_ATTEMPT_MAX_KEYS;
  for (let i = 0; i < overflow; i += 1) {
    attempts.delete(sortedByOldest[i][0]);
  }
}

function currentLoginBlock(key, now = Date.now()) {
  const attempt = loginAttemptState().get(key);
  if (!attempt) return null;
  if ((attempt.lockedUntil || 0) > now) {
    return attempt.lockedUntil;
  }
  if (now - attempt.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttemptState().delete(key);
  }
  return null;
}

function recordLoginFailure(key, now = Date.now()) {
  pruneLoginAttempts(now);
  const attempts = loginAttemptState();
  const existing = attempts.get(key);
  const attempt = existing && now - existing.firstAttemptAt <= LOGIN_WINDOW_MS
    ? { ...existing, count: existing.count + 1 }
    : { count: 1, firstAttemptAt: now, lockedUntil: 0 };

  if (attempt.count >= LOGIN_ATTEMPT_LIMIT) {
    attempt.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }
  attempts.set(key, attempt);
  return attempt.lockedUntil > now ? attempt.lockedUntil : null;
}

function clearLoginFailures(key) {
  loginAttemptState().delete(key);
}

function rateLimitResponse(lockedUntil) {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many sign-in attempts. Try again shortly.' },
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  );
}

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

  const attemptKey = loginAttemptKey(email);
  const activeBlock = currentLoginBlock(attemptKey);
  if (activeBlock) {
    return rateLimitResponse(activeBlock);
  }

  const row = await findCredentialByEmail(email);
  if (!row || !row.user?.isActive || !verifyPassword(password, row.credential)) {
    const lockedUntil = recordLoginFailure(attemptKey);
    if (lockedUntil) return rateLimitResponse(lockedUntil);
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }
  clearLoginFailures(attemptKey);

  await getDb()
    .update(userPasswordCredentials)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(userPasswordCredentials.id, row.credential.id));

  const { token, expiresAt } = await createUserSession(row.user.id);
  const response = NextResponse.json({ ok: true });
  setAuthCookie(response, token, expiresAt);
  return response;
}
