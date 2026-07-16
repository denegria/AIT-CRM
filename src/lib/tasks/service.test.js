import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  completeFollowUpTaskWithActivity,
  reconcileAutomatedInboundFollowUpTasks,
  recordFollowUpActivity,
} from './service.js';

function followUpTask(overrides = {}) {
  return {
    id: 'task-1',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    taskType: 'follow_up',
    sourceType: 'automation',
    sourceLabel: 'New lead follow-up',
    status: 'open',
    ownerUserId: 'owner-old',
    dueAt: new Date('2026-07-01T09:00:00.000Z'),
    ...overrides,
  };
}

function reconciliationTx({ selectedTasks, updatedTasks = [] }) {
  const inserts = [];
  const selectConditions = [];
  const updateConditions = [];
  const patches = [];
  let updateIndex = 0;
  return {
    inserts,
    selectConditions,
    updateConditions,
    patches,
    tx: {
      select() {
        return {
          from() { return this; },
          where(condition) {
            selectConditions.push(condition);
            return Promise.resolve(selectedTasks);
          },
        };
      },
      update() {
        return {
          set(patch) {
            patches.push(patch);
            return this;
          },
          where(condition) {
            updateConditions.push(condition);
            return this;
          },
          returning() {
            return Promise.resolve(updatedTasks[updateIndex++] || []);
          },
        };
      },
      insert() {
        return {
          values(value) {
            inserts.push(value);
            return Promise.resolve();
          },
        };
      },
    },
  };
}

const scope = {
  organizationId: 'org-1',
  businessUnitId: 'bu-1',
  contactId: 'contact-1',
  leadId: 'lead-1',
  actorUserId: 'actor-1',
  source: 'contact_assignment',
  reason: 'contact_owner_changed',
};

test('reconciliation mechanics assign, reassign, and unassign only eligible inbound follow-ups with attributed events', async () => {
  for (const { name, fromOwner, toOwner } of [
    { name: 'assignment', fromOwner: null, toOwner: 'owner-a' },
    { name: 'reassignment', fromOwner: 'owner-old', toOwner: 'owner-b' },
    { name: 'unassignment', fromOwner: 'owner-old', toOwner: null },
  ]) {
    const eligible = followUpTask({ id: `task-${name}`, ownerUserId: fromOwner });
    const { tx, inserts, patches } = reconciliationTx({
      selectedTasks: [
        eligible,
        followUpTask({ id: `manual-${name}`, sourceType: 'manual' }),
        followUpTask({ id: `closed-${name}`, status: 'completed' }),
        followUpTask({ id: `other-bu-${name}`, businessUnitId: 'bu-2' }),
        followUpTask({ id: `approval-${name}`, taskType: 'archive_approval' }),
        followUpTask({ id: `recurring-${name}`, sourceLabel: 'Recurring task' }),
      ],
      updatedTasks: [[{ ...eligible, ownerUserId: toOwner }]],
    });

    const result = await reconcileAutomatedInboundFollowUpTasks(tx, {
      ...scope,
      ownerUserId: toOwner,
      action: 'sync_owner',
    });

    assert.equal(result.changedTasks.length, 1, name);
    assert.equal(patches.length, 1, name);
    assert.equal(patches[0].ownerUserId, toOwner, name);
    assert.equal(inserts.length, 1, name);
    assert.deepEqual(inserts[0], {
      taskId: eligible.id,
      organizationId: 'org-1',
      businessUnitId: 'bu-1',
      eventType: 'assigned',
      fromStatus: 'open',
      toStatus: 'open',
      fromOwnerUserId: fromOwner,
      toOwnerUserId: toOwner,
      fromDueAt: eligible.dueAt,
      toDueAt: eligible.dueAt,
      actorUserId: 'actor-1',
      message: 'Synchronized automated inbound follow-up owner with contact assignment.',
      metadataJson: {
        source: 'contact_assignment',
        reason: 'contact_owner_changed',
        contactId: 'contact-1',
        leadId: 'lead-1',
        lifecycleStatus: null,
      },
      occurredAt: inserts[0].occurredAt,
    }, name);
  }
});

test('reconciliation cancellation records accurate previous task state and does not fake completion', async () => {
  const existing = followUpTask({ status: 'snoozed', ownerUserId: 'owner-a' });
  const canceled = { ...existing, status: 'canceled', canceledAt: new Date(), completedAt: null, snoozedUntil: null };
  const { tx, inserts, patches } = reconciliationTx({ selectedTasks: [existing], updatedTasks: [[canceled]] });

  const result = await reconcileAutomatedInboundFollowUpTasks(tx, {
    ...scope,
    action: 'cancel',
    source: 'follow_up_completion',
    reason: 'no_further_prospecting_lifecycle',
    lifecycleStatus: 'Not Interested',
  });

  assert.equal(result.changedTasks[0].status, 'canceled');
  assert.equal(patches[0].completedAt, null);
  assert.equal(inserts[0].eventType, 'canceled');
  assert.equal(inserts[0].fromStatus, 'snoozed');
  assert.equal(inserts[0].toStatus, 'canceled');
  assert.equal(inserts[0].fromOwnerUserId, 'owner-a');
  assert.equal(inserts[0].toOwnerUserId, 'owner-a');
  assert.equal(inserts[0].fromDueAt, existing.dueAt);
  assert.equal(inserts[0].toDueAt, existing.dueAt);
  assert.equal(inserts[0].actorUserId, 'actor-1');
  assert.equal(inserts[0].metadataJson.reason, 'no_further_prospecting_lifecycle');
  assert.equal(inserts[0].metadataJson.lifecycleStatus, 'Not Interested');
});

test('reconciliation rechecks every task eligibility predicate before writing and emits nothing when a concurrent completion wins', async () => {
  const existing = followUpTask();
  const { tx, inserts, selectConditions, updateConditions } = reconciliationTx({
    selectedTasks: [existing],
    // Models a completion or eligibility change after selection but before UPDATE.
    updatedTasks: [[]],
  });

  const result = await reconcileAutomatedInboundFollowUpTasks(tx, {
    ...scope,
    action: 'cancel',
    source: 'contact_lifecycle',
    reason: 'no_further_prospecting_lifecycle',
    lifecycleStatus: 'Enrolled',
  });

  assert.equal(result.changedTasks.length, 0);
  assert.equal(inserts.length, 0);
  for (const condition of [selectConditions[0], updateConditions[0]]) {
    const query = new PgDialect().sqlToQuery(condition);
    for (const field of ['organization_id', 'business_unit_id', 'contact_id', 'lead_id', 'task_type', 'source_type', 'source_label', 'status']) {
      assert.match(query.sql, new RegExp(`"tasks"\\."${field}"`));
    }
  }
});

test('owner synchronization rejects an omitted owner without reading or writing tasks', async () => {
  const tx = {
    select() { throw new Error('omitted owner must not query tasks'); },
  };
  const result = await reconcileAutomatedInboundFollowUpTasks(tx, {
    ...scope,
    action: 'sync_owner',
  });
  assert.deepEqual(result, { changedTasks: [], reason: 'missing_owner' });
});

test('repeated owner reconciliation is idempotent and does not duplicate task events', async () => {
  const alreadySynchronized = followUpTask({ ownerUserId: 'owner-a' });
  const { tx, inserts, patches } = reconciliationTx({ selectedTasks: [alreadySynchronized] });

  const result = await reconcileAutomatedInboundFollowUpTasks(tx, {
    ...scope,
    ownerUserId: 'owner-a',
    action: 'sync_owner',
  });

  assert.equal(result.changedTasks.length, 0);
  assert.equal(patches.length, 0);
  assert.equal(inserts.length, 0);
});

function structuredFollowUpDb({ currentTask = null, linkedTask }) {
  const inserts = [];
  const updatePatches = [];
  const updateRows = [
    ...(currentTask ? [[{ ...currentTask, status: 'completed', completedAt: new Date('2026-07-03T09:00:00.000Z') }]] : []),
    [{ ...linkedTask, status: 'canceled', canceledAt: new Date('2026-07-03T09:00:00.000Z'), completedAt: null }],
  ];
  let updateIndex = 0;
  const tx = {
    update() {
      return {
        set(patch) {
          updatePatches.push(patch);
          return this;
        },
        where() { return this; },
        returning() {
          return Promise.resolve(updateRows[updateIndex++] || []);
        },
      };
    },
    select() {
      return {
        from() { return this; },
        where() { return Promise.resolve([linkedTask]); },
      };
    },
    insert() {
      return {
        values(value) {
          inserts.push(value);
          return Promise.resolve();
        },
      };
    },
  };
  return { inserts, updatePatches, db: { transaction: (callback) => callback(tx) } };
}

test('structured follow-up completion cancels linked automated tasks through audited reconciliation', async () => {
  const currentTask = followUpTask({ id: 'task-completed', status: 'open' });
  const linkedTask = followUpTask({ id: 'task-linked', status: 'snoozed', ownerUserId: 'owner-linked' });
  const { db, inserts, updatePatches } = structuredFollowUpDb({ currentTask, linkedTask });

  await completeFollowUpTaskWithActivity({
    db,
    organizationId: 'org-1',
    actorUserId: 'actor-1',
    existingTask: currentTask,
    taskPatch: { status: 'completed' },
    followUpActivity: { eventType: 'follow_up.reached_not_interested', message: 'Not interested.' },
    cancelOpenFollowUps: true,
    cancelOpenFollowUpsContext: { source: 'follow_up_completion', lifecycleStatus: 'Not Interested' },
  });

  const canceledEvent = inserts.find((value) => value.eventType === 'canceled');
  assert.ok(canceledEvent);
  assert.equal(canceledEvent.taskId, 'task-linked');
  assert.equal(canceledEvent.fromStatus, 'snoozed');
  assert.equal(canceledEvent.toStatus, 'canceled');
  assert.equal(canceledEvent.fromOwnerUserId, 'owner-linked');
  assert.equal(canceledEvent.actorUserId, 'actor-1');
  assert.equal(canceledEvent.metadataJson.reason, 'no_further_prospecting_lifecycle');
  assert.equal(updatePatches[0].status, 'completed');
  assert.equal(updatePatches[1].status, 'canceled');
  assert.ok(inserts.findIndex((value) => value.eventType === 'completed') < inserts.findIndex((value) => value.eventType === 'canceled'));
});

test('structured follow-up activity cancellation uses the same audited mechanics', async () => {
  const linkedTask = followUpTask({ id: 'task-linked', status: 'in_progress' });
  const { db, inserts, updatePatches } = structuredFollowUpDb({ linkedTask });

  await recordFollowUpActivity({
    db,
    organizationId: 'org-1',
    actorUserId: 'actor-1',
    context: { businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'lead-1' },
    followUpActivity: { eventType: 'follow_up.reached_not_interested', message: 'Not interested.' },
    cancelOpenFollowUps: true,
    cancelOpenFollowUpsContext: { source: 'follow_up_activity', lifecycleStatus: 'Not Interested' },
  });

  const canceledEvent = inserts.find((value) => value.eventType === 'canceled');
  assert.ok(canceledEvent);
  assert.equal(canceledEvent.fromStatus, 'in_progress');
  assert.equal(canceledEvent.toStatus, 'canceled');
  assert.equal(canceledEvent.metadataJson.source, 'follow_up_activity');
  assert.equal(updatePatches.length, 1);
  assert.equal(updatePatches[0].status, 'canceled');
});
