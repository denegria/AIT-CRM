import {
  MANAGED_ROLE_KEYS,
  MANAGED_ROLE_LOOKUP_KEYS,
  ROLE_KEYS,
  ROLE_LABELS,
  canonicalRoleKey,
  normalizeRoleKey,
  roleLabel,
} from '../roles.js';

export { MANAGED_ROLE_KEYS, MANAGED_ROLE_LOOKUP_KEYS, ROLE_LABELS };

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeName(value) {
  return String(value || '').trim();
}

export function normalizeManagedRoleKey(value, managedRoleKeys = MANAGED_ROLE_KEYS) {
  return normalizeRoleKey(value, managedRoleKeys);
}

export function normalizeBusinessUnitIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function requiresBusinessUnitMembership(roleKey) {
  return canonicalRoleKey(roleKey) !== ROLE_KEYS.ADMIN;
}

export function validateUserAccessDraft({
  email = '',
  name = '',
  password = '',
  roleKey = '',
  businessUnitIds = [],
  requireEmail = true,
  requirePassword = false,
  managedRoleKeys = MANAGED_ROLE_KEYS,
} = {}) {
  if (requireEmail && !email) return { ok: false, error: 'Email is required.', status: 400 };
  if (!name) return { ok: false, error: 'Name is required.', status: 400 };
  if (requirePassword && !password) return { ok: false, error: 'Initial password is required.', status: 400 };
  if (password && password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.', status: 400 };
  }
  const normalizedRoleKey = normalizeManagedRoleKey(roleKey, managedRoleKeys);
  if (!normalizedRoleKey) {
    return {
      ok: false,
      error: `Role must be one of: ${managedRoleKeys.join(', ')}.`,
      status: 400,
    };
  }
  if (requiresBusinessUnitMembership(normalizedRoleKey) && !businessUnitIds.length) {
    return { ok: false, error: 'At least one active division is required for non-admin users.', status: 400 };
  }
  return { ok: true, error: '', status: 200 };
}

export function toRoleOption(roleKey) {
  const key = canonicalRoleKey(roleKey);
  return {
    key,
    label: roleLabel(key),
  };
}
