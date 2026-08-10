import { createElement } from 'react';

function completionState(task = {}) {
  return Boolean(task.completed || task.status === 'completed' || task.taskStatus === 'completed');
}

export function TaskCompletionControl({
  task = {},
  mutation = {},
  onComplete,
  canComplete = true,
  styles = {},
} = {}) {
  const completed = completionState(task);
  const pending = mutation.status === 'pending';
  const succeeded = mutation.status === 'success';
  const error = mutation.status === 'error' ? mutation.error : '';
  const feedbackId = `task-completion-${String(task.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const feedback = pending ? 'Saving…' : succeeded ? 'Saved' : error;

  return createElement('div', { className: styles.actionCell },
    createElement('button', {
      type: 'button',
      className: `${styles.check || ''} ${completed ? styles.checked || '' : ''}`.trim(),
      disabled: pending || !canComplete,
      'aria-busy': pending || undefined,
      'aria-describedby': feedback ? feedbackId : undefined,
      'aria-label': completed
        ? `Task completed: ${task.title || 'Untitled task'}`
        : pending
          ? `Completing task: ${task.title || 'Untitled task'}`
          : `Mark task complete: ${task.title || 'Untitled task'}`,
      onClick: pending || !canComplete ? undefined : onComplete,
    }, completed ? '✓' : ''),
    feedback && createElement('span', {
      id: feedbackId,
      className: error ? styles.actionError : styles.actionStatus,
      role: error ? 'alert' : 'status',
    }, feedback),
  );
}
