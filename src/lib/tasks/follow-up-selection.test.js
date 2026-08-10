import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExactFollowUpTaskSelection,
  buildContactFollowUpLookup,
  clearedFollowUpTaskEntryHref,
  FOLLOW_UP_SELECTION_ERROR_CODES,
  followUpSubmissionTaskId,
  followUpTaskEntryHref,
  resolveExactFollowUpTaskRequest,
  selectUnambiguousOpenFollowUpTask,
} from './follow-up-selection.js';

function task(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    contactId: '22222222-2222-4222-8222-222222222222',
    leadId: '33333333-3333-4333-8333-333333333333',
    taskType: 'follow_up',
    status: 'open',
    ...overrides,
  };
}

test('two open follow-ups require explicit task selection instead of choosing the oldest', () => {
  assert.throws(
    () => selectUnambiguousOpenFollowUpTask([
      task(),
      task({ id: '44444444-4444-4444-8444-444444444444' }),
    ]),
    (error) => error.status === 409 && error.code === FOLLOW_UP_SELECTION_ERROR_CODES.AMBIGUOUS,
  );
});

test('exact selection rejects missing, mismatched, and stale task context', () => {
  const selected = task();
  assert.throws(
    () => assertExactFollowUpTaskSelection({
      task: selected,
      requestedTaskId: selected.id,
      requestedContactId: selected.contactId,
      requestedLeadId: selected.leadId,
      hasLeadId: false,
    }),
    (error) => error.code === FOLLOW_UP_SELECTION_ERROR_CODES.MISSING_IDENTIFIERS,
  );
  assert.throws(
    () => assertExactFollowUpTaskSelection({
      task: selected,
      requestedTaskId: selected.id,
      requestedContactId: '55555555-5555-4555-8555-555555555555',
      requestedLeadId: selected.leadId,
    }),
    (error) => error.code === FOLLOW_UP_SELECTION_ERROR_CODES.MISMATCH,
  );
  assert.throws(
    () => assertExactFollowUpTaskSelection({
      task: { ...selected, status: 'completed' },
      requestedTaskId: selected.id,
      requestedContactId: selected.contactId,
      requestedLeadId: selected.leadId,
    }),
    (error) => error.code === FOLLOW_UP_SELECTION_ERROR_CODES.STALE,
  );
});

test('dashboard follow-up entry carries exact task, contact, and lead identifiers', () => {
  const selected = task();
  const href = followUpTaskEntryHref(selected);
  const url = new URL(href, 'https://crm.test');

  assert.equal(url.pathname, '/tasks');
  assert.equal(url.searchParams.get('action'), 'log-follow-up');
  assert.equal(url.searchParams.get('taskId'), selected.id);
  assert.equal(url.searchParams.get('contactId'), selected.contactId);
  assert.equal(url.searchParams.get('leadId'), selected.leadId);
  assert.equal(url.searchParams.has('taskType'), false);
});

test('task-specific Contact lookup preserves an omitted lead identifier', () => {
  const selected = task();
  const lookup = buildContactFollowUpLookup({
    taskId: selected.id,
    hasLeadId: false,
  });

  assert.equal(lookup.params.get('taskId'), selected.id);
  assert.equal(lookup.params.has('leadId'), false);
  assert.equal(lookup.selectionKey, 'lead:missing');
  assert.throws(
    () => assertExactFollowUpTaskSelection({
      task: selected,
      requestedTaskId: lookup.params.get('taskId'),
      requestedContactId: selected.contactId,
      requestedLeadId: lookup.params.get('leadId'),
      hasLeadId: lookup.params.has('leadId'),
    }),
    (error) => error.code === FOLLOW_UP_SELECTION_ERROR_CODES.MISSING_IDENTIFIERS,
  );
});

test('generic Contact lookup leaves omitted Lead resolution to the server', () => {
  const lookup = buildContactFollowUpLookup({
    taskId: '',
    hasLeadId: false,
  });

  assert.equal(lookup.params.has('taskId'), false);
  assert.equal(lookup.params.has('leadId'), false);
  assert.equal(lookup.selectionKey, 'lead:missing');
});

test('consuming an exact follow-up entry removes its identity while preserving queue filters', () => {
  const href = clearedFollowUpTaskEntryHref(new URLSearchParams({
    action: 'log-follow-up',
    taskId: 'task-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    due: 'today',
    ownerUserId: '__me',
  }));
  const url = new URL(href, 'https://crm.test');

  assert.equal(url.pathname, '/tasks');
  for (const key of ['action', 'taskId', 'contactId', 'leadId']) {
    assert.equal(url.searchParams.has(key), false);
  }
  assert.equal(url.searchParams.get('due'), 'today');
  assert.equal(url.searchParams.get('ownerUserId'), '__me');
});

test('a supplied but missing Contact task stays exact and cannot enable the generic path', async () => {
  const requestedTaskId = task().id;
  let genericLeadResolutionCalls = 0;
  let genericWriteEnabled = false;

  await assert.rejects(
    (async () => {
      const selectedTask = await resolveExactFollowUpTaskRequest({
        requestedTaskId,
        requestedContactId: task().contactId,
        requestedLeadId: task().leadId,
        loadTaskById: async () => null,
        authorizeTask: async () => assert.fail('A missing task must fail before authorization.'),
      });
      if (!selectedTask) {
        genericLeadResolutionCalls += 1;
        genericWriteEnabled = true;
      }
    })(),
    (error) => error.status === 404 && error.code === FOLLOW_UP_SELECTION_ERROR_CODES.NOT_FOUND,
  );

  assert.equal(genericLeadResolutionCalls, 0);
  assert.equal(genericWriteEnabled, false);
  assert.equal(followUpSubmissionTaskId({ requestedTaskId, task: null }), requestedTaskId);
});
