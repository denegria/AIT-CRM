import {
  isTaskClosed,
  isTaskDueToday,
  isTaskOpen,
  isTaskOverdue,
  taskDateKey,
} from './tasks/visibility.js';
import { ROLE_KEYS, roleKeysForUser } from './crm/coordinator-policy.js';
import { WORKFLOW_KEYS, normalizeLifecycleStatus } from './crm/lifecycle.js';

const TEAM_MONITOR_ROLE_KEYS = new Set([
  ROLE_KEYS.ADMIN,
]);

function taskOwnerId(task = {}) {
  return task.ownerUserId || task.assignedTo || '';
}

function clean(value = '') {
  return String(value || '').trim();
}

function contactOwnerId(contact = {}) {
  return contact.assignedTo || contact.ownerUserId || contact.assignedUserId || '';
}

function taskTime(task = {}) {
  return [
    task.updatedAt,
    task.completedAt,
    task.createdAt,
    task.dueAt,
    task.dueDate,
  ].reduce((latest, value) => {
    const time = new Date(value || '').getTime();
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);
}

function relativeTimeLabel(time, now = Date.now()) {
  if (!time) return 'No recent CRM activity';
  const diffMs = Math.max(0, now - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function dateTime(value = '') {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function dateOnly(value = '') {
  const time = dateTime(value);
  return time ? new Date(time).toISOString().slice(0, 10) : '';
}

function startOfUtcDay(time) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfUtcWeek(time) {
  const dayStart = startOfUtcDay(time);
  const day = new Date(dayStart).getUTCDay();
  const mondayOffset = (day + 6) % 7;
  return dayStart - (mondayOffset * 24 * 60 * 60 * 1000);
}

function inRange(time, start, end) {
  return Boolean(time && time >= start && time < end);
}

function contactStatus(contact = {}) {
  const workflowKey = clean(contact.workflowKey);
  return normalizeLifecycleStatus(clean(contact.currentStage) || clean(contact.status), { workflowKey }) ||
    clean(contact.currentStage) ||
    clean(contact.status);
}

function isAitUsaContact(contact = {}) {
  return contact.workflowKey === WORKFLOW_KEYS.AIT_USA;
}

function courseRecords(contact = {}) {
  return Array.isArray(contact.courseRecords) ? contact.courseRecords : [];
}

function enrollmentDateForContact(contact = {}) {
  const activeCourse = courseRecords(contact)
    .filter((record) => ['active', 'planned'].includes(clean(record.status)))
    .sort((left, right) => dateTime(right.startDate || right.createdAt) - dateTime(left.startDate || left.createdAt))[0];
  return dateOnly(
    contact.enrollmentStatusChangedAt ||
    contact.enrolledAt ||
    contact.enrollmentDate ||
    activeCourse?.startDate,
  );
}

function cancellationDateForContact(contact = {}) {
  const endedCourse = courseRecords(contact)
    .filter((record) => ['cancelled', 'dropped', 'transferred'].includes(clean(record.status)))
    .sort((left, right) => dateTime(right.endDate || right.updatedAt || right.createdAt) - dateTime(left.endDate || left.updatedAt || left.createdAt))[0];
  return dateOnly(
    contact.droppedStatusChangedAt ||
    contact.cancelledAt ||
    contact.canceledAt ||
    contact.droppedAt ||
    endedCourse?.endDate,
  );
}

function isEnrolledContact(contact = {}) {
  if (!isAitUsaContact(contact)) return false;
  return contactStatus(contact) === 'Enrolled';
}

function isCancellationContact(contact = {}) {
  if (!isAitUsaContact(contact)) return false;
  return contactStatus(contact) === 'Dropped / Quit' ||
    courseRecords(contact).some((record) => ['cancelled', 'dropped', 'transferred'].includes(clean(record.status)));
}

function isAssignedContact(contact = {}) {
  if (!isAitUsaContact(contact)) return false;
  return Boolean(contactOwnerId(contact));
}

function trendLabel(current = 0, previous = 0) {
  const delta = current - previous;
  if (delta > 0) return `+${delta} vs last week`;
  if (delta < 0) return `${delta} vs last week`;
  return 'Flat vs last week';
}

export function buildBusinessMovement({ contacts = [], employeeIds = [], now = Date.now() } = {}) {
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const weekStart = startOfUtcWeek(now);
  const nextWeekStart = weekStart + 7 * 24 * 60 * 60 * 1000;
  const previousWeekStart = weekStart - 7 * 24 * 60 * 60 * 1000;
  const employeeSet = new Set(employeeIds);
  const byEmployee = new Map(employeeIds.map((id) => [id, {
    assignedContacts: 0,
    enrollmentsToday: 0,
    enrollmentsThisWeek: 0,
    enrollmentsPreviousWeek: 0,
    cancellationsThisWeek: 0,
    cancellationsPreviousWeek: 0,
    enrolledTotal: 0,
  }]));
  const totals = {
    assignedContacts: 0,
    enrollmentsToday: 0,
    enrollmentsThisWeek: 0,
    enrollmentsPreviousWeek: 0,
    cancellationsThisWeek: 0,
    cancellationsPreviousWeek: 0,
    enrolledTotal: 0,
  };

  for (const contact of contacts) {
    if (!isAitUsaContact(contact)) continue;
    const ownerId = contactOwnerId(contact);
    const employeeMetrics = employeeSet.has(ownerId) ? byEmployee.get(ownerId) : null;
    const targets = [totals, employeeMetrics].filter(Boolean);

    if (isAssignedContact(contact)) {
      for (const target of targets) target.assignedContacts += 1;
    }

    if (isEnrolledContact(contact)) {
      const enrollmentTime = dateTime(enrollmentDateForContact(contact));
      for (const target of targets) target.enrolledTotal += 1;
      if (inRange(enrollmentTime, todayStart, tomorrowStart)) {
        for (const target of targets) target.enrollmentsToday += 1;
      }
      if (inRange(enrollmentTime, weekStart, nextWeekStart)) {
        for (const target of targets) target.enrollmentsThisWeek += 1;
      }
      if (inRange(enrollmentTime, previousWeekStart, weekStart)) {
        for (const target of targets) target.enrollmentsPreviousWeek += 1;
      }
    }

    if (isCancellationContact(contact)) {
      const cancellationTime = dateTime(cancellationDateForContact(contact));
      if (inRange(cancellationTime, weekStart, nextWeekStart)) {
        for (const target of targets) target.cancellationsThisWeek += 1;
      }
      if (inRange(cancellationTime, previousWeekStart, weekStart)) {
        for (const target of targets) target.cancellationsPreviousWeek += 1;
      }
    }
  }

  return {
    byEmployee,
    totals: {
      ...totals,
      netEnrollmentsThisWeek: totals.enrollmentsThisWeek - totals.cancellationsThisWeek,
      enrollmentTrendLabel: trendLabel(totals.enrollmentsThisWeek, totals.enrollmentsPreviousWeek),
      cancellationTrendLabel: trendLabel(totals.cancellationsThisWeek, totals.cancellationsPreviousWeek),
    },
  };
}

export function canUseTeamMonitor(user = {}) {
  const roleKeys = roleKeysForUser(user);
  return roleKeys.some((roleKey) => TEAM_MONITOR_ROLE_KEYS.has(roleKey));
}

export function normalizeMonitorTask(task = {}) {
  const dueAt = task.dueAt || task.dueDate || null;
  const status = task.status || task.taskStatus || (task.completed ? 'completed' : 'open');
  return {
    ...task,
    dueAt,
    ownerUserId: taskOwnerId(task),
    status,
    completed: Boolean(task.completed || status === 'completed'),
    priority: String(task.priority || 'medium').toLowerCase(),
  };
}

export function taskScopeMatches(task = {}, scope = 'mine', currentUserId = '', employeeIds = []) {
  const ownerUserId = taskOwnerId(task);
  if (scope === 'mine') return Boolean(currentUserId && ownerUserId === currentUserId);
  if (scope === 'team') return Boolean(ownerUserId && employeeIds.includes(ownerUserId));
  if (scope === 'all') return true;
  return false;
}

export function buildTaskScopePreview({
  tasks = [],
  employees = [],
  currentUser = null,
  scope = 'mine',
  filter = 'today',
  limit = 6,
  today = taskDateKey(new Date()),
} = {}) {
  const employeeIds = employees.map((employee) => employee.id).filter(Boolean);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const currentUserId = currentUser?.id || '';
  const normalizedTasks = tasks.map(normalizeMonitorTask);

  return normalizedTasks
    .filter((task) => taskScopeMatches(task, scope, currentUserId, employeeIds))
    .filter((task) => {
      if (filter === 'overdue') return isTaskOverdue(task, today);
      if (filter === 'unassigned') return !task.ownerUserId && isTaskOpen(task);
      return isTaskDueToday(task, today);
    })
    .sort((left, right) => {
      const leftDue = new Date(left.dueAt || '').getTime() || Number.MAX_SAFE_INTEGER;
      const rightDue = new Date(right.dueAt || '').getTime() || Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue || String(left.title || '').localeCompare(String(right.title || ''));
    })
    .slice(0, limit)
    .map((task) => ({
      ...task,
      ownerName: task.ownerUserId
        ? employeeById.get(task.ownerUserId)?.name || task.ownerName || 'Assigned'
        : 'Unassigned',
      contextLabel: task.sourceLabel || task.client || task.contactName || task.taskType || 'Task',
    }));
}

export function buildTeamMonitorViewModel({
  employees = [],
  tasks = [],
  contacts = [],
  currentUser = null,
  today = taskDateKey(new Date()),
  now = Date.now(),
  businessMovement: providedBusinessMovement = null,
} = {}) {
  const normalizedTasks = tasks.map(normalizeMonitorTask);
  const employeeIds = employees.map((employee) => employee.id).filter(Boolean);
  const businessMovement = providedBusinessMovement
    ? {
      byEmployee: new Map(Object.entries(providedBusinessMovement.byEmployee || {})),
      totals: providedBusinessMovement.totals || {},
    }
    : buildBusinessMovement({ contacts, employeeIds, now });
  const tasksByOwner = new Map();
  for (const task of normalizedTasks) {
    if (!task.ownerUserId) continue;
    const ownerTasks = tasksByOwner.get(task.ownerUserId) || [];
    ownerTasks.push(task);
    tasksByOwner.set(task.ownerUserId, ownerTasks);
  }

  const roster = employees.map((employee) => {
    const employeeTasks = tasksByOwner.get(employee.id) || [];
    const businessMetrics = businessMovement.byEmployee.get(employee.id) || {};
    const openTasks = employeeTasks.filter(isTaskOpen);
    const completedToday = employeeTasks.filter((task) => task.completed && taskDateKey(task.completedAt || task.updatedAt) === today);
    const dueToday = employeeTasks.filter((task) => isTaskDueToday(task, today));
    const overdue = employeeTasks.filter((task) => isTaskOverdue(task, today));
    const incomplete = openTasks.length;
    const totalToday = dueToday.length + completedToday.length;
    const progressDone = completedToday.length;
    const latestActivityTime = employeeTasks.reduce((latest, task) => Math.max(latest, taskTime(task)), 0);
    const isCurrentUser = Boolean(currentUser?.id && employee.id === currentUser.id);
    const attentionCount = overdue.length + Math.max(0, dueToday.length - completedToday.length);
    const signal = overdue.length
      ? 'Behind'
      : attentionCount > 2
        ? 'Watch'
        : 'On track';

    return {
      ...employee,
      roleLabel: employee.roleLabel || employee.roleKeys?.[0]?.replaceAll('_', ' ') || 'Team member',
      presenceLabel: isCurrentUser ? 'Active session' : 'Activity signal unavailable',
      presenceTone: isCurrentUser ? 'online' : 'unknown',
      lastOnlineLabel: isCurrentUser ? 'Now' : relativeTimeLabel(latestActivityTime, now),
      progressDone,
      progressTotal: Math.max(totalToday, openTasks.length, employeeTasks.length),
      assignedCount: employeeTasks.length,
      incompleteCount: incomplete,
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
      needsFollowUpCount: attentionCount,
      assignedContactCount: businessMetrics.assignedContacts || 0,
      enrollmentsTodayCount: businessMetrics.enrollmentsToday || 0,
      enrollmentsThisWeekCount: businessMetrics.enrollmentsThisWeek || 0,
      cancellationsThisWeekCount: businessMetrics.cancellationsThisWeek || 0,
      enrolledTotalCount: businessMetrics.enrolledTotal || 0,
      signal,
      signalTone: signal === 'Behind' ? 'danger' : signal === 'Watch' ? 'warning' : 'success',
      todayTasks: dueToday.slice(0, 5),
      overdueTasks: overdue.slice(0, 5),
    };
  }).sort((left, right) => (
    right.overdueCount - left.overdueCount ||
    right.needsFollowUpCount - left.needsFollowUpCount ||
    String(left.name || '').localeCompare(String(right.name || ''))
  ));

  const summary = {
    onlineNow: roster.filter((employee) => employee.presenceTone === 'online').length,
    dueToday: normalizedTasks.filter((task) => isTaskDueToday(task, today)).length,
    overdue: normalizedTasks.filter((task) => isTaskOverdue(task, today)).length,
    needsFollowUp: roster.reduce((sum, employee) => sum + employee.needsFollowUpCount, 0),
    enrollmentsToday: businessMovement.totals.enrollmentsToday,
    enrollmentsThisWeek: businessMovement.totals.enrollmentsThisWeek,
    cancellationsThisWeek: businessMovement.totals.cancellationsThisWeek,
    assignedContacts: businessMovement.totals.assignedContacts,
    netEnrollmentsThisWeek: businessMovement.totals.netEnrollmentsThisWeek,
    enrollmentTrendLabel: businessMovement.totals.enrollmentTrendLabel,
    cancellationTrendLabel: businessMovement.totals.cancellationTrendLabel,
  };

  return {
    canUseTeamMonitor: canUseTeamMonitor(currentUser),
    summary,
    roster,
    lowDataNotice: 'Online/last-online use current session plus task activity. Enrollment movement ignores bulk reconcile/import artifacts.',
    updatedLabel: 'Local CRM data',
  };
}
