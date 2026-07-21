import {
  canAccessBusinessUnit,
  isRegularCoordinatorSession,
} from '../crm/access.js';
import { TASK_TYPES } from './constants.js';
import { canReviewTaskRemovalApprovals } from './removal-approval-view.js';

export function canReadTaskDetail(session, task) {
  if (!session?.user || !task) return false;
  if (!canAccessBusinessUnit(session, task.businessUnitId)) return false;
  if (
    task.taskType === TASK_TYPES.TASK_REMOVAL_APPROVAL &&
    !canReviewTaskRemovalApprovals(session.user)
  ) return false;
  if (isRegularCoordinatorSession(session) && task.ownerUserId !== session.user.id) return false;
  return true;
}
