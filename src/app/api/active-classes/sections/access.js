import { canManageSubmittedAttendance, isAttendanceEmployee } from '../../../../lib/attendance/policy.js';
import { isUuid } from '../../../../lib/crm/validation.js';

export function classManagementAccess(user, businessUnitId, write = false) {
  if (!isAttendanceEmployee(user) || (write && !canManageSubmittedAttendance(user))) {
    return { status: 403, error: 'Class management is limited to authorized AIT USA employees.' };
  }
  if (!isUuid(businessUnitId) || !user.businessUnitIds?.includes(businessUnitId)) {
    return { status: 403, error: 'A scoped business unit is required.' };
  }
  return null;
}
