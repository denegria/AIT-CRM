import { isRegularCoordinatorSession } from '../crm/coordinator-policy.js';

const CANCELLATION_ACTIONS = new Set(['cancel', 'request_cancel', 'request_removal']);

export function taskMutationAccessDecision({ session = {}, task = {}, action = '' } = {}) {
  const user = session.user || {};
  const hasBusinessUnitAccess = Boolean(
    user.canAccessAllBusinessUnits ||
    (user.businessUnitIds || []).includes(task.businessUnitId),
  );
  if (!hasBusinessUnitAccess) {
    return {
      allowed: false,
      status: 403,
      error: 'Insufficient business-unit access.',
    };
  }

  const normalizedAction = String(action || '').trim();
  if (
    isRegularCoordinatorSession(session) &&
    task.ownerUserId !== user.id &&
    !CANCELLATION_ACTIONS.has(normalizedAction)
  ) {
    return {
      allowed: false,
      status: 403,
      error: 'Regular coordinators can only access tasks assigned to them.',
    };
  }

  return { allowed: true, status: 200, error: '' };
}
