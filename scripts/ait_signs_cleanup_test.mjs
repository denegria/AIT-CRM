import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, normalizeIdentityKey } from './cleanup-ait-signs-contact-duplicates.mjs';

test('normalizes punctuation variants for AIT Signs customer identity', () => {
  assert.equal(normalizeIdentityKey("SAL'S DELI"), 'salsdeli');
  assert.equal(normalizeIdentityKey('SALS DELI'), 'salsdeli');
});

test('plans Saul duplicate contacts under the SALS DELI company account', () => {
  const rows = [
    {
      id: 'contact-phone',
      name: 'SAUL',
      company_name: "SAL'S DELI",
      phone: '9088218180',
      linked_count: 3,
      created_at: '2026-05-30T00:00:00.000Z',
    },
    {
      id: 'contact-no-phone-a',
      name: 'SAUL',
      company_name: 'SALS DELI',
      phone: null,
      linked_count: 1,
      created_at: '2026-05-30T00:01:00.000Z',
    },
    {
      id: 'contact-no-phone-b',
      name: 'SAUL',
      company_name: 'SALS DELI',
      phone: '',
      linked_count: 1,
      created_at: '2026-05-30T00:02:00.000Z',
    },
    {
      id: 'other-company',
      name: 'SAUL',
      company_name: 'DELI MIDDLESEX',
      phone: null,
      linked_count: 1,
      created_at: '2026-05-30T00:03:00.000Z',
    },
  ];

  const plan = buildPlan(rows);
  assert.equal(plan.mergeGroups.length, 1);
  assert.equal(plan.mergeGroups[0].primary.id, 'contact-phone');
  assert.equal(plan.mergeGroups[0].displayName, "SAL'S DELI");
  assert.deepEqual(
    plan.mergeGroups[0].duplicates.map((row) => row.id),
    ['contact-no-phone-a', 'contact-no-phone-b'],
  );
  assert.deepEqual(
    plan.displayUpdates.map((update) => [update.contactId, update.from, update.to]),
    [
      ['contact-phone', 'SAUL', "SAL'S DELI"],
      ['contact-no-phone-a', 'SAUL', 'SALS DELI'],
      ['contact-no-phone-b', 'SAUL', 'SALS DELI'],
      ['other-company', 'SAUL', 'DELI MIDDLESEX'],
    ],
  );
});
