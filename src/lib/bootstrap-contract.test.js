import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFERRED_BOOTSTRAP_LOADERS,
  deferBootstrapTasks,
  hasDeferredBootstrapLoader,
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
