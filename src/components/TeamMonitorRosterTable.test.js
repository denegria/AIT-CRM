import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamMonitorRosterTable } from './TeamMonitorRosterTable.js';

test('team monitor roster table renders provided roster rows without an undeclared view variable', () => {
  const html = renderToStaticMarkup(createElement(TeamMonitorRosterTable, {
    roster: [{
      id: 'u-one', name: 'Sofia', roleLabel: 'Coordinator', completedTasks: 1, dueToday: 2,
      overdue: 0, activeAssignedContacts: 4, contactsWithoutNextFollowUp: 1, enrollments: 1,
      signal: 'Needs attention', signalTone: 'danger',
    }],
    renderAvatar: () => createElement('span', null, 'Avatar'),
  }));

  assert.match(html, /Sofia/);
  assert.match(html, /Needs attention/);
});
