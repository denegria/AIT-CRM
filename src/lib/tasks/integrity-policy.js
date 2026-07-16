import { TASK_SOURCE_TYPES, TASK_STATUSES, TASK_TYPES } from './constants.js';

export const AUTOMATED_INBOUND_FOLLOW_UP_SOURCE_LABEL = 'New lead follow-up';
const OPEN_STATUSES = [TASK_STATUSES.OPEN, TASK_STATUSES.IN_PROGRESS, TASK_STATUSES.SNOOZED];

export function isEligibleAutomatedInboundFollowUpTask(task = {}, {
  organizationId,
  businessUnitId,
  contactId,
} = {}) {
  return task.organizationId === organizationId &&
    task.businessUnitId === businessUnitId &&
    task.contactId === contactId &&
    task.taskType === TASK_TYPES.FOLLOW_UP &&
    task.sourceType === TASK_SOURCE_TYPES.AUTOMATION &&
    task.sourceLabel === AUTOMATED_INBOUND_FOLLOW_UP_SOURCE_LABEL &&
    OPEN_STATUSES.includes(task.status);
}

export function planAutomatedInboundFollowUpReconciliation(tasks = [], scope = {}) {
  const { action, ownerUserId } = scope;
  if (!['sync_owner', 'cancel'].includes(action)) return [];
  // `null` is a valid resolved owner when a lead is explicitly unassigned.
  // Only an omitted value means the caller did not provide an ownership target.
  if (action === 'sync_owner' && ownerUserId === undefined) return [];
  return tasks
    .filter((task) => isEligibleAutomatedInboundFollowUpTask(task, scope))
    .filter((task) => action !== 'sync_owner' || task.ownerUserId !== ownerUserId)
    .map((task) => ({ task, action }));
}
