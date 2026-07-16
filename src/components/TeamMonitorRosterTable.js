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
        ['Employee / signal', 'Assigned contacts', 'Task progress', 'Overdue', 'Enrollments', 'Cancellations', 'Missing next follow-up']
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
        createElement('td', { 'data-label': 'Employee / signal' }, createElement('div', { className: styles.employeeCell },
          avatar(employee),
          createElement('span', null,
            createElement('strong', null, employee.name || employee.email || 'Unnamed user'),
            createElement('small', null, `${employee.roleLabel} · ${employee.signal}`),
          ),
        )),
        createElement('td', { 'data-label': 'Assigned contacts' }, employee.assignedContacts),
        createElement('td', { 'data-label': 'Task progress' }, createElement('span', { className: styles.progressCell },
          createElement('strong', null, `${employee.completedTasks} / ${employee.taskProgressTotal}`),
          createElement('small', null, `${employee.openTasks} open`),
        )),
        createElement('td', { 'data-label': 'Overdue' }, createElement('span', { className: employee.overdue ? styles.dangerCount : styles.zeroCount }, employee.overdue)),
        createElement('td', { 'data-label': 'Enrollments' }, createElement('span', { className: employee.enrollments ? styles.successCount : styles.zeroCount }, employee.enrollments)),
        createElement('td', { 'data-label': 'Cancellations' }, createElement('span', { className: employee.cancellations ? styles.dangerCount : styles.zeroCount }, employee.cancellations)),
        createElement('td', { 'data-label': 'Missing next follow-up' }, createElement('span', { className: employee.contactsWithoutNextFollowUp ? styles.softCount : styles.zeroCount }, employee.contactsWithoutNextFollowUp)),
        )),
        !roster.length && createElement('tr', null,
          createElement('td', { colSpan: 7, className: styles.emptyCell }, 'No employees or unassigned work match this filter.'),
        ),
      ),
    ),
  );
}
