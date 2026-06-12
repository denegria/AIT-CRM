export function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function taskDueKey(task) {
  return dateKey(task?.dueAt || task?.dueDate);
}

const CLOSED_TASK_STATUSES = new Set(['completed', 'canceled']);

export function isOpenTask(task) {
  const status = task?.taskStatus || task?.status || (task?.completed ? 'completed' : 'open');
  return !task?.completed && !CLOSED_TASK_STATUSES.has(status);
}

export function buildTaskCalendarEvents(tasks = []) {
  return tasks
    .filter(isOpenTask)
    .map((task) => {
      const dueDate = taskDueKey(task);
      if (!dueDate) return null;
      return {
        id: `task-${task.id}`,
        title: `Task: ${task.title || 'Untitled task'}`,
        date: dueDate,
        type: 'deadline',
        href: '/tasks',
        contactId: task.contactId || '',
        businessUnitId: task.businessUnitId || '',
      };
    })
    .filter(Boolean);
}
