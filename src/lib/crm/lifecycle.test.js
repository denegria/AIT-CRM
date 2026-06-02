import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateLifecycleTransition,
  lifecycleWorkflowForBusinessUnit,
  normalizeLifecycleStatus,
  requireLifecycleStatus,
  workflowKeyForBusinessUnit,
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

test('lifecycle workflows resolve division-specific statuses', () => {
  assert.equal(workflowKeyForBusinessUnit({ name: 'AIT USA Institute' }), 'ait_usa');
  assert.equal(workflowKeyForBusinessUnit({ name: 'AIT Signs' }), 'ait_signs');
  assert.deepEqual(
    lifecycleWorkflowForBusinessUnit({ name: 'AIT USA Institute' }).statuses,
    ['New Lead', 'Follow Up', 'Enrolled', 'Completed / Previous Student'],
  );
  assert.deepEqual(
    lifecycleWorkflowForBusinessUnit({ name: 'AIT Signs' }).statuses,
    ['Intake', 'Estimate', 'Work Order', 'Fulfillment', 'Invoice / Payment'],
  );
  assert.equal(normalizeLifecycleStatus('contacted', { businessUnit: { name: 'AIT USA Institute' } }), 'Follow Up');
  assert.equal(normalizeLifecycleStatus('won', { businessUnit: { name: 'AIT USA Institute' } }), 'Enrolled');
  assert.equal(normalizeLifecycleStatus('proposal sent', { businessUnit: { name: 'AIT Signs' } }), 'Estimate');
  assert.equal(normalizeLifecycleStatus('in production', { businessUnit: { name: 'AIT Signs' } }), 'Fulfillment');
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

test('evaluateLifecycleTransition validates against the selected division workflow', () => {
  assert.deepEqual(
    evaluateLifecycleTransition({
      fromStatus: 'New Lead',
      toStatus: 'Follow Up',
      businessUnit: { name: 'AIT USA Institute' },
    }),
    { allowed: true, fromStatus: 'New Lead', toStatus: 'Follow Up', changed: true },
  );
  assert.deepEqual(
    evaluateLifecycleTransition({
      fromStatus: 'Estimate',
      toStatus: 'Work Order',
      businessUnit: { name: 'AIT Signs' },
    }),
    { allowed: true, fromStatus: 'Estimate', toStatus: 'Work Order', changed: true },
  );
  assert.throws(
    () => evaluateLifecycleTransition({
      fromStatus: 'Intake',
      toStatus: 'Enrolled',
      businessUnit: { name: 'AIT Signs' },
    }),
    /Invalid lifecycle status/,
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
