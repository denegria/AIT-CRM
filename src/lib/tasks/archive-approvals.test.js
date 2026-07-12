import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReviewArchiveApproval,
  createOrReuseArchiveApprovalTask,
  decideArchiveApprovalTask,
} from './archive-approvals.js';
import { TASK_STATUSES, TASK_TYPES } from './constants.js';

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

const contact = {
  id: 'contact-1',
  name: 'Ada Contact',
  primaryBusinessUnitId: 'bu-1',
};

test('regular coordinator archive requests reuse an existing open approval task', async () => {
  const existingTask = {
    id: 'task-existing',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    taskType: TASK_TYPES.ARCHIVE_APPROVAL,
    status: TASK_STATUSES.OPEN,
    metadataJson: { decision: 'pending' },
  };
  const db = fakeDb({ selectRows: [[existingTask]] });

  const result = await createOrReuseArchiveApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['account_coordinator']),
    contact,
    reason: 'Duplicate imported contact.',
  });

  assert.equal(result.reused, true);
  assert.equal(result.task.id, 'task-existing');
  assert.equal(db.inserted.length, 0);
});

test('regular coordinator archive requests create a reviewer-owned approval task', async () => {
  const reviewer = { id: 'senior-1', name: 'Senior One', email: 'senior@example.com' };
  const db = fakeDb({
    selectRows: [[], [reviewer]],
    insertReturnRows: [
      [{
        id: 'task-new',
        organizationId: 'org-1',
        businessUnitId: 'bu-1',
        contactId: 'contact-1',
        taskType: TASK_TYPES.ARCHIVE_APPROVAL,
        status: TASK_STATUSES.OPEN,
        ownerUserId: reviewer.id,
        metadataJson: {},
      }],
      [{ id: 'notification-1' }],
    ],
  });

  const result = await createOrReuseArchiveApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['account_coordinator']),
    contact,
    reason: 'Duplicate imported contact.',
  });

  assert.equal(result.reused, false);
  assert.equal(result.task.ownerUserId, 'senior-1');
  assert.equal(db.inserted[0].taskType, TASK_TYPES.ARCHIVE_APPROVAL);
  assert.equal(db.inserted[0].metadataJson.requesterUserId, 'user-1');
  assert.equal(db.inserted[0].metadataJson.requestedReason, 'Duplicate imported contact.');
  const notification = db.inserted.find((row) => row.type === 'archive_approval_requested');
  assert.equal(Boolean(notification), true);
  assert.equal(notification.href, '/tasks/task-new');
});

test('only senior coordinators and admins can review archive approvals', async () => {
  assert.equal(canReviewArchiveApproval(session(['account_coordinator'])), false);
  assert.equal(canReviewArchiveApproval(session(['senior_coordinator'])), true);
  assert.equal(canReviewArchiveApproval(session(['admin'])), true);

  await assert.rejects(
    () => decideArchiveApprovalTask({
      db: fakeDb(),
      organizationId: 'org-1',
      session: session(['account_coordinator']),
      existingTask: { taskType: TASK_TYPES.ARCHIVE_APPROVAL, status: TASK_STATUSES.OPEN },
      decision: 'approve',
    }),
    /Only senior coordinators and admins/,
  );
});

test('approval archives the contact and completes the approval task', async () => {
  const db = fakeDb({
    updateReturnRows: [
      [{
        id: 'task-1',
        organizationId: 'org-1',
        businessUnitId: 'bu-1',
        contactId: 'contact-1',
        leadId: null,
        ownerUserId: 'senior-1',
        taskType: TASK_TYPES.ARCHIVE_APPROVAL,
        status: TASK_STATUSES.OPEN,
        metadataJson: { requesterUserId: 'user-1', requestedReason: 'Duplicate.' },
      }],
      [{ id: 'contact-1', name: 'Ada Contact', primaryBusinessUnitId: 'bu-1' }],
    ],
  });

  const result = await decideArchiveApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['senior_coordinator'], { id: 'senior-1' }),
    existingTask: {
      id: 'task-1',
      businessUnitId: 'bu-1',
      contactId: 'contact-1',
      leadId: null,
      ownerUserId: 'senior-1',
      taskType: TASK_TYPES.ARCHIVE_APPROVAL,
      status: TASK_STATUSES.OPEN,
      metadataJson: { requesterUserId: 'user-1', requestedReason: 'Duplicate.' },
    },
    decision: 'approve',
    reason: 'Clean duplicate.',
  });

  assert.equal(result.decision, 'approve');
  assert.equal(result.archivedContact.id, 'contact-1');
  assert.equal(db.updated[0].status, TASK_STATUSES.COMPLETED);
  assert.equal(db.updated[1].archiveReason, 'Clean duplicate.');
});

test('denial cancels the approval task without archiving the contact', async () => {
  const db = fakeDb({
    updateReturnRows: [
      [{
        id: 'task-1',
        organizationId: 'org-1',
        businessUnitId: 'bu-1',
        contactId: 'contact-1',
        leadId: null,
        ownerUserId: 'senior-1',
        taskType: TASK_TYPES.ARCHIVE_APPROVAL,
        status: TASK_STATUSES.OPEN,
        metadataJson: { requesterUserId: 'user-1', requestedReason: 'Duplicate.' },
      }],
    ],
  });

  const result = await decideArchiveApprovalTask({
    db,
    organizationId: 'org-1',
    session: session(['admin'], { id: 'admin-1' }),
    existingTask: {
      id: 'task-1',
      businessUnitId: 'bu-1',
      contactId: 'contact-1',
      leadId: null,
      ownerUserId: 'senior-1',
      taskType: TASK_TYPES.ARCHIVE_APPROVAL,
      status: TASK_STATUSES.OPEN,
      metadataJson: { requesterUserId: 'user-1', requestedReason: 'Duplicate.' },
    },
    decision: 'deny',
    reason: 'Keep for active follow-up.',
  });

  assert.equal(result.decision, 'deny');
  assert.equal(result.archivedContact, null);
  assert.equal(db.updated.length, 1);
  assert.equal(db.updated[0].status, TASK_STATUSES.CANCELED);
  assert.equal(db.updated[0].metadataJson.decision, 'denied');
});
