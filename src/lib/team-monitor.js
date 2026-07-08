import {
  isTaskClosed,
  isTaskDueToday,
  isTaskOpen,
  isTaskOverdue,
  taskDateKey,
} from './tasks/visibility.js';
import { ROLE_KEYS, roleKeysForUser } from './crm/coordinator-policy.js';

const TEAM_MONITOR_ROLE_KEYS = new Set([
  ROLE_KEYS.ADMIN,
  ROLE_KEYS.SENIOR_COORDINATOR,
]);

function taskOwnerId(task = {}) {
  return task.ownerUserId || task.assignedTo || '';
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
  currentUser = null,
  today = taskDateKey(new Date()),
  now = Date.now(),
} = {}) {
  const normalizedTasks = tasks.map(normalizeMonitorTask);
  const tasksByOwner = new Map();
  for (const task of normalizedTasks) {
    if (!task.ownerUserId) continue;
    const ownerTasks = tasksByOwner.get(task.ownerUserId) || [];
    ownerTasks.push(task);
    tasksByOwner.set(task.ownerUserId, ownerTasks);
  }

  const roster = employees.map((employee) => {
    const employeeTasks = tasksByOwner.get(employee.id) || [];
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
  };

  return {
    canUseTeamMonitor: canUseTeamMonitor(currentUser),
    summary,
    roster,
    lowDataNotice: 'Online and last-online use current session plus CRM task activity until dedicated activity tracking exists.',
    updatedLabel: 'Local CRM data',
  };
}
