import assert from 'node:assert/strict';
import test from 'node:test';

import { createHppMerchantReference, HPP_REFERENCE_PATTERN } from './hpp-reference.js';

test('new HPP references are deterministic, domain-separated, and contract compliant', () => {
  const identifiers = ['organization-1', 'business-unit-1', 'idempotency-1'];
  const staff = createHppMerchantReference('staff', identifiers);
  const portal = createHppMerchantReference('portal', identifiers);
  const registration = createHppMerchantReference('registration', identifiers);

  assert.equal(staff, createHppMerchantReference('staff', identifiers));
  assert.match(staff, /^S[A-F0-9]{19}$/);
  assert.match(portal, /^P[A-F0-9]{19}$/);
  assert.match(registration, /^R[A-F0-9]{19}$/);
  assert.equal(HPP_REFERENCE_PATTERN.test(staff), true);
  assert.notEqual(staff, createHppMerchantReference('staff', ['organization-2', ...identifiers.slice(1)]));
  assert.notEqual(staff, createHppMerchantReference('staff', [identifiers[0], identifiers[1], 'idempotency-2']));
});

test('rejects malformed reference generation inputs', () => {
  assert.throws(() => createHppMerchantReference('unknown', ['seed']));
  assert.throws(() => createHppMerchantReference('staff', []));
  assert.throws(() => createHppMerchantReference('staff', ['']));
  assert.equal(HPP_REFERENCE_PATTERN.test('PAY_123'), false);
  assert.equal(HPP_REFERENCE_PATTERN.test('PAY-123'), false);
  assert.equal(HPP_REFERENCE_PATTERN.test(`S${'A'.repeat(20)}`), false);
});
