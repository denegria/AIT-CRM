import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleAutomatedInboundFollowUpTask,
  planAutomatedInboundFollowUpReconciliation,
} from './integrity-policy.js';

function task(overrides = {}) {
  return {
    id: 'task-1',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    taskType: 'follow_up',
    sourceType: 'automation',
    sourceLabel: 'New lead follow-up',
    leadSourceType: 'website_form',
    status: 'open',
    ownerUserId: 'owner-old',
    ...overrides,
  };
}

test('automated inbound follow-up eligibility excludes manual, closed, cross-business-unit, historical, and imported tasks', () => {
  const scope = { organizationId: 'org-1', businessUnitId: 'bu-1', contactId: 'contact-1' };
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task(), scope), true);
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task({ sourceType: 'manual' }), scope), false);
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task({ status: 'completed' }), scope), false);
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task({ businessUnitId: 'bu-2' }), scope), false);
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task({ sourceLabel: 'Recurring task' }), scope), false);
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task({ leadSourceType: 'wix_historical_import' }), scope), false);
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task({ leadSourceType: 'xlsx' }), scope), false);
  assert.equal(isEligibleAutomatedInboundFollowUpTask(task({ leadSourceType: 'facebook_lead_ads' }), scope), true);
});

test('owner synchronization selects only changed eligible tasks and is idempotent', () => {
  const params = {
    organizationId: 'org-1', businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'lead-1',
    actorUserId: 'actor-1', ownerUserId: 'owner-new', action: 'sync_owner', source: 'contact_assignment',
  };
  const result = planAutomatedInboundFollowUpReconciliation([task(), task({ id: 'manual', sourceType: 'manual' })], params);
  assert.deepEqual(result.map(({ task: row }) => row.id), ['task-1']);
  assert.deepEqual(planAutomatedInboundFollowUpReconciliation([task({ ownerUserId: 'owner-new' })], params), []);
});

test('owner synchronization treats an explicit null owner as an unassignment target', () => {
  const result = planAutomatedInboundFollowUpReconciliation([task({ ownerUserId: 'owner-old' })], {
    organizationId: 'org-1', businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'lead-1',
    action: 'sync_owner', ownerUserId: null,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].task.ownerUserId, 'owner-old');
});

test('lifecycle cancellation selects open automated tasks without completing or reopening work', () => {
  const result = planAutomatedInboundFollowUpReconciliation([task({ status: 'snoozed' }), task({ id: 'canceled', status: 'canceled' })], {
    organizationId: 'org-1', businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'lead-1',
    actorUserId: 'actor-1', action: 'cancel', source: 'contact_lifecycle',
    reason: 'no_further_prospecting_lifecycle', lifecycleStatus: 'Enrolled',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].action, 'cancel');
  assert.equal(result[0].task.status, 'snoozed');
});
