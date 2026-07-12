import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_SCOPED_STORAGE_KEYS,
  clearUserScopedSessionState,
  parseStoredSession,
  sameSessionIdentity,
  sessionIdentityForUser,
} from './session-sync.js';

test('builds stable public session identities', () => {
  assert.deepEqual(sessionIdentityForUser({
    id: 'user-1',
    name: 'Sindy',
    email: 'sindy@example.com',
    permissions: ['crm:read'],
  }), {
    userId: 'user-1',
    name: 'Sindy',
    email: 'sindy@example.com',
  });
  assert.equal(sessionIdentityForUser(null), null);
});

test('compares session identities by user id only', () => {
  assert.equal(sameSessionIdentity({ userId: 'a' }, { userId: 'a', email: 'new@example.com' }), true);
  assert.equal(sameSessionIdentity({ userId: 'a' }, { userId: 'b' }), false);
  assert.equal(sameSessionIdentity(null, { userId: 'b' }), false);
});

test('parses stored session values defensively', () => {
  assert.deepEqual(parseStoredSession('{"userId":"user-1","email":"a@example.com"}'), {
    userId: 'user-1',
    email: 'a@example.com',
  });
  assert.equal(parseStoredSession('{bad'), null);
  assert.equal(parseStoredSession('{"email":"missing-id@example.com"}'), null);
});

test('clears user-scoped local storage and cookies', () => {
  const removedKeys = [];
  const expiredCookies = [];
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  globalThis.window = {
    localStorage: {
      removeItem(key) {
        removedKeys.push(key);
      },
    },
  };
  globalThis.document = {
    set cookie(value) {
      expiredCookies.push(value);
    },
  };

  try {
    clearUserScopedSessionState();
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }

  assert.deepEqual(removedKeys, USER_SCOPED_STORAGE_KEYS);
  assert.deepEqual(
    expiredCookies,
    USER_SCOPED_STORAGE_KEYS.map((key) => `${key}=; Path=/; Max-Age=0; SameSite=Lax`)
  );
});
