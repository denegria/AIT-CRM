import { isRegularCoordinatorSession } from '../crm/coordinator-policy.js';
import { NOTIFICATION_TYPES } from './service.js';

export function canReadInboundLeadNotifications(session = {}) {
  return !isRegularCoordinatorSession(session);
}

export function canReadNotification(session = {}, notification = {}) {
  if (notification.userId && notification.userId !== session.user?.id) return false;
  if (notification.type === NOTIFICATION_TYPES.INBOUND_LEAD && !canReadInboundLeadNotifications(session)) {
    return false;
  }
  if (session.user?.canAccessAllBusinessUnits) return true;
  if (!notification.businessUnitId) return true;
  return (session.user?.businessUnitIds || []).includes(notification.businessUnitId);
}
