import {
  ROLE_KEYS,
  isRegularCoordinatorSession,
  userHasRole,
} from '../crm/coordinator-policy.js';
import {
  TASK_PRIORITIES,
  TASK_SOURCE_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
} from './constants.js';

export const TASK_CANCELLATION_DECISIONS = Object.freeze({
  DIRECT_CANCEL: 'direct_cancel',
  APPROVAL_REQUIRED: 'approval_required',
  FORBIDDEN: 'forbidden',
});

export const TASK_CANCELLATION_REASON_CODES = Object.freeze({
  ELIGIBLE_COORDINATOR_TASK: 'eligible_coordinator_task',
  PRIVILEGED_ROLE: 'privileged_role',
  CLOSED_TASK: 'closed_task',
  APPROVAL_TASK: 'approval_task',
  PENDING_APPROVAL: 'pending_approval',
  OWNER_MISMATCH: 'owner_mismatch',
  CREATOR_MISMATCH: 'creator_mismatch',
  PROTECTED_SOURCE: 'protected_source',
  PROTECTED_TYPE: 'protected_type',
  PROTECTED_PRIORITY: 'protected_priority',
  ROLE_NOT_PERMITTED: 'role_not_permitted',
});

const OPEN_TASK_STATUSES = new Set([
  TASK_STATUSES.OPEN,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.SNOOZED,
]);

const APPROVAL_TASK_TYPES = new Set([
  TASK_TYPES.ARCHIVE_APPROVAL,
  TASK_TYPES.TASK_REMOVAL_APPROVAL,
]);

const COORDINATOR_DIRECT_TYPES = new Set([
  TASK_TYPES.FOLLOW_UP,
  TASK_TYPES.MANUAL_REMINDER,
]);

const COORDINATOR_DIRECT_PRIORITIES = new Set([
  TASK_PRIORITIES.LOW,
  TASK_PRIORITIES.MEDIUM,
]);

function decision(decisionValue, reasonCode) {
  return {
    decision: decisionValue,
    reasonCode,
    requiresReason: decisionValue !== TASK_CANCELLATION_DECISIONS.FORBIDDEN,
  };
}

function hasPrivilegedCancellationRole(session = {}) {
  return [
    ROLE_KEYS.ADMIN,
    ROLE_KEYS.SENIOR_COORDINATOR,
  ].some((roleKey) => userHasRole(session.user, roleKey));
}

export function taskCancellationDecision({ session = {}, task = {} } = {}) {
  if (!session.user?.id || !task?.id) {
    return decision(TASK_CANCELLATION_DECISIONS.FORBIDDEN, TASK_CANCELLATION_REASON_CODES.ROLE_NOT_PERMITTED);
  }
  if (!OPEN_TASK_STATUSES.has(task.status)) {
    return decision(TASK_CANCELLATION_DECISIONS.FORBIDDEN, TASK_CANCELLATION_REASON_CODES.CLOSED_TASK);
  }
  if (APPROVAL_TASK_TYPES.has(task.taskType)) {
    return decision(TASK_CANCELLATION_DECISIONS.FORBIDDEN, TASK_CANCELLATION_REASON_CODES.APPROVAL_TASK);
  }
  if (task.metadataJson?.removalApproval?.decision === 'pending') {
    return decision(
      isRegularCoordinatorSession(session)
        ? TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED
        : TASK_CANCELLATION_DECISIONS.FORBIDDEN,
      TASK_CANCELLATION_REASON_CODES.PENDING_APPROVAL,
    );
  }
  if (hasPrivilegedCancellationRole(session)) {
    return decision(TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL, TASK_CANCELLATION_REASON_CODES.PRIVILEGED_ROLE);
  }
  if (!isRegularCoordinatorSession(session)) {
    return decision(TASK_CANCELLATION_DECISIONS.FORBIDDEN, TASK_CANCELLATION_REASON_CODES.ROLE_NOT_PERMITTED);
  }
  if (task.ownerUserId !== session.user.id) {
    return decision(TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED, TASK_CANCELLATION_REASON_CODES.OWNER_MISMATCH);
  }
  if (task.createdByUserId !== session.user.id) {
    return decision(TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED, TASK_CANCELLATION_REASON_CODES.CREATOR_MISMATCH);
  }
  if (String(task.sourceType || '').trim().toLowerCase() !== TASK_SOURCE_TYPES.MANUAL) {
    return decision(TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED, TASK_CANCELLATION_REASON_CODES.PROTECTED_SOURCE);
  }
  if (!COORDINATOR_DIRECT_TYPES.has(task.taskType)) {
    return decision(TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED, TASK_CANCELLATION_REASON_CODES.PROTECTED_TYPE);
  }
  if (!COORDINATOR_DIRECT_PRIORITIES.has(String(task.priority || '').trim().toLowerCase())) {
    return decision(TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED, TASK_CANCELLATION_REASON_CODES.PROTECTED_PRIORITY);
  }

  return decision(TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL, TASK_CANCELLATION_REASON_CODES.ELIGIBLE_COORDINATOR_TASK);
}
