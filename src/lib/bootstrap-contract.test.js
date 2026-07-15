import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTACT_BOOTSTRAP_SUMMARY_FIELDS,
  DEFERRED_BOOTSTRAP_LOADERS,
  deferBootstrapContactDirectory,
  deferBootstrapContactDetails,
  deferBootstrapDashboardSummary,
  deferBootstrapLeanShell,
  deferBootstrapPipelineSummary,
  deferBootstrapTasks,
  hasDeferredBootstrapLoader,
  projectContactBootstrapSummaryRows,
} from './bootstrap-contract.js';
import { loadDeferredTasks, toBootstrapTasks } from './tasks/bootstrap.js';

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function deterministicFixture() {
  const contacts = Array.from({ length: 40 }, (_, index) => ({
    id: `contact-${index}`,
    name: `Fixture Contact ${index}`,
    businessUnitId: `bu-${index % 2}`,
    primaryBusinessUnitId: `bu-${index % 2}`,
    notes: [{ text: `Contact note ${index}`.repeat(8) }],
  }));
  const tasks = Array.from({ length: 240 }, (_, index) => ({
    id: `task-${index}`,
    title: `Follow up with fixture contact ${index % contacts.length}`,
    description: `Deterministic task detail ${index}. `.repeat(12),
    businessUnitId: `bu-${index % 2}`,
    contactId: contacts[index % contacts.length].id,
    ownerUserId: `user-${index % 6}`,
    taskType: index % 3 === 0 ? 'follow_up' : 'manual_reminder',
    status: index % 5 === 0 ? 'completed' : 'open',
    priority: index % 4 === 0 ? 'high' : 'medium',
    dueAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T14:00:00.000Z`,
    sourceType: 'fixture',
    sourceLabel: 'Regression measurement',
    metadataJson: { source: 'mis-312', sequence: index },
  }));
  return {
    core: {
      dataSource: 'postgres',
      currentUser: { id: 'user-0', businessUnitIds: ['bu-0', 'bu-1'], canAccessAllBusinessUnits: false },
      access: { canReadCrm: true },
      businessUnits: [{ id: 'bu-0' }, { id: 'bu-1' }],
      employees: Array.from({ length: 6 }, (_, index) => ({ id: `user-${index}`, name: `Employee ${index}` })),
      contacts,
      workOrders: Array.from({ length: 15 }, (_, index) => ({ id: `wo-${index}`, contactId: `contact-${index}` })),
      financials: Array.from({ length: 12 }, (_, index) => ({ id: `fin-${index}`, contactId: `contact-${index}` })),
      calendarEvents: [],
      salesLedger: [],
    },
    tasks,
  };
}

test('global bootstrap defers task rows while preserving the rest of the contract', () => {
  const { core, tasks } = deterministicFixture();
  const legacyBootstrap = { ...core, tasks };
  const projectedBootstrap = deferBootstrapTasks(legacyBootstrap);
  const legacyBytes = serializedBytes(legacyBootstrap);
  const projectedBytes = serializedBytes(projectedBootstrap);
  const reductionBytes = legacyBytes - projectedBytes;
  const reductionPercent = Number(((reductionBytes / legacyBytes) * 100).toFixed(1));

  console.info(JSON.stringify({
    measurement: 'MIS-312 deterministic bootstrap task projection',
    legacyBootstrap: { bytes: legacyBytes, taskRows: tasks.length, repeatedLoads3Bytes: legacyBytes * 3 },
    projectedBootstrap: { bytes: projectedBytes, taskRows: projectedBootstrap.tasks.length, repeatedLoads3Bytes: projectedBytes * 3 },
    reduction: { bytes: reductionBytes, percent: reductionPercent, repeatedLoads3Bytes: reductionBytes * 3 },
  }));

  assert.equal(projectedBootstrap.contacts, core.contacts);
  assert.equal(projectedBootstrap.workOrders, core.workOrders);
  assert.equal(projectedBootstrap.financials, core.financials);
  assert.deepEqual(projectedBootstrap.tasks, []);
  assert.equal(hasDeferredBootstrapLoader(projectedBootstrap, DEFERRED_BOOTSTRAP_LOADERS.TASKS), true);
  assert.ok(reductionPercent > 75, `expected task projection to reduce fixture bootstrap by >75%, got ${reductionPercent}%`);
});

test('contact directory shell excludes broad CRM collections before paged loading', () => {
  const { core, tasks } = deterministicFixture();
  const legacyBootstrap = { ...core, tasks };
  const directoryBootstrap = deferBootstrapContactDirectory(deferBootstrapTasks(legacyBootstrap));
  const legacyBytes = serializedBytes(legacyBootstrap);
  const directoryBytes = serializedBytes(directoryBootstrap);
  const reductionPercent = Number((((legacyBytes - directoryBytes) / legacyBytes) * 100).toFixed(1));

  assert.deepEqual(directoryBootstrap.contacts, []);
  assert.deepEqual(directoryBootstrap.workOrders, []);
  assert.deepEqual(directoryBootstrap.financials, []);
  assert.equal(hasDeferredBootstrapLoader(directoryBootstrap, DEFERRED_BOOTSTRAP_LOADERS.CONTACT_DIRECTORY), true);
  assert.ok(reductionPercent > 90, `expected lean directory shell to reduce fixture bootstrap by >90%, got ${reductionPercent}%`);
});

test('dashboard and pipeline shells defer their route-owned data', () => {
  const { core, tasks } = deterministicFixture();
  const legacyBootstrap = { ...core, tasks };
  const dashboardBootstrap = deferBootstrapDashboardSummary(deferBootstrapTasks(legacyBootstrap));
  const pipelineBootstrap = deferBootstrapPipelineSummary(deferBootstrapTasks(legacyBootstrap));

  for (const [payload, loader] of [
    [dashboardBootstrap, DEFERRED_BOOTSTRAP_LOADERS.DASHBOARD_SUMMARY],
    [pipelineBootstrap, DEFERRED_BOOTSTRAP_LOADERS.PIPELINE_SUMMARY],
  ]) {
    assert.deepEqual(payload.contacts, []);
    assert.deepEqual(payload.workOrders, []);
    assert.deepEqual(payload.financials, []);
    assert.equal(hasDeferredBootstrapLoader(payload, loader), true);
    assert.ok(serializedBytes(payload) < serializedBytes(legacyBootstrap) * 0.1);
  }
});

test('lean service shells exclude broad CRM collections', () => {
  const { core, tasks } = deterministicFixture();
  const payload = deferBootstrapLeanShell(deferBootstrapTasks({ ...core, tasks }));

  assert.deepEqual(payload.contacts, []);
  assert.deepEqual(payload.workOrders, []);
  assert.deepEqual(payload.financials, []);
  assert.ok(payload.deferredLoaders.includes(DEFERRED_BOOTSTRAP_LOADERS.LEAN_SHELL));
});

test('route task payload maps the existing scoped API contract without changing task semantics', () => {
  const { core, tasks } = deterministicFixture();
  const routePayload = { tasks, users: core.employees };
  const mapped = toBootstrapTasks(routePayload.tasks, core.contacts);

  assert.equal(mapped.length, tasks.length);
  assert.deepEqual(mapped[0], {
    id: 'task-0',
    title: 'Follow up with fixture contact 0',
    description: tasks[0].description,
    businessUnitId: 'bu-0',
    contactId: 'contact-0',
    client: 'Fixture Contact 0',
    leadId: '',
    workOrderId: '',
    ownerUserId: 'user-0',
    assignedTo: 'user-0',
    dueAt: '2026-07-01T14:00:00.000Z',
    dueDate: '2026-07-01',
    completed: true,
    completedAt: '',
    priority: 'High',
    taskType: 'follow_up',
    status: 'completed',
    taskStatus: 'completed',
    sourceType: 'fixture',
    sourceLabel: 'Regression measurement',
    createdAt: '',
    updatedAt: '',
  });
  assert.equal(Object.hasOwn(routePayload, 'contacts'), false);
  assert.equal(Object.hasOwn(routePayload, 'workOrders'), false);
  assert.equal(Object.hasOwn(routePayload, 'financials'), false);
});

test('deferred task loader uses the existing scoped route and surfaces access errors', async () => {
  const { core, tasks } = deterministicFixture();
  const requests = [];
  const mapped = await loadDeferredTasks({
    contacts: core.contacts,
    fetcher: async (...args) => {
      requests.push(args);
      return {
        ok: true,
        async json() {
          return { tasks };
        },
      };
    },
  });

  assert.deepEqual(requests, [['/api/tasks', { cache: 'no-store' }]]);
  assert.equal(mapped.length, tasks.length);
  assert.equal(mapped[0].businessUnitId, 'bu-0');
  assert.equal(mapped[1].businessUnitId, 'bu-1');

  await assert.rejects(
    loadDeferredTasks({
      fetcher: async () => ({
        ok: false,
        async json() {
          return { error: 'Insufficient CRM read access.' };
        },
      }),
    }),
    /Insufficient CRM read access/,
  );
});

function deterministicContactDetailFixture() {
  const contacts = Array.from({ length: 60 }, (_, contactIndex) => {
    const notes = Array.from({ length: 4 }, (_, noteIndex) => ({
      id: `note-${contactIndex}-${noteIndex}`,
      text: `Private note ${contactIndex}-${noteIndex}: ${'detail '.repeat(18)}`,
      createdAt: `2026-06-${String(noteIndex + 1).padStart(2, '0')}T12:00:00.000Z`,
    }));
    const timeline = Array.from({ length: 18 }, (_, timelineIndex) => ({
      id: `event-${contactIndex}-${timelineIndex}`,
      type: timelineIndex % 2 ? 'activity' : 'note',
      title: `Timeline entry ${timelineIndex}`,
      text: `Contact ${contactIndex} detail ${timelineIndex}: ${'timeline body '.repeat(22)}`,
      timestamp: `2026-06-${String((timelineIndex % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      presentation: { category: 'activity', provenance: { rawText: 'source detail '.repeat(12) } },
    }));
    const courseRecords = [{
      courseName: `Course ${contactIndex % 5}`,
      status: 'active',
      startDate: '2026-06-01',
      endDate: '',
      notes: `Instructor-only course note ${'detail '.repeat(20)}`,
    }];
    return {
      id: `contact-${contactIndex}`,
      name: `Fixture Contact ${contactIndex}`,
      businessUnitId: `bu-${contactIndex % 2}`,
      status: contactIndex % 2 ? 'Follow Up' : 'Enrolled',
      assignedTo: `user-${contactIndex % 6}`,
      lastTouch: '2026-06-20',
      linkedPeopleCount: 2,
      linkedPeoplePreview: 'Primary Person, Secondary Person',
      courseRecords,
      courseSummary: { records: courseRecords },
      notes,
      timeline,
    };
  });

  const rowsByCategory = {
    notes: Array.from({ length: 240 }, (_, index) => ({
      id: `note-${index}`,
      organizationId: 'org-1',
      businessUnitId: `bu-${index % 2}`,
      contactId: `contact-${index % contacts.length}`,
      leadId: `lead-${index % contacts.length}`,
      estimateId: null,
      workOrderId: null,
      body: `Note summary source ${index}: ${'body '.repeat(14)}`,
      authorUserId: `user-${index % 6}`,
      createdAt: '2026-06-20T12:00:00.000Z',
      updatedAt: '2026-06-20T12:00:00.000Z',
    })),
    activityEvents: Array.from({ length: 480 }, (_, index) => ({
      id: `activity-${index}`,
      organizationId: 'org-1',
      businessUnitId: `bu-${index % 2}`,
      contactId: `contact-${index % contacts.length}`,
      leadId: `lead-${index % contacts.length}`,
      estimateId: null,
      workOrderId: null,
      eventType: index % 2 ? 'ait_usa.follow_up' : 'website_lead_captured',
      message: `Activity ${index}: ${'summary text '.repeat(10)}`,
      metadataJson: { rawPayload: 'detail metadata '.repeat(24), sequence: index },
      actorUserId: `user-${index % 6}`,
      sourceSheet: 'Fixture',
      sourceRow: index + 1,
      occurredAt: '2026-06-20T12:00:00.000Z',
      createdAt: '2026-06-20T12:00:00.000Z',
    })),
    conversationMessages: Array.from({ length: 300 }, (_, index) => ({
      id: `message-${index}`,
      conversationId: `conversation-${index % 30}`,
      organizationId: 'org-1',
      businessUnitId: `bu-${index % 2}`,
      contactId: `contact-${index % contacts.length}`,
      leadId: `lead-${index % contacts.length}`,
      channel: 'sms',
      provider: 'fixture',
      direction: 'inbound',
      deliveryStatus: 'received',
      providerAccountId: 'provider-account',
      providerThreadId: `thread-${index}`,
      externalMessageId: `external-${index}`,
      idempotencyKey: `key-${index}`,
      senderIdentity: '+10000000000',
      recipientIdentity: '+19999999999',
      textBody: `Message ${index}: ${'conversation text '.repeat(12)}`,
      rawPayloadJson: { providerDetail: 'raw payload '.repeat(30) },
      occurredAt: '2026-06-20T12:00:00.000Z',
      createdAt: '2026-06-20T12:00:00.000Z',
      updatedAt: '2026-06-20T12:00:00.000Z',
    })),
    contactPeople: Array.from({ length: 180 }, (_, index) => ({
      id: `person-${index}`,
      organizationId: 'org-1',
      businessUnitId: `bu-${index % 2}`,
      contactId: `contact-${index % contacts.length}`,
      name: `Linked Person ${index}`,
      role: 'Stakeholder',
      phone: '+10000000000',
      email: `person-${index}@example.com`,
      notes: `Relationship detail ${'private '.repeat(16)}`,
      isPrimary: index % 3 === 0,
      metadataJson: { source: 'fixture' },
    })),
    courseRecords: Array.from({ length: 120 }, (_, index) => ({
      id: `course-${index}`,
      organizationId: 'org-1',
      businessUnitId: `bu-${index % 2}`,
      contactId: `contact-${index % contacts.length}`,
      leadId: `lead-${index % contacts.length}`,
      courseName: `Course ${index % 5}`,
      courseLocation: 'Main Campus',
      teacher: `Teacher ${index % 4}`,
      status: index % 3 ? 'active' : 'completed',
      startDate: '2026-06-01',
      endDate: index % 3 ? null : '2026-06-20',
      outcomeReason: index % 3 ? null : 'Completed',
      notes: `Course detail ${'private '.repeat(20)}`,
      metadataJson: { source: 'fixture', raw: 'course metadata '.repeat(18) },
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-20T12:00:00.000Z',
    })),
    leadStatusHistory: Array.from({ length: 180 }, (_, index) => ({
      id: `status-${index}`,
      organizationId: 'org-1',
      businessUnitId: `bu-${index % 2}`,
      contactId: `contact-${index % contacts.length}`,
      leadId: `lead-${index % contacts.length}`,
      fromStatus: 'Follow Up',
      toStatus: index % 2 ? 'Enrolled' : 'Dropped / Quit',
      actorUserId: `user-${index % 6}`,
      reason: `Status detail ${'reason '.repeat(15)}`,
      metadataJson: { source: 'fixture', audit: 'status metadata '.repeat(18) },
      occurredAt: '2026-06-20T12:00:00.000Z',
      createdAt: '2026-06-20T12:00:00.000Z',
    })),
  };

  return { contacts, rowsByCategory };
}

test('contact bootstrap keeps list summaries but defers detail collections to scoped loaders', () => {
  const { contacts, rowsByCategory } = deterministicContactDetailFixture();
  const legacyBootstrap = { dataSource: 'postgres', contacts, deferredLoaders: [] };
  const projectedBootstrap = deferBootstrapContactDetails(legacyBootstrap);
  const projectedRows = projectContactBootstrapSummaryRows(rowsByCategory);

  const queryCategories = Object.fromEntries(Object.keys(CONTACT_BOOTSTRAP_SUMMARY_FIELDS).map((category) => {
    const legacyRows = rowsByCategory[category];
    const summaryRows = projectedRows[category];
    return [category, {
      legacy: { bytes: serializedBytes(legacyRows), rows: legacyRows.length },
      projected: { bytes: serializedBytes(summaryRows), rows: summaryRows.length },
    }];
  }));
  const legacyBytes = serializedBytes(legacyBootstrap);
  const projectedBytes = serializedBytes(projectedBootstrap);
  const reductionBytes = legacyBytes - projectedBytes;
  const reductionPercent = Number(((reductionBytes / legacyBytes) * 100).toFixed(1));

  console.info(JSON.stringify({
    measurement: 'MIS-312 deterministic contact list/detail boundary',
    contactPayload: {
      legacy: {
        bytes: legacyBytes,
        contactRows: contacts.length,
        noteRows: contacts.reduce((sum, contact) => sum + contact.notes.length, 0),
        timelineRows: contacts.reduce((sum, contact) => sum + contact.timeline.length, 0),
      },
      projected: {
        bytes: projectedBytes,
        contactRows: projectedBootstrap.contacts.length,
        noteRows: projectedBootstrap.contacts.reduce((sum, contact) => sum + (contact.notes?.length || 0), 0),
        timelineRows: projectedBootstrap.contacts.reduce((sum, contact) => sum + (contact.timeline?.length || 0), 0),
      },
      reduction: { bytes: reductionBytes, percent: reductionPercent },
    },
    queryCategories,
  }));

  assert.equal(projectedBootstrap.contacts.length, contacts.length);
  assert.equal(projectedBootstrap.contacts[0].name, contacts[0].name);
  assert.equal(projectedBootstrap.contacts[0].status, contacts[0].status);
  assert.equal(projectedBootstrap.contacts[0].linkedPeopleCount, contacts[0].linkedPeopleCount);
  assert.equal(projectedBootstrap.contacts[0].courseRecords.length, contacts[0].courseRecords.length);
  assert.equal(Object.hasOwn(projectedBootstrap.contacts[0].courseRecords[0], 'notes'), false);
  assert.equal(Object.hasOwn(projectedBootstrap.contacts[0], 'notes'), false);
  assert.equal(Object.hasOwn(projectedBootstrap.contacts[0], 'timeline'), false);
  assert.equal(Object.hasOwn(projectedBootstrap.contacts[0], 'courseSummary'), false);
  assert.equal(hasDeferredBootstrapLoader(projectedBootstrap, DEFERRED_BOOTSTRAP_LOADERS.CONTACT_DETAILS), true);
  assert.ok(reductionPercent > 80, `expected contact detail deferral to reduce fixture contact payload by >80%, got ${reductionPercent}%`);
  for (const category of Object.keys(queryCategories)) {
    assert.equal(queryCategories[category].legacy.rows, queryCategories[category].projected.rows);
    assert.ok(
      queryCategories[category].projected.bytes < queryCategories[category].legacy.bytes,
      `expected ${category} summary projection to reduce serialized query bytes`,
    );
  }
});
