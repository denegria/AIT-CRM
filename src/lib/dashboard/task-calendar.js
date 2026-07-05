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
      const dueDate = taskDueKey(task);
      if (!dueDate) return null;
      return {
        id: `task-${task.id}`,
        title: `Task: ${task.title || 'Untitled task'}`,
        description: task.description || '',
        date: dueDate,
        type: 'deadline',
        href: task.id ? `/tasks/${task.id}` : '/tasks',
        contactId: task.contactId || '',
        businessUnitId: task.businessUnitId || '',
      };
    })
    .filter(Boolean);
}
