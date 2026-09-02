import {
  ROLE_KEYS,
  canonicalRoleKeys,
  isRegularCoordinatorRoleKey,
} from '../roles.js';

export function isEligibleAitUsaAssigneeRole({
  roleKeys = [],
  assigneeUserId = '',
  actorUserId = '',
} = {}) {
  const normalized = canonicalRoleKeys(roleKeys);
  const isElevated = [
    ROLE_KEYS.ADMIN,
    ROLE_KEYS.SENIOR_COORDINATOR,
    ROLE_KEYS.SALES_MANAGER,
  ].some((roleKey) => normalized.includes(roleKey));
  const isRegularCoordinator = normalized.some(isRegularCoordinatorRoleKey) && !isElevated;
  const isActingSeniorCoordinator = normalized.includes(ROLE_KEYS.SENIOR_COORDINATOR) &&
    Boolean(assigneeUserId) &&
    assigneeUserId === actorUserId;
  return isRegularCoordinator || isActingSeniorCoordinator;
}

export function isEligibleAitUsaAssignee({
  owner = {},
  businessUnitId = '',
  actorUserId = '',
} = {}) {
  return Boolean(
    businessUnitId &&
    (owner.businessUnitIds || []).includes(businessUnitId) &&
    isEligibleAitUsaAssigneeRole({
      roleKeys: owner.roleKeys,
      assigneeUserId: owner.id,
      actorUserId,
    })
  );
}

export function aitUsaAssigneeOptionLabel(owner = {}, actorUserId = '') {
  const label = owner.label || owner.name || owner.email || 'Unnamed User';
  return owner.id && owner.id === actorUserId ? `${label} (You)` : label;
}
