export const MANAGED_ROLE_KEYS = Object.freeze(['admin', 'senior_coordinator', 'designer', 'account_manager', 'sales_manager']);

export const ROLE_LABELS = Object.freeze({
  admin: 'Administrator',
  senior_coordinator: 'Senior Coordinator',
  designer: 'Designer',
  account_manager: 'Account Coordinator',
  sales_manager: 'Sales Manager',
});

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeName(value) {
  return String(value || '').trim();
}

export function normalizeManagedRoleKey(value, managedRoleKeys = MANAGED_ROLE_KEYS) {
  const roleKey = String(value || '').trim();
  return managedRoleKeys.includes(roleKey) ? roleKey : '';
}

export function normalizeBusinessUnitIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function requiresBusinessUnitMembership(roleKey) {
  return roleKey !== 'admin';
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
  if (!managedRoleKeys.includes(roleKey)) {
    return {
      ok: false,
      error: `Role must be one of: ${managedRoleKeys.join(', ')}.`,
      status: 400,
    };
  }
  if (requiresBusinessUnitMembership(roleKey) && !businessUnitIds.length) {
    return { ok: false, error: 'At least one active division is required for non-admin users.', status: 400 };
  }
  return { ok: true, error: '', status: 200 };
}

export function toRoleOption(roleKey) {
  return {
    key: roleKey,
    label: ROLE_LABELS[roleKey] || roleKey.replace(/_/g, ' '),
  };
}
