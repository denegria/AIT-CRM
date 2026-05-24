import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInboundLeadAssignmentEligible,
  pickDeterministicOwnerUserId,
  resolveDefaultInboundLeadOwnerUserId,
} from './assignment.js';

test('default assignment eligibility excludes historical imports', () => {
  assert.equal(isInboundLeadAssignmentEligible({ sourceType: 'website_form' }), true);
  assert.equal(isInboundLeadAssignmentEligible({ sourceType: 'facebook_messenger' }), true);
  assert.equal(isInboundLeadAssignmentEligible({ sourceType: 'whatsapp_inbound' }), true);
  assert.equal(isInboundLeadAssignmentEligible({ sourceType: 'xlsx' }), false);
  assert.equal(isInboundLeadAssignmentEligible({ sourceType: 'website_form', historicalImport: true }), false);
});

test('deterministic owner selection is stable regardless of user input order', () => {
  const users = [
    { id: 'user-3', name: 'Zoey' },
    { id: 'user-1', name: 'Ada' },
    { id: 'user-2', name: 'Grace' },
  ];

  assert.equal(
    pickDeterministicOwnerUserId(users, 'website_form:lead-1'),
    pickDeterministicOwnerUserId([...users].reverse(), 'website_form:lead-1'),
  );
  assert.equal(pickDeterministicOwnerUserId([], 'website_form:lead-1'), null);
});

test('default inbound owner prefers business-unit members and skips imports', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push({ sql: normalized, params });
      if (normalized.startsWith('select u.id, u.name, u.email')) {
        return { rows: [{ id: 'user-bu', name: 'Business Unit Owner' }] };
      }
      if (normalized.startsWith('select id, name, email from users')) {
        return { rows: [{ id: 'user-org', name: 'Org Owner' }] };
      }
      throw new Error('Unexpected query: ' + normalized);
    },
  };

  const ownerUserId = await resolveDefaultInboundLeadOwnerUserId(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    sourceType: 'website_form',
    sourceKey: 'submission-1',
  });

  assert.equal(ownerUserId, 'user-bu');
  assert.equal(calls.length, 1);

  const importOwner = await resolveDefaultInboundLeadOwnerUserId(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    sourceType: 'xlsx',
    sourceKey: 'historical-row-1',
  });
  assert.equal(importOwner, null);
  assert.equal(calls.length, 1);
});
