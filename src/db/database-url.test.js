import assert from 'node:assert/strict';
import test from 'node:test';

import { databaseSslMode, databaseUrlUsesFullVerification } from './database-url.js';

test('recognizes explicit full TLS verification without exposing connection details', () => {
  const connectionString = 'postgresql://role:secret@example.neon.tech/neondb?sslmode=verify-full';
  assert.equal(databaseSslMode(connectionString), 'verify-full');
  assert.equal(databaseUrlUsesFullVerification(connectionString), true);
});

test('rejects legacy, missing, and malformed SSL mode configuration', () => {
  assert.equal(databaseUrlUsesFullVerification('postgresql://role@example.neon.tech/neondb?sslmode=require'), false);
  assert.equal(databaseUrlUsesFullVerification('postgresql://role@example.neon.tech/neondb'), false);
  assert.equal(databaseUrlUsesFullVerification('not-a-database-url'), false);
  assert.equal(databaseUrlUsesFullVerification(''), false);
});

test('normalizes SSL mode casing for environment compatibility', () => {
  assert.equal(databaseUrlUsesFullVerification('postgresql://role@example.neon.tech/neondb?sslmode=VERIFY-FULL'), true);
});
