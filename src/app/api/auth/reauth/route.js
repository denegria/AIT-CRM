import { NextResponse } from 'next/server';
import {
  findCredentialByEmail,
  getRequestSession,
  verifyPassword,
} from '@/lib/auth';

const REAUTH_ATTEMPT_LIMIT = 5;
const REAUTH_WINDOW_MS = 15 * 60 * 1000;
const REAUTH_LOCKOUT_MS = 15 * 60 * 1000;
const REAUTH_ATTEMPT_STATE_KEY = '__aitCrmReauthAttemptState';

function attemptState() {
  globalThis[REAUTH_ATTEMPT_STATE_KEY] ||= new Map();
  return globalThis[REAUTH_ATTEMPT_STATE_KEY];
}

function pruneAttempts(now = Date.now()) {
  const attempts = attemptState();
  for (const [key, attempt] of attempts.entries()) {
    if ((attempt.lockedUntil || 0) <= now && now - attempt.firstAttemptAt > REAUTH_WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

function activeBlock(key, now = Date.now()) {
  pruneAttempts(now);
  const attempt = attemptState().get(key);
  if (!attempt) return null;
  if ((attempt.lockedUntil || 0) > now) return attempt.lockedUntil;
  return null;
}

function recordFailure(key, now = Date.now()) {
  const attempts = attemptState();
  const existing = attempts.get(key);
  const attempt = existing && now - existing.firstAttemptAt <= REAUTH_WINDOW_MS
    ? { ...existing, count: existing.count + 1 }
    : { count: 1, firstAttemptAt: now, lockedUntil: 0 };
  if (attempt.count >= REAUTH_ATTEMPT_LIMIT) {
    attempt.lockedUntil = now + REAUTH_LOCKOUT_MS;
  }
  attempts.set(key, attempt);
  return attempt.lockedUntil > now ? attempt.lockedUntil : null;
}

function clearFailures(key) {
  attemptState().delete(key);
}

function rateLimitResponse(lockedUntil) {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many unlock attempts. Try again shortly.' },
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  );
}

export async function POST(request) {
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
  }

  const key = session.sessionId || session.user.id;
  const blockedUntil = activeBlock(key);
  if (blockedUntil) return rateLimitResponse(blockedUntil);

  const row = await findCredentialByEmail(session.user.email);
  if (!row || row.user?.id !== session.user.id || !row.user?.isActive || !verifyPassword(password, row.credential)) {
    const lockedUntil = recordFailure(key);
    if (lockedUntil) return rateLimitResponse(lockedUntil);
    return NextResponse.json({ error: 'Invalid password.' }, { status: 401 });
  }

  clearFailures(key);
  return NextResponse.json({
    ok: true,
    user: session.user,
  });
}
