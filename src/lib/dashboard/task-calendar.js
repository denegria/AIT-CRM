import {
  isTaskOpen,
  taskDueKey,
} from '../tasks/visibility.js';

export function isOpenTask(task) {
  return isTaskOpen(task);
}

export { taskDueKey };

export function buildTaskCalendarEvents(tasks = []) {
  return tasks
    .filter(isOpenTask)
    .map((task) => {
      const isTimedFollowUp = task.taskType === 'follow_up' && task.metadataJson?.followUpDueHasTime === true;
      const dueAt = isTimedFollowUp ? new Date(task.dueAt) : null;
      const dueDate = dueAt && !Number.isNaN(dueAt.getTime())
        ? `${dueAt.getFullYear()}-${String(dueAt.getMonth() + 1).padStart(2, '0')}-${String(dueAt.getDate()).padStart(2, '0')}`
        : taskDueKey(task);
      if (!dueDate) return null;
      return {
        id: `task-${task.id}`,
        title: isTimedFollowUp ? 'Task: Follow-up' : `Task: ${task.title || 'Untitled task'}`,
        description: isTimedFollowUp ? '' : task.description || '',
        ...(isTimedFollowUp ? { dueAt: dueAt.toISOString(), ownerUserId: task.ownerUserId || '' } : {}),
        date: dueDate,
        type: 'deadline',
        href: task.id ? `/tasks/${task.id}` : '/tasks',
        contactId: task.contactId || '',
        businessUnitId: task.businessUnitId || '',
      };
    })
    .filter(Boolean);
}
