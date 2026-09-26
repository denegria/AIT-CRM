import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardContactsForSession, summarizeAitUsaDashboardContacts } from './summary.js';

const currentYear = new Date().getUTCFullYear();

function contact(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    workflowKey: 'ait_usa',
    status: 'New Lead',
    currentStage: 'New Lead',
    isPipelineEligible: true,
    submittedAt: `${currentYear}-02-01T12:00:00.000Z`,
    source: 'Website Form',
    sourceLabel: '',
    phone: '12345',
    email: 'lead@example.com',
    assignedTo: '',
    needsFirstOutreach: false,
    processPills: [],
    ...overrides,
  };
}

test('AIT USA dashboard summary uses the same current-scope and workflow facet semantics as the CRM', () => {
  const mappedContacts = [
    contact({ id: 'new', assignedTo: 'user-1', needsFirstOutreach: true }),
    contact({ id: 'follow-up', status: 'Follow Up', currentStage: 'Follow Up', source: 'Referral' }),
    contact({
      id: 'suppressed',
      status: 'Follow Up',
      currentStage: 'Follow Up',
      isDoNotCall: true,
      processPills: ['suppress_from_follow_up'],
    }),
    contact({
      id: 'prior-year',
      submittedAt: `${currentYear - 1}-02-01T12:00:00.000Z`,
    }),
  ];

  const summary = summarizeAitUsaDashboardContacts({
    mappedContacts,
    currentUserId: 'user-1',
  });

  assert.deepEqual(summary.kpis, {
    activeContacts: 3,
    newLeads: 2,
    myPipeline: 1,
    needsFirstOutreach: 1,
    usaNewLeads: 1,
    usaFollowUp: 1,
    usaBadContactChannel: 1,
  });
  assert.equal(summary.websiteLeads, 3);
  assert.equal(summary.businessMovement, null);
});

test('an invalid phone alone is not the legacy bad-contact-channel bucket', () => {
  const summary = summarizeAitUsaDashboardContacts({
    mappedContacts: [contact({ phone: '12345', email: 'lead@example.com' })],
  });

  assert.equal(summary.kpis.usaBadContactChannel, 0);
});

test('regular Dashboard contact summaries exclude work owned by other coordinators', () => {
  const mappedContacts = [
    contact({ id: 'mine', assignedTo: 'user-1' }),
    contact({ id: 'another', assignedTo: 'user-2' }),
    contact({ id: 'unassigned', assignedTo: '' }),
  ];
  const regular = dashboardContactsForSession(mappedContacts, {
    user: { id: 'user-1', primaryRoleKey: 'account_coordinator' },
  });
  assert.deepEqual(regular.map((row) => row.id), ['mine']);
  assert.equal(summarizeAitUsaDashboardContacts({ mappedContacts: regular, currentUserId: 'user-1' }).kpis.usaNewLeads, 1);
  assert.equal(dashboardContactsForSession(mappedContacts, {
    user: { id: 'user-1', primaryRoleKey: 'senior_coordinator' },
  }).length, 3);
});
