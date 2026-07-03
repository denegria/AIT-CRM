import {
  canAccessBusinessUnit,
  isRegularCoordinatorSession,
} from '../crm/access.js';

export function canReadTaskDetail(session, task) {
  if (!session?.user || !task) return false;
  if (!canAccessBusinessUnit(session, task.businessUnitId)) return false;
  if (isRegularCoordinatorSession(session) && task.ownerUserId !== session.user.id) return false;
  return true;
}
