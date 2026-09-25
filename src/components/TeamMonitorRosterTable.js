import { createElement } from 'react';

export function TeamMonitorRosterTable({
  roster = [],
  selectedEmployeeId = '',
  onSelectEmployee,
  renderAvatar,
  styles = {},
} = {}) {
  const avatar = (employee) => renderAvatar?.(employee) || null;

  return createElement('div', { className: styles.tableWrap },
    createElement('table', { className: styles.rosterTable },
      createElement('thead', null, createElement('tr', null,
        ['Team member', 'Active contacts', 'Tasks', 'Overdue', 'Follow-up gaps', 'Outcomes']
          .map((label) => createElement('th', { key: label }, label)),
      )),
      createElement('tbody', null,
        roster.map((employee) => createElement('tr', {
          key: employee.id,
          className: employee.id === selectedEmployeeId ? styles.selectedRow : '',
          onClick: () => onSelectEmployee?.(employee.id),
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onSelectEmployee?.(employee.id);
          },
          tabIndex: 0,
          'aria-label': `Review ${employee.name || employee.email || 'team member'}`,
          'aria-selected': employee.id === selectedEmployeeId,
        },
        createElement('td', { 'data-label': 'Team member' }, createElement('div', { className: styles.employeeCell },
          avatar(employee),
          createElement('span', null,
            createElement('strong', null, employee.name || employee.email || 'Unnamed user'),
            createElement('small', null, `${employee.roleLabel} · ${employee.signal}`),
          ),
        )),
        createElement('td', { 'data-label': 'Active contacts' }, Number(employee.activeAssignedContacts || 0) + Number(employee.unassignedActiveContacts || 0)),
        createElement('td', { 'data-label': 'Tasks' }, createElement('span', { className: styles.progressCell },
          createElement('strong', null, `${employee.openTasks} open`),
          createElement('small', null, `${employee.completedTasks} completed`),
        )),
        createElement('td', { 'data-label': 'Overdue' }, createElement('span', { className: employee.overdue ? styles.dangerCount : styles.zeroCount }, employee.overdue)),
        createElement('td', { 'data-label': 'Follow-up gaps' }, createElement('span', { className: employee.contactsWithoutNextFollowUp ? styles.softCount : styles.zeroCount }, employee.contactsWithoutNextFollowUp)),
        createElement('td', { 'data-label': 'Outcomes' }, createElement('span', { className: styles.progressCell },
          createElement('strong', null, `${employee.enrollments} enrolled`),
          createElement('small', null, `${employee.cancellations} cancelled`),
        )),
        )),
        !roster.length && createElement('tr', null,
          createElement('td', { colSpan: 6, className: styles.emptyCell }, 'No employees or unassigned work match this filter.'),
        ),
      ),
    ),
  );
}
