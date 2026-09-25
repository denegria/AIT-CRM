import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamMonitorRosterTable } from './TeamMonitorRosterTable.js';

test('team monitor roster table renders provided roster rows without an undeclared view variable', () => {
  const html = renderToStaticMarkup(createElement(TeamMonitorRosterTable, {
    roster: [{
      id: 'u-one', name: 'Sofia', roleLabel: 'Coordinator', completedTasks: 1, dueToday: 2,
      openTasks: 3, taskProgressTotal: 4, overdue: 0, assignedContacts: 4,
      activeAssignedContacts: 2,
      contactsWithoutNextFollowUp: 1, enrollments: 1, cancellations: 1,
      signal: 'Needs attention', signalTone: 'danger',
    }],
    renderAvatar: () => createElement('span', null, 'Avatar'),
  }));

  assert.match(html, /Sofia/);
  assert.match(html, /Needs attention/);
  assert.match(html, /Active contacts<\/th>/);
  assert.match(html, /data-label="Active contacts">2/);
  assert.match(html, /3 open/);
  assert.match(html, /1 completed/);
  assert.match(html, /1 cancelled/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Review Sofia"/);
});

test('unassigned row shows active contacts in its reconciliation bucket', () => {
  const html = renderToStaticMarkup(createElement(TeamMonitorRosterTable, {
    roster: [{
      id: 'unassigned', name: 'Unassigned work', isUnassignedBucket: true,
      activeAssignedContacts: 2, unassignedActiveContacts: 5, openTasks: 3,
      completedTasks: 0, overdue: 1, contactsWithoutNextFollowUp: 4,
      enrollments: 0, cancellations: 0, roleLabel: 'Reconciliation', signal: 'Needs attention',
    }],
  }));
  assert.match(html, /data-label="Active contacts">7/);
  assert.match(html, /data-label="Follow-up gaps"><span>4/);
});
