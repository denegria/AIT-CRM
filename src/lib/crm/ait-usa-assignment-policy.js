import { createCrmError } from './errors.js';
import {
  ROLE_KEYS,
  userHasRole,
} from '../roles.js';
import { isEligibleAitUsaAssigneeRole } from './ait-usa-assignee.js';

export function canManageAitUsaAssignments(session) {
  return Boolean(
    userHasRole(session?.user, ROLE_KEYS.ADMIN) ||
    userHasRole(session?.user, ROLE_KEYS.SENIOR_COORDINATOR)
  );
}

export function assertCanManageAitUsaAssignments(session) {
  if (!canManageAitUsaAssignments(session)) {
    throw createCrmError('Only Senior Coordinators or administrators can change AIT USA assignments.', 403);
  }
}

export function isEligibleAitUsaCoordinatorRole(roleKeys = []) {
  return isEligibleAitUsaAssigneeRole({ roleKeys });
}

export { isEligibleAitUsaAssigneeRole } from './ait-usa-assignee.js';
