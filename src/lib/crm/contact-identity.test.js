import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyContactIdentity } from './contact-identity.js';

function clientFor({ emailRows = [], phoneRows = [] }) {
  return {
    async query(sql) {
      if (sql.includes('lower(email)')) return { rows: emailRows };
      if (sql.includes('regexp_replace(coalesce(phone')) return { rows: phoneRows };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('classifies duplicate email evidence as ambiguous without selecting a contact', async () => {
  const result = await classifyContactIdentity(clientFor({
    emailRows: [{ id: 'contact-b' }, { id: 'contact-a' }],
  }), { organizationId: 'org-1', email: ' ANA@EXAMPLE.COM ' });

  assert.deepEqual(result, {
    status: 'ambiguous',
    reason: 'email_matches_multiple_contacts',
    evidence: { email: 'ana@example.com', phone: '' },
    matches: { email: ['contact-a', 'contact-b'], phone: [] },
    contactId: null,
  });
});

test('classifies duplicate phone evidence as ambiguous without selecting a contact', async () => {
  const result = await classifyContactIdentity(clientFor({
    phoneRows: [{ id: 'contact-a' }, { id: 'contact-b' }],
  }), { organizationId: 'org-1', phone: '(555) 010-1000' });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'phone_matches_multiple_contacts');
  assert.equal(result.contactId, null);
  assert.deepEqual(result.matches.phone, ['contact-a', 'contact-b']);
});

test('classifies split email and phone identity as ambiguous', async () => {
  const result = await classifyContactIdentity(clientFor({
    emailRows: [{ id: 'contact-email' }],
    phoneRows: [{ id: 'contact-phone' }],
  }), { organizationId: 'org-1', email: 'ana@example.com', phone: '+1 (555) 010-1000' });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'email_and_phone_resolve_to_different_contacts');
  assert.equal(result.contactId, null);
});

test('classifies consistent exact email and phone evidence as one contact', async () => {
  const result = await classifyContactIdentity(clientFor({
    emailRows: [{ id: 'contact-1' }],
    phoneRows: [{ id: 'contact-1' }],
  }), { organizationId: 'org-1', email: 'ana@example.com', phone: '+15550101000' });

  assert.equal(result.status, 'exact');
  assert.equal(result.contactId, 'contact-1');
  assert.deepEqual(result.matches, { email: ['contact-1'], phone: ['contact-1'] });
});

test('classifies absent contact evidence as a new candidate', async () => {
  const result = await classifyContactIdentity(clientFor({}), {
    organizationId: 'org-1', email: 'new@example.com', phone: '555-010-1000',
  });

  assert.equal(result.status, 'new');
  assert.equal(result.reason, 'no_matching_contact');
  assert.equal(result.contactId, null);
});
