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
        ['Employee', 'Completed', 'Due today', 'Overdue', 'Active contacts', 'Missing next follow-up', 'Enrollments', 'Signal']
          .map((label) => createElement('th', { key: label }, label)),
      )),
      createElement('tbody', null,
        roster.map((employee) => createElement('tr', {
          key: employee.id,
          className: employee.id === selectedEmployeeId ? styles.selectedRow : '',
          onClick: () => onSelectEmployee?.(employee.id),
        },
        createElement('td', { 'data-label': 'Employee' }, createElement('div', { className: styles.employeeCell },
          avatar(employee),
          createElement('span', null, createElement('strong', null, employee.name || employee.email || 'Unnamed user'), createElement('small', null, employee.roleLabel)),
        )),
        createElement('td', { 'data-label': 'Completed' }, createElement('span', { className: employee.completedTasks ? styles.successCount : styles.zeroCount }, employee.completedTasks)),
        createElement('td', { 'data-label': 'Due today' }, createElement('span', { className: employee.dueToday ? styles.softCount : styles.zeroCount }, employee.dueToday)),
        createElement('td', { 'data-label': 'Overdue' }, createElement('span', { className: employee.overdue ? styles.dangerCount : styles.zeroCount }, employee.overdue)),
        createElement('td', { 'data-label': 'Active contacts' }, employee.activeAssignedContacts),
        createElement('td', { 'data-label': 'Missing next follow-up' }, createElement('span', { className: employee.contactsWithoutNextFollowUp ? styles.softCount : styles.zeroCount }, employee.contactsWithoutNextFollowUp)),
        createElement('td', { 'data-label': 'Enrollments' }, createElement('span', { className: employee.enrollments ? styles.successCount : styles.zeroCount }, employee.enrollments)),
        createElement('td', { 'data-label': 'Signal' }, createElement('span', { className: styles.signal },
          createElement('span', { className: `${styles.dot || ''} ${employee.signalTone || ''}` }), employee.signal,
        )),
        )),
        !roster.length && createElement('tr', null,
          createElement('td', { colSpan: 8, className: styles.emptyCell }, 'No employees match this attention filter. The unassigned bucket remains visible above when scoped records exist.'),
        ),
      ),
    ),
  );
}
