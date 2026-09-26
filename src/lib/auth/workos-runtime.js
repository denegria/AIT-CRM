export const AUTH_MODE_ENV = 'AIT_CRM_AUTH_MODE';
export const WORKOS_API_KEY_ENV = 'AIT_CRM_WORKOS_API_KEY';
export const WORKOS_CLIENT_ID_ENV = 'AIT_CRM_WORKOS_CLIENT_ID';
export const WORKOS_ORGANIZATION_ID_ENV = 'AIT_CRM_WORKOS_ORGANIZATION_ID';
export const WORKOS_COOKIE_PASSWORD_ENV = 'AIT_CRM_WORKOS_COOKIE_PASSWORD';

export const AUTH_MODES = {
  LEGACY: 'legacy',
  WORKOS: 'workos',
};

export function getAuthMode(env = process.env) {
  const value = String(env[AUTH_MODE_ENV] || AUTH_MODES.LEGACY).trim().toLowerCase();
  if (!Object.values(AUTH_MODES).includes(value)) {
    throw new Error('ait_crm_auth_mode_invalid');
  }
  return value;
}

export function isWorkOSAuthMode(env = process.env) {
  return getAuthMode(env) === AUTH_MODES.WORKOS;
}

export function getWorkOSAuthConfig(env = process.env) {
  const config = {
    apiKey: String(env[WORKOS_API_KEY_ENV] || '').trim(),
    clientId: String(env[WORKOS_CLIENT_ID_ENV] || '').trim(),
    organizationId: String(env[WORKOS_ORGANIZATION_ID_ENV] || '').trim(),
    cookiePassword: String(env[WORKOS_COOKIE_PASSWORD_ENV] || ''),
  };
  if (!config.apiKey || !config.clientId || !config.organizationId || config.cookiePassword.length < 32) {
    throw new Error('workos_auth_configuration_invalid');
  }
  return config;
}
