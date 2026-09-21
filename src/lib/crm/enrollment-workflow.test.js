import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCourseRecordWithEnrollmentLifecycle,
  ENROLLMENT_WRITE_INTENTS,
  normalizeEnrollmentWriteIntent,
} from './enrollment-workflow.js';

const businessUnit = { id: 'bu-1', name: 'AIT USA Institute' };
const contact = { id: 'contact-1' };

test('enrollment write intent defaults to starting a current enrollment', () => {
  assert.equal(normalizeEnrollmentWriteIntent(''), ENROLLMENT_WRITE_INTENTS.START);
  assert.equal(normalizeEnrollmentWriteIntent('unknown'), ENROLLMENT_WRITE_INTENTS.START);
  assert.equal(normalizeEnrollmentWriteIntent('past_enrollment'), ENROLLMENT_WRITE_INTENTS.PAST);
});

test('past enrollment stays history-only inside one transaction', async () => {
  const tx = { id: 'history-tx' };
  let locked = false;
  let inserted = null;
  const result = await createCourseRecordWithEnrollmentLifecycle({
    db: { transaction: (write) => write(tx) },
    organizationId: 'org-1',
    actorUserId: 'user-1',
    businessUnit,
    contact,
    expectedOpportunityId: 'lead-1',
    courseValues: { courseName: 'English 1', status: 'completed', leadId: 'lead-1' },
    intent: ENROLLMENT_WRITE_INTENTS.PAST,
    dependencies: {
      withLockedMutation: async () => { locked = true; },
      insertCourseRecord: async (receivedTx, values) => {
        inserted = { receivedTx, values };
        return { id: 'course-1', ...values };
      },
    },
  });

  assert.equal(locked, false);
  assert.equal(inserted.receivedTx, tx);
  assert.equal(inserted.values.status, 'completed');
  assert.equal(result.opportunity, null);
  assert.equal(result.transition, null);
});

test('starting enrollment writes course, lifecycle, history, and task reconciliation in the same locked transaction', async () => {
  const tx = { id: 'locked-tx' };
  const calls = [];
  let lockedOptions = null;
  const now = new Date('2026-09-20T22:00:00.000Z');
  const opportunity = {
    id: 'lead-1',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    status: 'Follow Up',
  };
  const transition = {
    allowed: true,
    changed: true,
    fromStatus: 'Follow Up',
    toStatus: 'Enrolled',
  };

  const result = await createCourseRecordWithEnrollmentLifecycle({
    db: {},
    organizationId: 'org-1',
    actorUserId: 'user-1',
    businessUnit,
    contact,
    expectedOpportunityId: 'lead-1',
    courseValues: { courseName: 'English 1', status: 'active', leadId: 'stale-lead' },
    intent: ENROLLMENT_WRITE_INTENTS.START,
    dependencies: {
      now: () => now,
      withLockedMutation: async (options) => {
        lockedOptions = options;
        return options.write({ tx, opportunity, transition });
      },
      insertCourseRecord: async (receivedTx, values) => {
        calls.push(['course', receivedTx, values]);
        return { id: 'course-1', ...values };
      },
      updateOpportunityStatus: async (receivedTx, values) => {
        calls.push(['status', receivedTx, values]);
        return { ...opportunity, status: 'Enrolled', currentStage: 'Enrolled' };
      },
      insertStatusHistory: async (receivedTx, values) => {
        calls.push(['history', receivedTx, values]);
      },
      reconcileFollowUps: async (receivedTx, values) => {
        calls.push(['tasks', receivedTx, values]);
      },
    },
  });

  assert.equal(lockedOptions.expectedOpportunityId, 'lead-1');
  assert.equal(lockedOptions.toStatus, 'Enrolled');
  assert.deepEqual(calls.map(([name]) => name), ['course', 'status', 'history', 'tasks']);
  for (const [, receivedTx] of calls) assert.equal(receivedTx, tx);
  assert.equal(calls[0][2].leadId, 'lead-1');
  assert.equal(calls[2][2].reason, 'Enrollment started.');
  assert.equal(calls[3][2].source, 'enrollment_started');
  assert.equal(result.opportunity.status, 'Enrolled');
});

test('starting enrollment fails closed without a selected active inquiry', async () => {
  await assert.rejects(
    createCourseRecordWithEnrollmentLifecycle({
      db: {},
      organizationId: 'org-1',
      actorUserId: 'user-1',
      businessUnit,
      contact,
      courseValues: { courseName: 'English 1', status: 'active' },
      intent: ENROLLMENT_WRITE_INTENTS.START,
    }),
    (error) => error.status === 409 && /active inquiry is required/i.test(error.message),
  );
});
