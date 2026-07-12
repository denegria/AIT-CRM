export const ROLE_KEYS = Object.freeze({
  ADMIN: 'admin',
  SENIOR_COORDINATOR: 'senior_coordinator',
  ACCOUNT_COORDINATOR: 'account_coordinator',
  ACCOUNT_MANAGER: 'account_manager',
  DESIGNER: 'designer',
  SALES_MANAGER: 'sales_manager',
});

export const ACCOUNT_COORDINATOR_ROLE_KEY = ROLE_KEYS.ACCOUNT_COORDINATOR;
export const LEGACY_ACCOUNT_MANAGER_ROLE_KEY = ROLE_KEYS.ACCOUNT_MANAGER;

export const LEGACY_ROLE_ALIASES = Object.freeze({
  [LEGACY_ACCOUNT_MANAGER_ROLE_KEY]: ACCOUNT_COORDINATOR_ROLE_KEY,
});

export const ROLE_LABELS = Object.freeze({
  [ROLE_KEYS.ADMIN]: 'Administrator',
  [ROLE_KEYS.SENIOR_COORDINATOR]: 'Senior Coordinator',
  [ROLE_KEYS.ACCOUNT_COORDINATOR]: 'Account Coordinator',
  [ROLE_KEYS.ACCOUNT_MANAGER]: 'Account Coordinator',
  [ROLE_KEYS.DESIGNER]: 'Designer',
  [ROLE_KEYS.SALES_MANAGER]: 'Sales Manager',
});

export const MANAGED_ROLE_KEYS = Object.freeze([
  ROLE_KEYS.ADMIN,
  ROLE_KEYS.SENIOR_COORDINATOR,
  ROLE_KEYS.DESIGNER,
  ROLE_KEYS.ACCOUNT_COORDINATOR,
  ROLE_KEYS.SALES_MANAGER,
]);

export const MANAGED_ROLE_LOOKUP_KEYS = Object.freeze([
  ...MANAGED_ROLE_KEYS,
  LEGACY_ACCOUNT_MANAGER_ROLE_KEY,
]);

export const INVITE_ROLE_KEYS = Object.freeze([
  ROLE_KEYS.ACCOUNT_COORDINATOR,
  ROLE_KEYS.SENIOR_COORDINATOR,
  ROLE_KEYS.DESIGNER,
  ROLE_KEYS.SALES_MANAGER,
]);

export const INVITE_ROLE_LOOKUP_KEYS = Object.freeze([
  ...INVITE_ROLE_KEYS,
  LEGACY_ACCOUNT_MANAGER_ROLE_KEY,
]);

export function cleanRoleKey(value) {
  return String(value || '').trim();
}

export function canonicalRoleKey(value) {
  const roleKey = cleanRoleKey(value);
  return LEGACY_ROLE_ALIASES[roleKey] || roleKey;
}

export function canonicalRoleKeys(values = []) {
  return [...new Set(values.map(canonicalRoleKey).filter(Boolean))];
}

export function roleKeyMatches(left, right) {
  const normalizedLeft = canonicalRoleKey(left);
  return Boolean(normalizedLeft && normalizedLeft === canonicalRoleKey(right));
}

export function roleKeysForUser(user = {}) {
  return canonicalRoleKeys([
    user?.primaryRoleKey,
    ...(Array.isArray(user?.roleKeys) ? user.roleKeys : []),
  ]);
}

export function userHasRole(user = {}, roleKey) {
  return roleKeysForUser(user).some((candidate) => roleKeyMatches(candidate, roleKey));
}

export function isRegularCoordinatorRoleKey(roleKey) {
  return roleKeyMatches(roleKey, ACCOUNT_COORDINATOR_ROLE_KEY);
}

export function normalizeRoleKey(value, allowedRoleKeys = MANAGED_ROLE_KEYS, { allowLegacy = true } = {}) {
  const roleKey = cleanRoleKey(value);
  const normalizedRoleKey = allowLegacy ? canonicalRoleKey(roleKey) : roleKey;
  return allowedRoleKeys.includes(normalizedRoleKey) ? normalizedRoleKey : '';
}

export function compatibleRoleLookupKeys(roleKey) {
  const normalizedRoleKey = canonicalRoleKey(roleKey);
  if (!normalizedRoleKey) return [];
  if (normalizedRoleKey === ACCOUNT_COORDINATOR_ROLE_KEY) {
    return [ACCOUNT_COORDINATOR_ROLE_KEY, LEGACY_ACCOUNT_MANAGER_ROLE_KEY];
  }
  return [normalizedRoleKey];
}

export function preferredRoleRowForKey(roleRows = [], roleKey) {
  const normalizedRoleKey = canonicalRoleKey(roleKey);
  if (!normalizedRoleKey) return null;
  const canonicalRow = roleRows.find((row) => row?.key === normalizedRoleKey);
  if (canonicalRow) return canonicalRow;
  if (normalizedRoleKey === ACCOUNT_COORDINATOR_ROLE_KEY) {
    return roleRows.find((row) => row?.key === LEGACY_ACCOUNT_MANAGER_ROLE_KEY) || null;
  }
  return null;
}

export function roleLabel(roleKey) {
  const normalizedRoleKey = canonicalRoleKey(roleKey);
  return ROLE_LABELS[normalizedRoleKey] || ROLE_LABELS[roleKey] || String(roleKey || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
