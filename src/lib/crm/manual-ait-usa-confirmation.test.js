import assert from 'node:assert/strict';
import test from 'node:test';
import { issueManualAitUsaConfirmation, verifyManualAitUsaConfirmation } from './manual-ait-usa-confirmation.js';

const input = Object.freeze({
  organizationId: 'org-1', actorUserId: 'actor-1', businessUnitId: 'bu-1', contactId: 'contact-1',
  contactValues: { email: 'ANA@example.com', phone: '(555) 010-1000' },
});
const env = Object.freeze({ CRM_MANUAL_CONFIRMATION_SECRET: 'test-confirmation-secret' });

test('manual existing-contact confirmation is short-lived and bound to actor, scope, exact contact, and normalized identity', () => {
  const now = Date.parse('2026-09-12T10:00:00.000Z');
  const proof = issueManualAitUsaConfirmation(input, env, now);
  assert.equal(verifyManualAitUsaConfirmation(proof, input, env, now + 1), true);
  assert.equal(verifyManualAitUsaConfirmation(proof, { ...input, actorUserId: 'actor-2' }, env, now + 1), false);
  assert.equal(verifyManualAitUsaConfirmation(proof, { ...input, contactId: 'contact-2' }, env, now + 1), false);
  assert.equal(verifyManualAitUsaConfirmation(proof, { ...input, contactValues: { email: 'changed@example.com', phone: input.contactValues.phone } }, env, now + 1), false);
  assert.equal(verifyManualAitUsaConfirmation(proof, input, env, now + (10 * 60 * 1000) + 1), false);
});
