import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  completeFollowUpTaskWithActivity,
  reconcileAutomatedInboundFollowUpTasks,
  recordFollowUpActivity,
  toTaskPayload,
} from './service.js';

test('task payload exposes the server cancellation decision when a session is provided', () => {
  const payload = toTaskPayload({
    id: 'task-policy',
    status: 'open',
    taskType: 'manual_reminder',
    priority: 'low',
    ownerUserId: 'user-1',
    createdByUserId: 'user-1',
    sourceType: 'manual',
    metadataJson: {},
  }, {
    session: {
      user: {
        id: 'user-1',
        primaryRoleKey: 'account_coordinator',
        roleKeys: ['account_coordinator'],
      },
    },
  });

  assert.equal(payload.cancellationPolicy.decision, 'direct_cancel');
  assert.equal(payload.cancellationPolicy.requiresReason, true);
});

test('task transition payload stays scoped to the authorized task and excludes internal or adjacent records', () => {
  const payload = toTaskPayload({
    id: 'task-scoped',
    organizationId: 'org-internal',
    businessUnitId: 'bu-1',
    contactId: 'contact-linked',
    title: 'Call student',
    taskType: 'manual_reminder',
    status: 'completed',
    priority: 'medium',
    ownerUserId: 'user-1',
    completedAt: new Date('2026-08-10T12:00:00.000Z'),
    metadataJson: {},
    auditEvents: [{ actorUserId: 'other-employee' }],
    employeeTasks: [{ id: 'other-task' }],
    secret: 'not-serialized',
  }, {
    session: {
      user: {
        id: 'user-1',
        primaryRoleKey: 'account_coordinator',
        roleKeys: ['account_coordinator'],
      },
    },
  });

  assert.deepEqual(Object.keys(payload), [
    'id', 'title', 'description', 'businessUnitId', 'contactId', 'contactName',
    'leadId', 'workOrderId', 'taskType', 'status', 'priority', 'dueAt',
    'snoozedUntil', 'completedAt', 'canceledAt', 'ownerUserId',
    'createdByUserId', 'sourceType', 'sourceId', 'sourceLabel', 'metadataJson',
    'previousFollowUp', 'cancellationPolicy', 'createdAt', 'updatedAt',
  ]);
  assert.equal(payload.contactId, 'contact-linked');
  for (const forbidden of ['organizationId', 'auditEvents', 'employeeTasks', 'secret']) {
    assert.equal(Object.hasOwn(payload, forbidden), false);
  }
});

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
    leadSourceType: 'website_form',
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
          innerJoin() { return this; },
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
  const updateQuery = new PgDialect().sqlToQuery(updateConditions[0]);
  assert.match(updateQuery.sql, /"leads"\."source_type"/);
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
        innerJoin() { return this; },
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
    followUpOutcome: 'reached_not_interested',
    followUpChannel: 'phone',
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
    followUpOutcome: 'reached_not_interested',
    followUpChannel: 'phone',
  });

  const canceledEvent = inserts.find((value) => value.eventType === 'canceled');
  assert.ok(canceledEvent);
  assert.equal(canceledEvent.fromStatus, 'in_progress');
  assert.equal(canceledEvent.toStatus, 'canceled');
  assert.equal(canceledEvent.metadataJson.source, 'follow_up_activity');
  assert.equal(updatePatches.length, 1);
  assert.equal(updatePatches[0].status, 'canceled');
});

test('exact follow-up completion updates one selected task once and a stale retry makes no partial writes', async () => {
  const selectedTask = followUpTask({ id: 'task-selected' });
  const otherOpenTask = followUpTask({ id: 'task-other' });
  const inserts = [];
  const updateConditions = [];
  let completionAttempts = 0;
  const tx = {
    update() {
      return {
        set() { return this; },
        where(condition) {
          updateConditions.push(condition);
          return this;
        },
        returning() {
          completionAttempts += 1;
          return Promise.resolve(completionAttempts === 1
            ? [{ ...selectedTask, status: 'completed', completedAt: new Date('2026-07-03T09:00:00.000Z') }]
            : []);
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
  };
  const db = { transaction: (callback) => callback(tx) };
  const input = {
    db,
    organizationId: 'org-1',
    actorUserId: 'actor-1',
    existingTask: selectedTask,
    taskPatch: { status: 'completed' },
    followUpActivity: {
      eventType: 'follow_up.reached_interested',
      message: 'Reached and interested.',
      noteBody: 'Reached and interested.',
    },
    followUpOutcome: 'reached_interested',
    followUpChannel: 'phone',
  };

  const first = await completeFollowUpTaskWithActivity(input);
  assert.equal(first.task.id, selectedTask.id);
  assert.equal(otherOpenTask.status, 'open');
  assert.equal(inserts.filter((value) => value.taskId === selectedTask.id && value.eventType === 'completed').length, 1);
  const firstCondition = new PgDialect().sqlToQuery(updateConditions[0]);
  assert.ok(firstCondition.params.includes(selectedTask.id));
  assert.equal(firstCondition.params.includes(otherOpenTask.id), false);
  for (const field of ['business_unit_id', 'contact_id', 'lead_id', 'owner_user_id', 'task_type', 'status']) {
    assert.match(firstCondition.sql, new RegExp(`"tasks"\\."${field}"`));
  }

  const writesAfterFirstCompletion = inserts.length;
  await assert.rejects(
    completeFollowUpTaskWithActivity(input),
    (error) => error.status === 409 && error.code === 'follow_up_task_stale',
  );
  assert.equal(inserts.length, writesAfterFirstCompletion);
});

test('generic outreach leaves existing and concurrently-created follow-up tasks untouched', async () => {
  const existingTask = followUpTask({ id: 'task-existing' });
  const concurrentTask = followUpTask({ id: 'task-concurrent' });
  const inserts = [];
  const tx = {
    select() {
      throw new Error('Generic outreach must not inspect tasks.');
    },
    update() {
      throw new Error('Generic outreach must not update tasks.');
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

  await recordFollowUpActivity({
    db: { transaction: (callback) => callback(tx) },
    organizationId: 'org-1',
    actorUserId: 'actor-1',
    context: { businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'lead-1' },
    followUpActivity: {
      eventType: 'follow_up.attempted_no_answer',
      message: 'Attempted outreach; no answer.',
    },
    cancelOpenFollowUps: false,
    followUpOutcome: 'no_answer',
    followUpChannel: 'phone',
  });

  assert.equal(inserts.length, 2);
  assert.equal(existingTask.status, 'open');
  assert.equal(concurrentTask.status, 'open');
});

test('follow-up write services reject omitted or unknown outcome and channel before a transaction or write', async () => {
  for (const invalid of [
    { followUpOutcome: '', followUpChannel: 'phone' },
    { followUpOutcome: 'invented_positive', followUpChannel: 'phone' },
    { followUpOutcome: 'no_answer', followUpChannel: '' },
    { followUpOutcome: 'no_answer', followUpChannel: 'manual' },
  ]) {
    const calls = { transactions: 0, inserts: 0, updates: 0 };
    const db = {
      transaction(callback) {
        calls.transactions += 1;
        return callback({
          insert() {
            calls.inserts += 1;
            throw new Error('Invalid input must not insert.');
          },
          update() {
            calls.updates += 1;
            throw new Error('Invalid input must not update.');
          },
        });
      },
    };

    await assert.rejects(
      completeFollowUpTaskWithActivity({
        db,
        organizationId: 'org-1',
        actorUserId: 'actor-1',
        existingTask: followUpTask(),
        taskPatch: { status: 'completed' },
        followUpActivity: { eventType: 'follow_up.no_answer', message: 'No answer.' },
        ...invalid,
      }),
      /required|valid/,
    );
    await assert.rejects(
      recordFollowUpActivity({
        db,
        organizationId: 'org-1',
        actorUserId: 'actor-1',
        context: { businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'lead-1' },
        followUpActivity: { eventType: 'follow_up.no_answer', message: 'No answer.' },
        ...invalid,
      }),
      /required|valid/,
    );
    assert.deepEqual(calls, { transactions: 0, inserts: 0, updates: 0 });
  }
});

test('AIT USA follow-up services reject stale Opportunity identity before task, Lead, or activity writes', async () => {
  for (const surface of ['task completion', 'contact outreach']) {
    const calls = { transactions: 0, queries: 0, updates: 0, inserts: 0 };
    const tx = {
      async query(text) {
        calls.queries += 1;
        const normalized = String(text).replace(/\s+/g, ' ').trim();
        if (normalized.includes('order by created_at')) {
          return {
            rows: [{
              id: 'active-b',
              organization_id: 'org-1',
              business_unit_id: 'bu-1',
              contact_id: 'contact-1',
              status: 'New Lead',
              current_stage: 'New Lead',
            }],
          };
        }
        return { rows: [] };
      },
      update() {
        calls.updates += 1;
        throw new Error('A stale Opportunity must not update a task or Lead.');
      },
      insert() {
        calls.inserts += 1;
        throw new Error('A stale Opportunity must not insert activity or history.');
      },
    };
    const db = {
      transaction(callback) {
        calls.transactions += 1;
        return callback(tx);
      },
    };
    const aitUsaOpportunityMutation = {
      organizationId: 'org-1',
      businessUnit: { id: 'bu-1', name: 'AIT USA Institute' },
      contact: { id: 'contact-1' },
      expectedOpportunityId: 'historical-or-stale-a',
      toStatus: 'Follow Up',
      reopenReason: surface === 'task completion' ? 'new_course_follow_up' : '',
      terminalReason: `Follow-up outcome from ${surface}`,
    };

    const operation = surface === 'task completion'
      ? completeFollowUpTaskWithActivity({
          db,
          organizationId: 'org-1',
          actorUserId: 'actor-1',
          existingTask: followUpTask({ leadId: 'historical-or-stale-a' }),
          taskPatch: { status: 'completed' },
          followUpActivity: { eventType: 'follow_up.reached_interested', message: 'Interested.' },
          leadPatch: { status: 'Follow Up', currentStage: 'Follow Up' },
          leadStatusChange: { changed: true, fromStatus: 'Not Interested', toStatus: 'Follow Up' },
          followUpOutcome: 'reached_interested',
          followUpChannel: 'phone',
          aitUsaOpportunityMutation,
        })
      : recordFollowUpActivity({
          db,
          organizationId: 'org-1',
          actorUserId: 'actor-1',
          context: { businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'historical-or-stale-a' },
          followUpActivity: { eventType: 'follow_up.reached_interested', message: 'Interested.' },
          leadPatch: { status: 'Follow Up', currentStage: 'Follow Up' },
          leadStatusChange: { changed: false, fromStatus: 'Follow Up', toStatus: 'Follow Up' },
          followUpOutcome: 'reached_interested',
          followUpChannel: 'phone',
          aitUsaOpportunityMutation,
        });

    await assert.rejects(operation, (error) => error.status === 409);
    assert.equal(calls.transactions, 1, surface);
    assert.ok(calls.queries >= 2, surface);
    assert.equal(calls.updates, 0, surface);
    assert.equal(calls.inserts, 0, surface);
  }
});

test('locked AIT USA follow-up uses the committed transition reason and cancellation policy in one transaction', async () => {
  const inserts = [];
  const patches = [];
  let transactionCount = 0;
  let reconciliationReads = 0;
  const lockedLead = {
    id: 'active-a',
    organization_id: 'org-1',
    business_unit_id: 'bu-1',
    contact_id: 'contact-1',
    status: 'New Lead',
    current_stage: 'New Lead',
  };
  const tx = {
    async query(text) {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      if (normalized.includes('order by created_at')) return { rows: [lockedLead] };
      if (normalized.includes('where id = $1 and organization_id = $2')) return { rows: [lockedLead] };
      return { rows: [] };
    },
    insert() {
      return {
        values(value) {
          inserts.push(value);
          return Promise.resolve();
        },
      };
    },
    update() {
      return {
        set(patch) {
          patches.push(patch);
          return this;
        },
        where() { return this; },
        returning() {
          return Promise.resolve([{
            id: 'active-a',
            organizationId: 'org-1',
            businessUnitId: 'bu-1',
            contactId: 'contact-1',
            status: patches.at(-1).status,
            currentStage: patches.at(-1).currentStage,
          }]);
        },
      };
    },
    select() {
      reconciliationReads += 1;
      return {
        from() { return this; },
        innerJoin() { return this; },
        where() { return Promise.resolve([]); },
      };
    },
  };

  await recordFollowUpActivity({
    db: {
      transaction(callback) {
        transactionCount += 1;
        return callback(tx);
      },
    },
    organizationId: 'org-1',
    actorUserId: 'actor-1',
    context: { businessUnitId: 'bu-1', contactId: 'contact-1', leadId: 'active-a' },
    followUpActivity: {
      eventType: 'follow_up.enrolled_or_won',
      message: 'Enrolled.',
      metadataJson: { statusTransition: { fromStatus: 'stale', toStatus: 'stale' } },
    },
    leadPatch: { status: 'Enrolled', currentStage: 'Enrolled' },
    leadStatusChange: {
      changed: true,
      fromStatus: 'New Lead',
      toStatus: 'Enrolled',
      reason: 'Follow-up outcome: enrolled_or_won',
    },
    cancelOpenFollowUps: false,
    followUpOutcome: 'enrolled_or_won',
    followUpChannel: 'phone',
    aitUsaOpportunityMutation: {
      organizationId: 'org-1',
      businessUnit: { id: 'bu-1', name: 'AIT USA Institute' },
      contact: { id: 'contact-1' },
      expectedOpportunityId: 'active-a',
      toStatus: 'Enrolled',
      terminalReason: 'Follow-up outcome: enrolled_or_won',
    },
  });

  assert.equal(transactionCount, 1);
  assert.equal(patches[0].status, 'Enrolled');
  assert.equal(reconciliationReads, 1, 'committed Enrolled transition must drive cancellation reconciliation');
  const history = inserts.find((value) => value.leadId === 'active-a' && value.fromStatus === 'New Lead');
  assert.equal(history.reason, 'Follow-up outcome: enrolled_or_won');
  const activity = inserts.find((value) => value.eventType === 'follow_up.enrolled_or_won');
  assert.equal(activity.metadataJson.statusTransition.fromStatus, 'New Lead');
  assert.equal(activity.metadataJson.statusTransition.toStatus, 'Enrolled');
  assert.equal(activity.metadataJson.statusTransition.reason, 'Follow-up outcome: enrolled_or_won');
});
