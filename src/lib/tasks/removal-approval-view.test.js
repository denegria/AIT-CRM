import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReviewTaskRemovalApprovals,
  taskRemovalApprovalState,
} from './removal-approval-view.js';

test('only active reviewer roles receive task removal approval controls', () => {
  assert.equal(canReviewTaskRemovalApprovals({ roleKeys: ['account_coordinator'] }), false);
  assert.equal(canReviewTaskRemovalApprovals({ roleKeys: ['senior_coordinator'] }), true);
  assert.equal(canReviewTaskRemovalApprovals({ primaryRoleKey: 'admin' }), true);
  assert.equal(canReviewTaskRemovalApprovals({ roleKeys: ['sales_manager'] }), false);
});
test('task removal state is read from target metadata', () => {
  const state = { approvalTaskId: 'approval-1', decision: 'pending' };
  assert.deepEqual(taskRemovalApprovalState({ metadataJson: { removalApproval: state } }), state);
  assert.equal(taskRemovalApprovalState({}), null);
});
