export const ADMIN_ROLE_KEY = 'admin';

export function userHasAdminRole(user = {}) {
  const roleKeys = Array.isArray(user?.roleKeys) ? user.roleKeys : [];
  return user?.primaryRoleKey === ADMIN_ROLE_KEY || roleKeys.includes(ADMIN_ROLE_KEY);
}

export function sessionHasAdminRole(session = {}) {
  return userHasAdminRole(session?.user);
}

export function adminOnlyError(message = 'Administrator access is required.') {
  const error = new Error(message);
  error.status = 403;
  return error;
}

export function assertAdminSession(session, message) {
  if (!sessionHasAdminRole(session)) {
    throw adminOnlyError(message);
  }
  return session;
}
