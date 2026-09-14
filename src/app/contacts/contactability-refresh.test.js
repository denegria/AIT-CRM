import assert from 'node:assert/strict';
import test from 'node:test';
import { contactabilitySnapshot } from '../../lib/contacts/contactability-snapshot.js';

test('contactability refresh returns only current canonical contact fields', () => {
  const updatedAt = new Date('2026-09-14T17:30:00.000Z');
  assert.deepEqual(contactabilitySnapshot({
    id: 'contact-1',
    organizationId: 'org-private',
    name: 'Private name',
    email: 'student@example.com',
    phone: '+15551234567',
    isDoNotCall: true,
    isWrongNumber: false,
    updatedAt,
    secret: 'not-serialized',
  }), {
    id: 'contact-1',
    email: 'student@example.com',
    phone: '+15551234567',
    isDoNotCall: true,
    isWrongNumber: false,
    updatedAt: updatedAt.toISOString(),
  });
});
