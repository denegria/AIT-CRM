export const OPEN_TASK_STATUSES = new Set(['open', 'in_progress', 'snoozed']);
export const CLOSED_TASK_STATUSES = new Set(['completed', 'canceled']);

export function taskDateKey(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function taskDueKey(task = {}) {
  return taskDateKey(task.dueAt || task.dueDate);
}

export function taskCompletedKey(task = {}) {
  return taskDateKey(task.completedAt || task.completedDate);
}

export function taskStatus(task = {}) {
  return task.taskStatus || task.status || (task.completed ? 'completed' : 'open');
}

export function isTaskClosed(task = {}) {
  return Boolean(task.completed) || CLOSED_TASK_STATUSES.has(taskStatus(task));
}

export function isTaskOpen(task = {}) {
  return !isTaskClosed(task) && OPEN_TASK_STATUSES.has(taskStatus(task));
}

export function isTaskDueToday(task = {}, today = taskDateKey(new Date())) {
  return isTaskOpen(task) && taskDueKey(task) === today;
}

export function isTaskOverdue(task = {}, today = taskDateKey(new Date())) {
  const due = taskDueKey(task);
  return isTaskOpen(task) && Boolean(due) && due < today;
}

export function isTaskUpcoming(task = {}, today = taskDateKey(new Date())) {
  const due = taskDueKey(task);
  return isTaskOpen(task) && Boolean(due) && due > today;
}

export function isTaskCurrentWork(task = {}, today = taskDateKey(new Date())) {
  const due = taskDueKey(task);
  return isTaskOpen(task) && (!due || due <= today);
}

export function isTaskCompletedToday(task = {}, today = taskDateKey(new Date())) {
  return (taskStatus(task) === 'completed' || Boolean(task.completed)) && taskCompletedKey(task) === today;
}
