import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTeamMonitorBootstrapPayload } from './team-monitor-bootstrap.js';
import { requiresTeamMonitorBootstrapReload } from './bootstrap-routing.js';

test('restricted team monitor bootstrap projects only scoped monitor data', () => {
  const payload = buildTeamMonitorBootstrapPayload({
    currentUser: { id: 'senior', businessUnitIds: ['bu-allowed'], canAccessAllBusinessUnits: false },
    access: { canReadCrm: true, canReadFinancials: false },
    businessUnits: [{ id: 'bu-allowed', name: 'Allowed' }],
    employees: [
      { id: 'senior', name: 'Senior', roleKeys: ['senior_coordinator'], businessUnitIds: ['bu-allowed'] },
      { id: 'mixed', name: 'Mixed', roleKeys: ['account_coordinator'], businessUnitIds: ['bu-allowed', 'bu-other'] },
      { id: 'other', name: 'Other', roleKeys: ['account_coordinator'], businessUnitIds: ['bu-other'] },
    ],
    contacts: [
      { id: 'allowed-contact', primaryBusinessUnitId: 'bu-allowed' },
      { id: 'other-contact', primaryBusinessUnitId: 'bu-other' },
      { id: 'null-contact', primaryBusinessUnitId: null },
    ],
    leads: [{ id: 'allowed-lead', contactId: 'allowed-contact', businessUnitId: 'bu-allowed', status: 'Follow Up', assignedUserId: 'outside-owner' }],
    tasks: [
      { id: 'roster-task', businessUnitId: 'bu-allowed', ownerUserId: 'mixed', status: 'open', taskType: 'follow_up' },
      { id: 'unattributed-task', businessUnitId: 'bu-allowed', ownerUserId: 'outside-owner', status: 'open', taskType: 'follow_up' },
    ],
    activityEvents: [{ contactId: 'allowed-contact', eventType: 'follow_up.no_answer', occurredAt: '2026-07-08T10:00:00Z' }],
  });

  assert.deepEqual(payload.businessUnits.map((unit) => unit.id), ['bu-allowed']);
  assert.deepEqual(payload.employees.map((employee) => employee.id), ['senior', 'mixed']);
  assert.deepEqual(payload.employees.find((employee) => employee.id === 'mixed').businessUnitIds, ['bu-allowed']);
  assert.equal(Object.hasOwn(payload.employees[0], 'email'), false);
  assert.deepEqual(payload.contacts.map((contact) => contact.id), ['allowed-contact']);
  assert.equal(Object.hasOwn(payload.contacts[0], 'name'), false);
  assert.equal(payload.contacts[0].assignedTo, '');
  assert.equal(payload.contacts[0].unattributedOwner, true);
  assert.equal(payload.tasks.find((task) => task.id === 'unattributed-task').ownerUserId, '');
  assert.equal(payload.tasks.find((task) => task.id === 'unattributed-task').unattributedOwner, true);
  assert.equal(Object.hasOwn(payload.tasks[0], 'updatedAt'), false);
  assert.deepEqual(payload.workOrders, []);
  assert.deepEqual(payload.financials, []);
  assert.equal(Object.hasOwn(payload, 'users'), false);
});

test('admin team monitor bootstrap retains organization-wide monitor scope', () => {
  const payload = buildTeamMonitorBootstrapPayload({
    currentUser: { id: 'admin', canAccessAllBusinessUnits: true },
    businessUnits: [{ id: 'bu-one', name: 'One' }, { id: 'bu-two', name: 'Two' }],
    employees: [
      { id: 'one', name: 'One', businessUnitIds: ['bu-one'] },
      { id: 'two', name: 'Two', businessUnitIds: ['bu-two'] },
    ],
    contacts: [
      { id: 'one-contact', primaryBusinessUnitId: 'bu-one' },
      { id: 'two-contact', primaryBusinessUnitId: 'bu-two' },
      { id: 'null-contact', primaryBusinessUnitId: null },
    ],
  });

  assert.deepEqual(payload.businessUnits.map((unit) => unit.id), ['bu-one', 'bu-two']);
  assert.deepEqual(payload.employees.map((employee) => employee.id), ['one', 'two']);
  assert.deepEqual(payload.contacts.map((contact) => contact.id), ['one-contact', 'two-contact', 'null-contact']);
});

test('client transition into and out of team monitor cannot consume a stale full bootstrap', () => {
  const staleFullBootstrap = {
    bootstrapMode: 'full',
    businessUnits: [{ id: 'bu-allowed' }, { id: 'bu-other' }],
    employees: [{ id: 'allowed' }, { id: 'other' }],
    contacts: [{ id: 'allowed-contact' }, { id: 'other-contact' }, { id: 'null-contact', primaryBusinessUnitId: null }],
    workOrders: [{ id: 'work-order' }],
    financials: [{ id: 'financial' }],
    tasks: [{ id: 'generic-task' }],
    users: [{ id: 'generic-user' }],
  };
  assert.equal(requiresTeamMonitorBootstrapReload({ pathname: '/team-monitor', bootstrapMode: staleFullBootstrap.bootstrapMode }), true);

  const freshMonitorBootstrap = buildTeamMonitorBootstrapPayload({
    currentUser: { id: 'senior', businessUnitIds: ['bu-allowed'], canAccessAllBusinessUnits: false },
    businessUnits: [{ id: 'bu-allowed', name: 'Allowed' }],
    employees: [{ id: 'allowed', name: 'Allowed', businessUnitIds: ['bu-allowed'] }],
    contacts: [{ id: 'allowed-contact', primaryBusinessUnitId: 'bu-allowed' }],
    tasks: [{ id: 'scoped-task', businessUnitId: 'bu-allowed', status: 'open', taskType: 'follow_up' }],
  });
  const freshKeys = JSON.stringify(freshMonitorBootstrap);

  assert.equal(freshKeys.includes('other-contact'), false);
  assert.equal(freshKeys.includes('null-contact'), false);
  assert.equal(freshKeys.includes('work-order'), false);
  assert.equal(freshKeys.includes('"id":"financial"'), false);
  assert.equal(freshKeys.includes('generic-user'), false);
  assert.equal(freshKeys.includes('generic-task'), false);
  assert.equal(Object.hasOwn(freshMonitorBootstrap, 'deferredLoaders'), false);
  assert.equal(requiresTeamMonitorBootstrapReload({ pathname: '/team-monitor', bootstrapMode: 'team-monitor' }), false);
  assert.equal(requiresTeamMonitorBootstrapReload({ pathname: '/', bootstrapMode: 'team-monitor' }), true);
});
