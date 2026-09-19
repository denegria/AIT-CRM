import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { CRMIdentityProviderError, createWorkOSAuthProvider } from './workos-provider.js';

function providerWith(userManagement) {
  return createWorkOSAuthProvider({
    apiKey: 'sk_test_example',
    clientId: 'client_example',
    organizationId: 'org_crm',
    cookiePassword: '0123456789abcdef0123456789abcdef',
    workosClient: { userManagement },
  });
}

test('password authentication requests a sealed session and returns verified identity', async () => {
  let payload;
  const provider = providerWith({
    async authenticateWithPassword(value) {
      payload = value;
      return {
        user: { id: 'user_workos', email: 'Employee@Gmail.com', emailVerified: true },
        sealedSession: 'sealed-session',
      };
    },
  });

  const result = await provider.authenticatePassword({ email: ' Employee@Gmail.com ', password: 'secret' });
  assert.equal(payload.email, 'employee@gmail.com');
  assert.equal(payload.session.sealSession, true);
  assert.equal(result.sessionData, 'sealed-session');
  assert.deepEqual(result.identity, {
    providerUserId: 'user_workos',
    email: 'employee@gmail.com',
    emailVerified: true,
    sessionId: null,
    organizationId: null,
  });
});

test('rejects unverified provider identities', async () => {
  const provider = providerWith({
    async authenticateWithPassword() {
      return {
        user: { id: 'user_workos', email: 'employee@gmail.com', emailVerified: false },
        sealedSession: 'sealed-session',
      };
    },
  });
  await assert.rejects(
    () => provider.authenticatePassword({ email: 'employee@gmail.com', password: 'secret' }),
    (error) => error instanceof CRMIdentityProviderError && error.code === 'verified_identity_required',
  );
});

test('imports the exact CRM PBKDF2 hash using the documented WorkOS discriminator', async () => {
  let payload;
  const provider = providerWith({
    async createUser(value) {
      payload = value;
      return { id: 'user_workos', email: value.email };
    },
  });
  const salt = '93fd534f5c59e3ee4c164bef381818e3';
  const passwordHash = pbkdf2Sync('existing-password', salt, 310000, 64, 'sha512').toString('base64');

  await provider.createUserWithImportedPassword({
    userId: 'crm-user-id',
    name: 'Employee',
    email: 'employee@outlook.com',
    credential: { passwordHash, passwordSalt: salt, passwordIterations: 310000 },
  });

  assert.equal(payload.passwordHashType, 'pbkdf2');
  assert.match(payload.passwordHash, /^\$pbkdf2\$i=310000,d=sha512\$/u);
  assert.equal(payload.externalId, 'crm-user-id');
  assert.equal(payload.emailVerified, true);
});

test('organization invitations are scoped and exact-email normalized', async () => {
  let payload;
  const provider = providerWith({
    async sendInvitation(value) {
      payload = value;
      return { id: 'invitation_1', ...value };
    },
  });
  await provider.sendInvitation({ email: ' Person@Gmail.com ' });
  assert.equal(payload.email, 'person@gmail.com');
  assert.equal(payload.organizationId, 'org_crm');
  assert.equal(payload.expiresInDays, 7);
});

test('password authentication selects the CRM organization for multi-organization users', async () => {
  let selected;
  const organizationError = Object.assign(new Error('choose organization'), {
    code: 'organization_selection_required',
    pendingAuthenticationToken: 'pending_1',
    rawData: { organizations: [{ id: 'org_crm', name: 'AIT CRM' }, { id: 'org_portal', name: 'Portal' }] },
  });
  const provider = providerWith({
    async authenticateWithPassword() { throw organizationError; },
    async authenticateWithOrganizationSelection(payload) {
      selected = payload;
      return {
        organizationId: 'org_crm',
        user: { id: 'user_workos', email: 'employee@gmail.com', emailVerified: true },
        sealedSession: 'sealed-session',
      };
    },
  });
  await provider.authenticatePassword({ email: 'employee@gmail.com', password: 'secret' });
  assert.equal(selected.organizationId, 'org_crm');
  assert.equal(selected.pendingAuthenticationToken, 'pending_1');
});

test('refreshes only expired JWTs and surfaces retryable refresh failures as provider outages', async () => {
  const provider = providerWith({
    loadSealedSession() {
      return {
        async authenticate() { return { authenticated: false, reason: 'invalid_jwt' }; },
        async refresh() { return { authenticated: false, retryable: true, reason: 'timeout' }; },
      };
    },
  });
  await assert.rejects(
    () => provider.maintainSession('sealed'),
    (error) => error instanceof CRMIdentityProviderError && error.code === 'identity_provider_unavailable',
  );
});

test('does not refresh an expired sealed session when cookie rotation is unavailable', async () => {
  let refreshCalls = 0;
  const provider = providerWith({
    loadSealedSession() {
      return {
        async authenticate() { return { authenticated: false, reason: 'invalid_jwt' }; },
        async refresh() {
          refreshCalls += 1;
          return {};
        },
      };
    },
  });

  await assert.rejects(
    () => provider.maintainSession('sealed-session', { allowRefresh: false }),
    (error) => error instanceof CRMIdentityProviderError
      && error.code === 'provider_session_refresh_required'
      && error.status === 401,
  );
  assert.equal(refreshCalls, 0);
});
