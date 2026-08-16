import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecoveryQueue, RECOVERY_QUEUE_SQL } from './service.js';

test('Recovery Queue query is organization, division, and regular-owner scoped', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        lane_counts: { overdue: 1 },
        rows: [{ lane: 'overdue', item_key: 'overdue:task-1' }],
      }] };
    },
  };

  const result = await loadRecoveryQueue(client, {
    organizationId: 'org-1',
    regularCoordinatorUserId: 'user-1',
    businessUnitIds: ['bu-1'],
    canViewUnassigned: false,
    lane: 'overdue',
    page: 2,
    pageSize: 25,
  });

  assert.deepEqual(result, {
    counts: { overdue: 1 },
    rows: [{ lane: 'overdue', item_key: 'overdue:task-1' }],
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['org-1', 'user-1', ['bu-1'], false, 'overdue', 25, 25]);
  assert.match(calls[0].sql, /l\.organization_id = \$1/);
  assert.match(calls[0].sql, /assigned_user_id = \$2::uuid/);
  assert.match(calls[0].sql, /task_owner_user_id = \$2::uuid/);
  assert.match(calls[0].sql, /l\.business_unit_id = any\(\$3::uuid\[\]\)/);
  assert.match(calls[0].sql, /\$4::boolean or assigned_user_id is not null/);
  assert.match(calls[0].sql, /task_lead\.id = vt\.lead_id/);
  assert.match(calls[0].sql, /offset least\(/);
});

test('Recovery Queue query keeps deterministic lanes and excludes Retargeting eligibility', () => {
  for (const lane of ['first_contact', 'unassigned', 'overdue', 'no_commitment', 'duplicate_follow_up']) {
    assert.match(RECOVERY_QUEUE_SQL, new RegExp(`'${lane}'`));
  }
  assert.match(RECOVERY_QUEUE_SQL, /'new', 'new lead', 'needs first outreach', 'follow up'/);
  assert.doesNotMatch(RECOVERY_QUEUE_SQL, /lower\(trim\(lead_status\)\).*retargeting/);
  assert.match(RECOVERY_QUEUE_SQL, /not is_do_not_call/);
  assert.match(RECOVERY_QUEUE_SQL, /not is_wrong_number/);
});

test('Recovery Queue avoids a database read when the user has no division access', async () => {
  let called = false;
  const client = { async query() { called = true; return { rows: [] }; } };
  assert.deepEqual(await loadRecoveryQueue(client, {
    organizationId: 'org-1',
    businessUnitIds: [],
  }), { counts: {}, rows: [] });
  assert.equal(called, false);
});
