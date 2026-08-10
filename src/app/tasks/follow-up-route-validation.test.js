import assert from 'node:assert/strict';
import test from 'node:test';
import { PATCH as patchTask } from '../api/tasks/route.js';
import { POST as postContactFollowUp } from '../api/contacts/[id]/follow-up/route.js';

const ids = Object.freeze({
  task: '10000000-0000-4000-8000-000000000001',
  contact: '10000000-0000-4000-8000-000000000002',
  lead: '10000000-0000-4000-8000-000000000003',
  businessUnit: '10000000-0000-4000-8000-000000000004',
  user: '10000000-0000-4000-8000-000000000005',
  organization: '10000000-0000-4000-8000-000000000006',
});

const session = Object.freeze({
  user: Object.freeze({
    id: ids.user,
    organizationId: ids.organization,
    canAccessAllBusinessUnits: true,
    businessUnitIds: [],
  }),
});

const selectedTask = Object.freeze({
  id: ids.task,
  organizationId: ids.organization,
  businessUnitId: ids.businessUnit,
  contactId: ids.contact,
  leadId: ids.lead,
  ownerUserId: ids.user,
  taskType: 'follow_up',
  status: 'open',
  title: 'Selected follow-up',
});

function permission() {
  return Promise.resolve({ error: null, session });
}

function jsonRequest(url, body, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function taskReadDb(calls, { throwAfterTaskRead = null } = {}) {
  return {
    transaction() {
      calls.transactions += 1;
      throw new Error('Validation failures must not start a transaction.');
    },
    insert() {
      calls.inserts += 1;
      throw new Error('Validation failures must not insert.');
    },
    update() {
      calls.updates += 1;
      throw new Error('Validation failures must not update.');
    },
    select() {
      calls.reads += 1;
      if (calls.reads > 1 && throwAfterTaskRead) throw throwAfterTaskRead;
      return {
        from() { return this; },
        where() { return this; },
        limit() { return Promise.resolve([selectedTask]); },
      };
    },
  };
}

const invalidPayloads = Object.freeze([
  { channel: 'phone', note: 'Typed note survives.' },
  { outcome: 'invented_positive', channel: 'phone', note: 'Typed note survives.' },
  { outcome: 'no_answer', note: 'Typed note survives.' },
  { outcome: 'no_answer', channel: 'manual', note: 'Typed note survives.' },
]);

test('POST /api/contacts/[id]/follow-up rejects omitted or invalid outcome/channel before DB access or writes', async () => {
  for (const payload of invalidPayloads) {
    const calls = { getDb: 0, transactions: 0, inserts: 0, updates: 0 };
    const response = await postContactFollowUp(
      jsonRequest(`http://localhost/api/contacts/${ids.contact}/follow-up`, payload),
      { params: Promise.resolve({ id: ids.contact }) },
      {
        requirePermissionForRequest: permission,
        getDbForRequest() {
          calls.getDb += 1;
          throw new Error('Invalid payload must not resolve the database.');
        },
      },
    );

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /required|valid/);
    assert.deepEqual(calls, { getDb: 0, transactions: 0, inserts: 0, updates: 0 });
  }
});

test('PATCH /api/tasks rejects omitted or invalid outcome/channel before transaction or write', async () => {
  for (const payload of invalidPayloads) {
    const calls = { reads: 0, transactions: 0, inserts: 0, updates: 0 };
    const response = await patchTask(
      jsonRequest('http://localhost/api/tasks', {
        id: ids.task,
        action: 'complete',
        ...payload,
      }, 'PATCH'),
      {
        requirePermissionForRequest: permission,
        getDbForRequest: () => taskReadDb(calls),
      },
    );

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /required|valid/);
    assert.deepEqual(calls, { reads: 1, transactions: 0, inserts: 0, updates: 0 });
  }
});

test('both routes accept explicit valid outcome/channel and continue into their unchanged resolution paths', async () => {
  const validPayload = {
    outcome: 'reached_interested',
    channel: 'phone',
    note: 'Asked for a call tomorrow.',
  };
  const contactSentinel = new Error('contact-valid-payload-passed-validation');
  await assert.rejects(
    postContactFollowUp(
      jsonRequest(`http://localhost/api/contacts/${ids.contact}/follow-up`, validPayload),
      { params: Promise.resolve({ id: ids.contact }) },
      {
        requirePermissionForRequest: permission,
        getDbForRequest() { throw contactSentinel; },
      },
    ),
    contactSentinel,
  );

  const taskSentinel = new Error('task-valid-payload-passed-validation');
  const taskCalls = { reads: 0, transactions: 0, inserts: 0, updates: 0 };
  await assert.rejects(
    patchTask(
      jsonRequest('http://localhost/api/tasks', {
        id: ids.task,
        action: 'complete',
        contactId: ids.contact,
        leadId: ids.lead,
        ...validPayload,
      }, 'PATCH'),
      {
        requirePermissionForRequest: permission,
        getDbForRequest: () => taskReadDb(taskCalls, { throwAfterTaskRead: taskSentinel }),
      },
    ),
    taskSentinel,
  );
  assert.deepEqual(taskCalls, { reads: 2, transactions: 0, inserts: 0, updates: 0 });
});
