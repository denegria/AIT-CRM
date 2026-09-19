import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_MODES,
  getAuthMode,
  getWorkOSAuthConfig,
  isWorkOSAuthMode,
} from './workos-runtime.js';

test('legacy remains the safe default and unknown modes fail closed', () => {
  assert.equal(getAuthMode({}), AUTH_MODES.LEGACY);
  assert.equal(isWorkOSAuthMode({ AIT_CRM_AUTH_MODE: 'workos' }), true);
  assert.throws(() => getAuthMode({ AIT_CRM_AUTH_MODE: 'hybrid' }), /ait_crm_auth_mode_invalid/u);
});

test('WorkOS config requires an isolated CRM organization and strong cookie password', () => {
  assert.throws(() => getWorkOSAuthConfig({}), /workos_auth_configuration_invalid/u);
  assert.deepEqual(getWorkOSAuthConfig({
    AIT_CRM_WORKOS_API_KEY: 'sk_test_example',
    AIT_CRM_WORKOS_CLIENT_ID: 'client_example',
    AIT_CRM_WORKOS_ORGANIZATION_ID: 'org_example',
    AIT_CRM_WORKOS_COOKIE_PASSWORD: '0123456789abcdef0123456789abcdef',
  }), {
    apiKey: 'sk_test_example',
    clientId: 'client_example',
    organizationId: 'org_example',
    cookiePassword: '0123456789abcdef0123456789abcdef',
  });
});
