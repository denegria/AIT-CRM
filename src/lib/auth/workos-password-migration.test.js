import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import {
  WORKOS_PBKDF2_PASSWORD_HASH_TYPE,
  credentialToWorkOSPbkdf2Hash,
} from './workos-password-migration.js';

test('converts CRM PBKDF2-SHA512 credentials to WorkOS PHC format without changing bytes', () => {
  const password = 'unchanged-password';
  const salt = 'b6f11c541034b9c431f49ea94bcda192';
  const iterations = 310000;
  const derived = pbkdf2Sync(password, salt, iterations, 64, 'sha512');

  const phc = credentialToWorkOSPbkdf2Hash({
    passwordHash: derived.toString('base64'),
    passwordSalt: salt,
    passwordIterations: iterations,
    passwordDigest: 'sha512',
  });

  const [, algorithm, parameters, encodedSalt, encodedHash] = phc.split('$');
  assert.equal(algorithm, 'pbkdf2');
  assert.equal(parameters, 'i=310000,d=sha512');
  assert.equal(Buffer.from(encodedSalt, 'base64').toString('utf8'), salt);
  assert.deepEqual(Buffer.from(encodedHash, 'base64'), derived);
  assert.equal(WORKOS_PBKDF2_PASSWORD_HASH_TYPE, 'pbkdf2');
});

test('rejects unsupported or malformed credential material', () => {
  const valid = {
    passwordHash: Buffer.alloc(64, 1).toString('base64'),
    passwordSalt: 'salt-text',
    passwordIterations: 310000,
    passwordDigest: 'sha512',
  };

  assert.throws(
    () => credentialToWorkOSPbkdf2Hash({ ...valid, passwordDigest: 'sha256' }),
    /workos_password_digest_unsupported/u,
  );
  assert.throws(
    () => credentialToWorkOSPbkdf2Hash({ ...valid, passwordIterations: 209999 }),
    /workos_password_iterations_unsupported/u,
  );
  assert.throws(
    () => credentialToWorkOSPbkdf2Hash({ ...valid, passwordHash: Buffer.alloc(32).toString('base64') }),
    /workos_password_hash_invalid/u,
  );
});
