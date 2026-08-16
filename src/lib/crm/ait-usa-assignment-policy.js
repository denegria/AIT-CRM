import { createCrmError } from './errors.js';
import {
  ROLE_KEYS,
  canonicalRoleKeys,
  isRegularCoordinatorRoleKey,
  userHasRole,
} from '../roles.js';

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
  const normalized = canonicalRoleKeys(roleKeys);
  return normalized.some(isRegularCoordinatorRoleKey) && ![
    ROLE_KEYS.ADMIN,
    ROLE_KEYS.SENIOR_COORDINATOR,
    ROLE_KEYS.SALES_MANAGER,
  ].some((roleKey) => normalized.includes(roleKey));
}
