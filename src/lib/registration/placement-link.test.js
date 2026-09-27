import assert from 'node:assert/strict';
import test from 'node:test';
import { linkClaimedPlacementToRegistration } from './placement-link.js';

const scope = {
  organizationId: 'org-1', businessUnitId: 'ait-usa-1', contactId: 'student-1',
  placement: { portalAccountId: 'portal-1', attemptId: 'attempt-1', resultId: 'result-1', recommendedLevelLabel: 'Book 2' },
};

function client(rows) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    return { rows: sql.startsWith('select id, metadata_json') ? rows : [] };
  } };
}

test('links a verified claim only to one existing English registration', async () => {
  const db = client([{ id: 'enrollment-1', metadata_json: { programCode: 'english_program', placementState: 'not_started' } }]);
  const result = await linkClaimedPlacementToRegistration(db, scope);
  assert.deepEqual(result, { status: 'linked', enrollmentId: 'enrollment-1' });
  assert.match(db.calls[0].sql, /organization_id = \$1 and business_unit_id = \$2 and contact_id = \$3/);
  assert.match(db.calls[0].sql, /programCode' = 'english_program'/);
  assert.match(db.calls[0].sql, /payment_verified/);
  assert.deepEqual(db.calls[0].params, ['org-1', 'ait-usa-1', 'student-1']);
  assert.equal(db.calls.length, 2);
  assert.equal(db.calls[1].params[4], 'portal-1');
  assert.deepEqual(JSON.parse(db.calls[1].params[5]), {
    attemptId: 'attempt-1', resultId: 'result-1', recommendedLevel: 'Book 2', reviewStatus: 'pending', finalLevel: null,
  });
});

test('does not guess when enrollment identity or attempt is ambiguous', async () => {
  for (const [rows, expected] of [
    [[], 'no_registration'],
    [[{ id: 'one', metadata_json: {} }, { id: 'two', metadata_json: {} }], 'ambiguous_registration'],
    [[{ id: 'one', metadata_json: { portalAccountId: 'other-account' } }], 'account_conflict'],
    [[{ id: 'one', metadata_json: { placement: { attemptId: 'other-attempt' } } }], 'attempt_conflict'],
    [[{ id: 'one', metadata_json: { placement: { attemptId: 'attempt-1' } } }], 'already_linked'],
  ]) {
    const db = client(rows);
    assert.equal((await linkClaimedPlacementToRegistration(db, scope)).status, expected);
    assert.equal(db.calls.length, 1);
  }
});
