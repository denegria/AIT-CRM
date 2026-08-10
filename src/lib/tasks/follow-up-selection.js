import { TASK_STATUSES, TASK_TYPES } from './constants.js';

export const FOLLOW_UP_SELECTION_ERROR_CODES = Object.freeze({
  AMBIGUOUS: 'follow_up_task_ambiguous',
  ENTITY_MISMATCH: 'follow_up_entity_mismatch',
  LEAD_AMBIGUOUS: 'follow_up_lead_ambiguous',
  MISMATCH: 'follow_up_task_mismatch',
  MISSING_IDENTIFIERS: 'follow_up_task_identifiers_required',
  NOT_FOUND: 'follow_up_task_not_found',
  STALE: 'follow_up_task_stale',
  UNAUTHORIZED: 'follow_up_task_unauthorized',
});

export const OPEN_FOLLOW_UP_TASK_STATUSES = Object.freeze([
  TASK_STATUSES.OPEN,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.SNOOZED,
]);

export function createFollowUpSelectionError(message, code, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function selectUnambiguousOpenFollowUpTask(taskRows = []) {
  if (taskRows.length > 1) {
    throw createFollowUpSelectionError(
      'Multiple open follow-up tasks match this contact. Select a specific task from the task queue.',
      FOLLOW_UP_SELECTION_ERROR_CODES.AMBIGUOUS,
    );
  }
  return taskRows[0] || null;
}

export function assertExactFollowUpTaskSelection({
  task,
  requestedTaskId,
  requestedContactId,
  requestedLeadId,
  hasContactId = true,
  hasLeadId = true,
}) {
  if (!task || task.id !== requestedTaskId) {
    throw createFollowUpSelectionError(
      'The selected follow-up task no longer exists. Refresh the task queue and select it again.',
      FOLLOW_UP_SELECTION_ERROR_CODES.NOT_FOUND,
      404,
    );
  }
  if (task.taskType !== TASK_TYPES.FOLLOW_UP) {
    throw createFollowUpSelectionError(
      'The selected task is not a follow-up task. Refresh the task queue and select a follow-up.',
      FOLLOW_UP_SELECTION_ERROR_CODES.MISMATCH,
    );
  }
  if (!OPEN_FOLLOW_UP_TASK_STATUSES.includes(task.status)) {
    throw createFollowUpSelectionError(
      'The selected follow-up task was already completed or canceled. Refresh the task queue before logging another outcome.',
      FOLLOW_UP_SELECTION_ERROR_CODES.STALE,
    );
  }
  if (!hasContactId || !hasLeadId) {
    throw createFollowUpSelectionError(
      'Follow-up completion requires the selected task, contact, and lead identifiers. Reopen the task and try again.',
      FOLLOW_UP_SELECTION_ERROR_CODES.MISSING_IDENTIFIERS,
      400,
    );
  }
  if ((task.contactId || null) !== (requestedContactId || null) ||
      (task.leadId || null) !== (requestedLeadId || null)) {
    throw createFollowUpSelectionError(
      'The selected follow-up no longer matches this contact or lead. Refresh the task queue and select it again.',
      FOLLOW_UP_SELECTION_ERROR_CODES.MISMATCH,
    );
  }
  return task;
}

export async function resolveExactFollowUpTaskRequest({
  requestedTaskId,
  requestedContactId,
  requestedLeadId,
  hasContactId = true,
  hasLeadId = true,
  loadTaskById,
  authorizeTask,
}) {
  if (!requestedTaskId) return null;
  const task = await loadTaskById(requestedTaskId);
  if (!task) {
    throw createFollowUpSelectionError(
      'The selected follow-up task no longer exists. Refresh the task queue and select it again.',
      FOLLOW_UP_SELECTION_ERROR_CODES.NOT_FOUND,
      404,
    );
  }
  await authorizeTask?.(task);
  return assertExactFollowUpTaskSelection({
    task,
    requestedTaskId,
    requestedContactId,
    requestedLeadId,
    hasContactId,
    hasLeadId,
  });
}

export function followUpSubmissionTaskId({ requestedTaskId = '', task = null } = {}) {
  return task?.id || String(requestedTaskId || '') || null;
}

export function followUpTaskEntryHref(task = {}) {
  const params = new URLSearchParams({
    action: 'log-follow-up',
    taskId: String(task.id || ''),
    contactId: String(task.contactId || ''),
    leadId: String(task.leadId || ''),
  });
  return `/tasks?${params.toString()}`;
}

export function clearedFollowUpTaskEntryHref(searchParams, pathname = '/tasks') {
  const params = new URLSearchParams(searchParams?.toString?.() || String(searchParams || ''));
  for (const key of ['action', 'taskId', 'contactId', 'leadId']) {
    params.delete(key);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildContactFollowUpLookup({
  taskId = '',
  leadId = '',
  hasLeadId = false,
} = {}) {
  const requestedTaskId = String(taskId || '');
  const requestedLeadId = String(leadId || '');
  const params = new URLSearchParams();

  if (requestedTaskId) {
    params.set('taskId', requestedTaskId);
    if (hasLeadId) params.set('leadId', requestedLeadId);
  } else if (hasLeadId) {
    params.set('leadId', requestedLeadId);
  }

  return {
    params,
    selectionKey: params.has('leadId')
      ? `lead:${params.get('leadId') || ''}`
      : 'lead:missing',
  };
}
