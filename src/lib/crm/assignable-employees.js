export const ASSIGNABLE_EMPLOYEE_ROLE_KEYS = Object.freeze([
  'admin',
  'senior_coordinator',
  'account_manager',
  'designer',
  'sales_manager',
]);

const NON_ASSIGNABLE_ACCOUNT_EMAILS = new Set([
  'alvarodenegri98@gmail.com',
]);

const NON_ASSIGNABLE_ACCOUNT_PATTERNS = [
  /(^|[\s._+-])(test|demo|sample|qa|sentry|meeting|automation|bot|robot)([\s._+-]|@|$)/i,
  /^(test|demo|sample|qa|sentry|meeting|automation|bot|robot)([\s._+-]|@|$)/i,
  /@(example|test|demo)\./i,
  /no-?reply/i,
];

function clean(value) {
  return String(value || '').trim();
}

export function looksLikeNonEmployeeAccount(user = {}) {
  const email = clean(user.email).toLowerCase();
  if (NON_ASSIGNABLE_ACCOUNT_EMAILS.has(email)) return true;

  const identity = [email, user.name].map(clean).filter(Boolean).join(' ');
  if (!identity) return false;
  return NON_ASSIGNABLE_ACCOUNT_PATTERNS.some((pattern) => pattern.test(identity));
}

export function isAssignableEmployee(user = {}) {
  if (!user?.id) return false;
  if (user.isActive === false) return false;
  if (looksLikeNonEmployeeAccount(user)) return false;

  const roleKeys = Array.isArray(user.roleKeys) ? user.roleKeys.filter(Boolean) : [];
  if (!roleKeys.length) return true;
  return roleKeys.some((roleKey) => ASSIGNABLE_EMPLOYEE_ROLE_KEYS.includes(roleKey));
}

export function filterAssignableEmployees(users = []) {
  return users.filter(isAssignableEmployee);
}
