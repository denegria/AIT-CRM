import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateLifecycleTransition,
  normalizeLifecycleStatus,
  requireLifecycleStatus,
} from './lifecycle.js';

test('normalizeLifecycleStatus maps input aliases to canonical pipeline values', () => {
  assert.equal(normalizeLifecycleStatus('new'), 'New Lead');
  assert.equal(normalizeLifecycleStatus('estimate sent'), 'Proposal Sent');
  assert.equal(normalizeLifecycleStatus('proposal_sent'), 'Proposal Sent');
  assert.equal(normalizeLifecycleStatus('closed-won'), 'Won');
  assert.equal(normalizeLifecycleStatus('closed won'), 'Won');
  assert.equal(normalizeLifecycleStatus('  contacted  '), 'Contacted');
  assert.equal(normalizeLifecycleStatus('not real'), null);
});

test('requireLifecycleStatus rejects arbitrary lifecycle strings', () => {
  assert.equal(requireLifecycleStatus('Qualified'), 'Qualified');
  assert.throws(() => requireLifecycleStatus('Maybe Later'), /Invalid lifecycle status/);
});

test('evaluateLifecycleTransition allows active movement and closing for normal CRM writers', () => {
  assert.deepEqual(
    evaluateLifecycleTransition({ fromStatus: 'New Lead', toStatus: 'Proposal Sent' }),
    { allowed: true, fromStatus: 'New Lead', toStatus: 'Proposal Sent', changed: true },
  );
  assert.deepEqual(
    evaluateLifecycleTransition({ fromStatus: 'Qualified', toStatus: 'Lost' }),
    { allowed: true, fromStatus: 'Qualified', toStatus: 'Lost', changed: true },
  );
});

test('evaluateLifecycleTransition requires all-division authority to reopen closed leads', () => {
  assert.deepEqual(
    evaluateLifecycleTransition({ fromStatus: 'Won', toStatus: 'Contacted' }),
    {
      allowed: false,
      fromStatus: 'Won',
      toStatus: 'Contacted',
      changed: true,
      reason: 'Only all-division users can change a closed lead status.',
    },
  );
  assert.deepEqual(
    evaluateLifecycleTransition({ fromStatus: 'Lost', toStatus: 'Qualified', canReopenClosedStatus: true }),
    { allowed: true, fromStatus: 'Lost', toStatus: 'Qualified', changed: true },
  );
});
