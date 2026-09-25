import { isTaskDueToday, isTaskOpen, isTaskOverdue, taskDueKey } from '../tasks/visibility.js';

const CONTACT_FILTERS = Object.freeze({
  myNewLeads: Object.freeze({ leadDateScope: 'current', status: 'New Lead' }),
  myNeedsNextFollowUp: Object.freeze({ leadDateScope: 'all', facet: 'needs_next_follow_up' }),
});

export function dashboardContactFilter(kind, ownerUserId = '') {
  const base = CONTACT_FILTERS[kind];
  if (!base) throw new Error(`Unknown dashboard contact filter: ${kind}`);
  if (kind.startsWith('my') && !ownerUserId) throw new Error('Personal dashboard filters require an owner.');
  return kind.startsWith('my') ? { ...base, owner: ownerUserId } : { ...base };
}

export function dashboardContactHref(kind, ownerUserId = '') {
  return `/contacts?${new URLSearchParams(dashboardContactFilter(kind, ownerUserId))}`;
}

export function dashboardTaskScope(tasks = [], ownerUserId = '', businessUnitId = '', today = new Date().toISOString().slice(0, 10)) {
  const teamTasks = tasks.filter((task) => !businessUnitId || task.businessUnitId === businessUnitId);
  const personalTasks = teamTasks.filter((task) => (task.ownerUserId || task.assignedTo) === ownerUserId);
  const personalOverdue = personalTasks.filter((task) => isTaskOverdue(task, today));
  const personalToday = personalTasks.filter((task) => isTaskDueToday(task, today));
  const teamOverdue = teamTasks.filter((task) => isTaskOverdue(task, today));
  const urgentTasks = [...personalOverdue, ...personalToday]
    .sort((left, right) => taskDueKey(left).localeCompare(taskDueKey(right)) || String(left.title || '').localeCompare(String(right.title || '')));

  return {
    teamTasks,
    personalTasks,
    personalOverdue,
    personalToday,
    urgentTasks,
    teamOverdue,
    teamOtherOwnedOverdue: teamOverdue.filter((task) => {
      const assignedOwnerId = task.ownerUserId || task.assignedTo;
      return assignedOwnerId && assignedOwnerId !== ownerUserId;
    }),
    teamUnassigned: teamTasks.filter((task) => isTaskOpen(task) && !task.ownerUserId && !task.assignedTo),
  };
}
