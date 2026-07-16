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
      contactsWithoutNextFollowUp: 1, enrollments: 1, cancellations: 1,
      signal: 'Needs attention', signalTone: 'danger',
    }],
    renderAvatar: () => createElement('span', null, 'Avatar'),
  }));

  assert.match(html, /Sofia/);
  assert.match(html, /Needs attention/);
  assert.match(html, /1 \/ 4/);
  assert.match(html, /3 open/);
  assert.match(html, /Cancellations/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Review Sofia"/);
});
