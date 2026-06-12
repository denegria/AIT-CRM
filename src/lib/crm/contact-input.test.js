import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManualContactIdentity } from './contact-input.js';

test('manual contacts require a name', () => {
  assert.equal(validateManualContactIdentity({ email: 'lead@example.com' }), 'Contact name is required.');
});

test('manual contacts require either phone or email', () => {
  assert.equal(validateManualContactIdentity({ name: 'Frank Bardales' }), 'Add either a phone number or an email address.');
});

test('manual contacts accept name plus email or phone', () => {
  assert.equal(validateManualContactIdentity({ name: 'Frank Bardales', email: 'lead@example.com' }), '');
  assert.equal(validateManualContactIdentity({ name: 'Frank Bardales', phone: '555-0100' }), '');
});
