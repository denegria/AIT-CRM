import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
