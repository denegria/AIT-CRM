import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundLeadIntakeTask } from './intake.js';

test('creates inbound lead follow-up tasks idempotently', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [{ id: 'activity-1' }] };
    },
  };

  const result = await createInboundLeadIntakeTask(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    sourceType: 'website_form',
    sourceName: 'Website Form',
    contactName: 'Ada Lead',
    detail: 'Interested in English classes.',
    idempotencyKey: 'website:lead-1',
    ownerUserId: 'owner-1',
    metadata: { externalId: 'lead-1' },
  });

  assert.deepEqual(result, { inserted: true, taskActivityEventId: 'activity-1' });
  assert.equal(calls[0].sql.startsWith('with intake_lock as'), true);
  assert.equal(calls[0].sql.includes('pg_advisory_xact_lock'), true);
  assert.equal(calls[0].sql.includes('where not exists'), true);
  assert.deepEqual(calls[0].params.slice(0, 13), [
    'org-1',
    'bu-1',
    'contact-1',
    'lead-1',
    'Review new lead follow-up - Ada Lead',
    'Website Form: Interested in English classes.',
    'follow_up',
    'open',
    'high',
    'owner-1',
    'automation',
    'website:lead-1',
    'New lead follow-up',
  ]);
  assert.equal(JSON.parse(calls[0].params[13]).requiresFollowUpNote, true);
});

test('skips invalid inbound lead intake task payloads', async () => {
  const result = await createInboundLeadIntakeTask({ query: async () => { throw new Error('should not run'); } }, {
    organizationId: 'org-1',
  });

  assert.deepEqual(result, { inserted: false, reason: 'invalid_intake_task' });
});
