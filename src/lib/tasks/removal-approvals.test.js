import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTaskCancellationReason,
  canReviewTaskRemovalApproval,
  cancelTaskDirectly,
  createOrReuseTaskRemovalApprovalTask,
  decideTaskRemovalApprovalTask,
} from './removal-approvals.js';
import {
  TASK_PRIORITIES,
  TASK_SOURCE_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
} from './constants.js';

function session(roleKeys = ['account_coordinator'], overrides = {}) {
  return {
    user: {
      id: overrides.id || 'user-1',
      organizationId: 'org-1',
      name: overrides.name || 'User One',
      email: overrides.email || 'user@example.com',
      roleKeys,
      primaryRoleKey: roleKeys[0],
      businessUnitIds: ['bu-1'],
      ...overrides,
    },
  };
}

class SelectBuilder {
  constructor(db) {
    this.db = db;
  }
  from() { return this; }
  innerJoin() { return this; }
  where() { return this; }
  orderBy() { return this; }
  limit() {
    return Promise.resolve(this.db.selectRows.shift() || []);
  }
}

class InsertBuilder {
  constructor(db) {
    this.db = db;
  }
  values(value) {
    this.db.inserted.push(value);
    return this;
  }
  onConflictDoNothing() { return this; }
  returning() {
    return Promise.resolve(this.db.insertReturnRows.shift() || []);
  }
  then(resolve) {
    return Promise.resolve([]).then(resolve);
  }
}

class UpdateBuilder {
  constructor(db) {
    this.db = db;
    this.patch = {};
  }
  set(patch) {
    this.patch = patch;
    this.db.updated.push(patch);
    return this;
  }
  where() { return this; }
  returning() {
    const rows = this.db.updateReturnRows.shift() || [];
    return Promise.resolve(rows.map((row) => ({ ...row, ...this.patch })));
  }
}

function fakeDb({ selectRows = [], insertReturnRows = [], updateReturnRows = [] } = {}) {
  const db = {
    selectRows: [...selectRows],
    insertReturnRows: [...insertReturnRows],
    updateReturnRows: [...updateReturnRows],
    inserted: [],
    updated: [],
    select() { return new SelectBuilder(this); },
    insert() { return new InsertBuilder(this); },
    update() { return new UpdateBuilder(this); },
    transaction(callback) { return callback(this); },
  };
  return db;
}

const targetTask = {
  id: 'task-target',
  organizationId: 'org-1',
  businessUnitId: 'bu-1',
  contactId: 'contact-1',
  leadId: 'lead-1',
  workOrderId: null,
  title: 'Call student',
  taskType: TASK_TYPES.FOLLOW_UP,
  status: TASK_STATUSES.OPEN,
  ownerUserId: 'user-1',
  metadataJson: { existing: true },
};

test('direct cancellation requires a reason', () => {
  assert.throws(
    () => assertTaskCancellationReason('  '),
    (error) => error.status === 400 && /reason is required/i.test(error.message),
  );
});

test('eligible direct cancellation closes the task and records auditable reason metadata', async () => {
  const directTask = {
    ...targetTask,
    createdByUserId: 'user-1',
    sourceType: TASK_SOURCE_TYPES.MANUAL,
    priority: TASK_PRIORITIES.MEDIUM,
    dueAt: new Date('2026-07-22T13:00:00.000Z'),
  };
  const db = fakeDb({ updateReturnRows: [[directTask]] });
  const now = new Date('2026-07-21T18:45:00.000Z');

  const result = await cancelTaskDirectly({
    db,
    organizationId: 'org-1',
    session: session(),
    existingTask: directTask,
    reason: 'Duplicate reminder created by mistake.',
    now,
  });

  assert.equal(result.task.status, TASK_STATUSES.CANCELED);
  assert.equal(result.task.canceledAt.toISOString(), now.toISOString());
  assert.equal(result.task.metadataJson.cancellation.reason, 'Duplicate reminder created by mistake.');
  assert.equal(result.task.metadataJson.cancellation.actorUserId, 'user-1');
  assert.equal(db.inserted.length, 2);
  assert.equal(db.inserted[0].eventType, 'canceled');
  assert.equal(db.inserted[0].metadataJson.reason, 'Duplicate reminder created by mistake.');
  assert.equal(db.inserted[1].eventType, 'task.canceled');
});

test('regular coordinator task removal requests create reviewer-owned approval tasks', async () => {
  const reviewer = { id: 'senior-1', name: 'Senior One', email: 'senior@example.com' };
  const updatedTargetTask = {
    ...targetTask,
    metadataJson: {
      existing: true,
      removalApproval: { decision: 'pending' },
    },
  };
  const db = fakeDb({
    selectRows: [[], [reviewer]],
    insertReturnRows: [
      [{
        id: 'approval-task',
        organizationId: 'org-1',
        businessUnitId: 'bu-1',
        contactId: 'contact-1',
        leadId: 'lead-1',
        taskType: TASK_TYPES.TASK_REMOVAL_APPROVAL,
        status: TASK_STATUSES.OPEN,
        ownerUserId: reviewer.id,
        metadataJson: {},
      }],
      [{ id: 'notification-1' }],
    ],
    updateReturnRows: [[updatedTargetTask]],
  });

  const result = await createOrReuseTaskRemovalApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['account_coordinator']),
    targetTask,
    reason: 'Duplicate task.',
  });

  assert.equal(result.reused, false);
  assert.equal(result.task.taskType, TASK_TYPES.TASK_REMOVAL_APPROVAL);
  assert.equal(result.task.ownerUserId, 'senior-1');
  assert.equal(result.targetTask.metadataJson.removalApproval.decision, 'pending');
  assert.equal(db.inserted[0].sourceType, 'task_removal_approval');
  assert.equal(db.inserted[0].metadataJson.targetTaskId, 'task-target');
  const notification = db.inserted.find((row) => row.type === 'task_removal_approval_requested');
  assert.equal(Boolean(notification), true);
  assert.equal(notification.href, '/tasks/approval-task');
});

test('regular coordinator task removal requests reuse an existing open approval task', async () => {
  const existingApproval = {
    id: 'approval-existing',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    taskType: TASK_TYPES.TASK_REMOVAL_APPROVAL,
    status: TASK_STATUSES.OPEN,
    metadataJson: { decision: 'pending', targetTaskId: targetTask.id },
  };
  const db = fakeDb({ selectRows: [[existingApproval]] });

  const result = await createOrReuseTaskRemovalApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['account_coordinator']),
    targetTask,
    reason: 'Duplicate task.',
  });

  assert.equal(result.reused, true);
  assert.equal(result.task.id, 'approval-existing');
  assert.equal(db.inserted.length, 0);
});

test('only senior coordinators and admins can review task removal approvals', async () => {
  assert.equal(canReviewTaskRemovalApproval(session(['account_coordinator'])), false);
  assert.equal(canReviewTaskRemovalApproval(session(['senior_coordinator'])), true);
  assert.equal(canReviewTaskRemovalApproval(session(['admin'])), true);

  await assert.rejects(
    () => decideTaskRemovalApprovalTask({
      db: fakeDb(),
      organizationId: 'org-1',
      session: session(['account_coordinator']),
      existingTask: { taskType: TASK_TYPES.TASK_REMOVAL_APPROVAL, status: TASK_STATUSES.OPEN },
      decision: 'approve',
    }),
    /Only senior coordinators and admins/,
  );
});

test('approval cancels target task and completes approval task', async () => {
  const approvalTask = {
    id: 'approval-task',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    ownerUserId: 'senior-1',
    taskType: TASK_TYPES.TASK_REMOVAL_APPROVAL,
    status: TASK_STATUSES.OPEN,
    metadataJson: {
      requesterUserId: 'user-1',
      requestedReason: 'Duplicate.',
      targetTaskId: targetTask.id,
      targetTaskTitle: targetTask.title,
    },
  };
  const db = fakeDb({
    selectRows: [[targetTask]],
    updateReturnRows: [
      [{ ...approvalTask, status: TASK_STATUSES.COMPLETED }],
      [{ ...targetTask, status: TASK_STATUSES.CANCELED }],
    ],
  });

  const result = await decideTaskRemovalApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['senior_coordinator'], { id: 'senior-1' }),
    existingTask: approvalTask,
    decision: 'approve',
    reason: 'Clean duplicate.',
  });

  assert.equal(result.decision, 'approve');
  assert.equal(result.task.status, TASK_STATUSES.COMPLETED);
  assert.equal(result.targetTask.status, TASK_STATUSES.CANCELED);
  assert.equal(db.updated[0].status, TASK_STATUSES.COMPLETED);
  assert.equal(db.updated[1].status, TASK_STATUSES.CANCELED);
  assert.equal(db.updated[1].metadataJson.removalApproval.decision, 'approved');
});

test('denial closes approval task without canceling target task', async () => {
  const approvalTask = {
    id: 'approval-task',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    taskType: TASK_TYPES.TASK_REMOVAL_APPROVAL,
    status: TASK_STATUSES.OPEN,
    metadataJson: {
      requesterUserId: 'user-1',
      requestedReason: 'Duplicate.',
      targetTaskId: targetTask.id,
      targetTaskTitle: targetTask.title,
    },
  };
  const db = fakeDb({
    updateReturnRows: [[{ ...approvalTask, status: TASK_STATUSES.CANCELED }]],
  });

  const result = await decideTaskRemovalApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['admin'], { id: 'admin-1' }),
    existingTask: approvalTask,
    decision: 'deny',
    reason: 'Keep active.',
  });

  assert.equal(result.decision, 'deny');
  assert.equal(result.task.status, TASK_STATUSES.CANCELED);
  assert.equal(result.targetTask, null);
  assert.equal(db.updated.length, 1);
  assert.equal(db.updated[0].metadataJson.decision, 'denied');
});
