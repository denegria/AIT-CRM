import { WorkOS } from '@workos-inc/node';
import {
  WORKOS_PBKDF2_PASSWORD_HASH_TYPE,
  credentialToWorkOSPbkdf2Hash,
} from './workos-password-migration.js';

export class CRMIdentityProviderError extends Error {
  constructor(code, status = 500, details = {}) {
    super(code);
    this.name = 'CRMIdentityProviderError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function providerUnavailable(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (status === 408 || status === 429 || status >= 500) return true;
  const code = String(error?.code || '').toUpperCase();
  return [
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'ERR_JWKS_TIMEOUT',
  ].includes(code);
}

function mapProviderError(error, fallbackCode, fallbackStatus = 502) {
  if (error instanceof CRMIdentityProviderError) return error;
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (status === 429) return new CRMIdentityProviderError('identity_provider_rate_limited', 429);
  if (providerUnavailable(error)) return new CRMIdentityProviderError('identity_provider_unavailable', 503);
  if (status === 401 || status === 403) return new CRMIdentityProviderError(fallbackCode, 401);
  if (status === 404) return new CRMIdentityProviderError(fallbackCode, 404);
  if (status === 409 || status === 422) return new CRMIdentityProviderError(fallbackCode, status);
  return new CRMIdentityProviderError(fallbackCode, fallbackStatus);
}

function requireVerifiedIdentity(response) {
  const user = response?.user;
  if (!user?.id || !user.email || user.emailVerified !== true) {
    throw new CRMIdentityProviderError('verified_identity_required', 403);
  }
  return {
    providerUserId: user.id,
    email: normalizedEmail(user.email),
    emailVerified: true,
    sessionId: response.sessionId || null,
    organizationId: response.organizationId || null,
  };
}

function requireSealedSession(response) {
  if (typeof response?.sealedSession !== 'string' || !response.sealedSession) {
    throw new CRMIdentityProviderError('sealed_session_missing', 502);
  }
  return response.sealedSession;
}

export function createWorkOSAuthProvider({
  apiKey,
  clientId,
  organizationId,
  cookiePassword,
  workosClient,
}) {
  if (!apiKey || !clientId || !organizationId || !cookiePassword || cookiePassword.length < 32) {
    throw new Error('workos_auth_configuration_invalid');
  }
  const workos = workosClient || new WorkOS(apiKey, { clientId });
  const userManagement = workos.userManagement;

  function assertExpectedOrganization(identity) {
    if (identity.organizationId && identity.organizationId !== organizationId) {
      throw new CRMIdentityProviderError('provider_organization_mismatch', 403);
    }
    return identity;
  }

  return {
    authorizationUrl({ redirectUri, state, invitationToken, loginHint, screenHint = 'sign-in' }) {
      if (!redirectUri || !state) throw new Error('workos_authorization_request_invalid');
      return userManagement.getAuthorizationUrl({
        clientId,
        organizationId,
        provider: 'authkit',
        redirectUri,
        state,
        screenHint,
        ...(invitationToken ? { invitationToken } : {}),
        ...(loginHint ? { loginHint: normalizedEmail(loginHint) } : {}),
      });
    },

    async authenticateCode({ code, invitationToken, ipAddress, userAgent }) {
      try {
        const response = await userManagement.authenticateWithCode({
          clientId,
          code,
          ...(invitationToken ? { invitationToken } : {}),
          ...(ipAddress ? { ipAddress } : {}),
          ...(userAgent ? { userAgent } : {}),
          session: { sealSession: true, cookiePassword },
        });
        return {
          identity: assertExpectedOrganization(requireVerifiedIdentity(response)),
          sessionData: requireSealedSession(response),
        };
      } catch (error) {
        throw mapProviderError(error, 'authorization_code_invalid', 401);
      }
    },

    async authenticatePassword({ email, password, ipAddress, userAgent }) {
      try {
        let response;
        try {
          response = await userManagement.authenticateWithPassword({
            clientId,
            email: normalizedEmail(email),
            password,
            ...(ipAddress ? { ipAddress } : {}),
            ...(userAgent ? { userAgent } : {}),
            session: { sealSession: true, cookiePassword },
          });
        } catch (error) {
          const organizations = Array.isArray(error?.rawData?.organizations) ? error.rawData.organizations : [];
          const organizationIsAvailable = organizations.some((organization) => organization.id === organizationId);
          if (error?.code !== 'organization_selection_required'
            || !error?.pendingAuthenticationToken
            || !organizationIsAvailable) {
            throw error;
          }
          response = await userManagement.authenticateWithOrganizationSelection({
            clientId,
            organizationId,
            pendingAuthenticationToken: error.pendingAuthenticationToken,
            ...(ipAddress ? { ipAddress } : {}),
            ...(userAgent ? { userAgent } : {}),
            session: { sealSession: true, cookiePassword },
          });
        }
        return {
          identity: assertExpectedOrganization(requireVerifiedIdentity(response)),
          sessionData: requireSealedSession(response),
        };
      } catch (error) {
        throw mapProviderError(error, 'password_auth_invalid', 401);
      }
    },

    async maintainSession(sessionData, { allowRefresh = true } = {}) {
      if (typeof sessionData !== 'string' || !sessionData) {
        throw new CRMIdentityProviderError('provider_session_invalid', 401);
      }
      try {
        const session = userManagement.loadSealedSession({ sessionData, cookiePassword });
        const authenticated = await session.authenticate();
        if (authenticated.authenticated === true) {
          return {
            identity: assertExpectedOrganization(requireVerifiedIdentity(authenticated)),
            sessionData,
            refreshed: false,
          };
        }
        if (authenticated.reason !== 'invalid_jwt') {
          throw new CRMIdentityProviderError('provider_session_invalid', 401, {
            reason: authenticated.reason || 'authentication_failed',
          });
        }
        if (!allowRefresh) {
          throw new CRMIdentityProviderError('provider_session_refresh_required', 401);
        }

        const refreshed = await session.refresh({ cookiePassword, organizationId });
        if (refreshed.authenticated !== true) {
          if (refreshed.retryable === true) {
            throw new CRMIdentityProviderError('identity_provider_unavailable', 503, {
              reason: refreshed.reason || 'refresh_retryable',
            });
          }
          throw new CRMIdentityProviderError('provider_session_invalid', 401, {
            reason: refreshed.reason || 'refresh_failed',
          });
        }
        return {
          identity: assertExpectedOrganization(requireVerifiedIdentity(refreshed)),
          sessionData: requireSealedSession(refreshed),
          refreshed: true,
        };
      } catch (error) {
        throw mapProviderError(error, 'provider_session_invalid', 401);
      }
    },

    async findUserByEmail(email) {
      try {
        const result = await userManagement.listUsers({ email: normalizedEmail(email), limit: 10 });
        return result.data.find((user) => normalizedEmail(user.email) === normalizedEmail(email)) || null;
      } catch (error) {
        throw mapProviderError(error, 'provider_user_lookup_failed');
      }
    },

    async createUserWithImportedPassword({ userId, name, email, credential }) {
      try {
        return await userManagement.createUser({
          email: normalizedEmail(email),
          name,
          emailVerified: true,
          externalId: userId,
          metadata: { crm_user_id: userId },
          passwordHash: credentialToWorkOSPbkdf2Hash(credential),
          // WorkOS API supports pbkdf2 even though the current Node SDK type
          // declaration has not yet added it to its string union.
          passwordHashType: WORKOS_PBKDF2_PASSWORD_HASH_TYPE,
        });
      } catch (error) {
        throw mapProviderError(error, 'provider_user_import_failed', 422);
      }
    },

    async createOrganizationMembership(providerUserId) {
      try {
        return await userManagement.createOrganizationMembership({
          organizationId,
          userId: providerUserId,
        });
      } catch (error) {
        throw mapProviderError(error, 'provider_membership_failed', 422);
      }
    },

    async ensureOrganizationMembership(providerUserId) {
      try {
        const memberships = await userManagement.listOrganizationMemberships({
          userId: providerUserId,
          organizationId,
        });
        const active = memberships.data.find((membership) => membership.status === 'active');
        if (active) return active;
        return await userManagement.createOrganizationMembership({
          organizationId,
          userId: providerUserId,
        });
      } catch (error) {
        throw mapProviderError(error, 'provider_membership_failed', 422);
      }
    },

    async deleteUser(providerUserId) {
      if (!providerUserId) throw new CRMIdentityProviderError('provider_user_invalid', 400);
      try {
        await userManagement.deleteUser(providerUserId);
      } catch (error) {
        throw mapProviderError(error, 'provider_user_delete_failed');
      }
    },

    async sendInvitation({ email, expiresInDays = 7, inviterUserId, locale }) {
      try {
        return await userManagement.sendInvitation({
          email: normalizedEmail(email),
          organizationId,
          expiresInDays,
          ...(inviterUserId ? { inviterUserId } : {}),
          ...(locale ? { locale } : {}),
        });
      } catch (error) {
        throw mapProviderError(error, 'provider_invitation_failed', 422);
      }
    },

    async resendInvitation(invitationId, locale) {
      try {
        return await userManagement.resendInvitation(invitationId, locale ? { locale } : undefined);
      } catch (error) {
        throw mapProviderError(error, 'provider_invitation_resend_failed', 422);
      }
    },

    async revokeInvitation(invitationId) {
      try {
        return await userManagement.revokeInvitation(invitationId);
      } catch (error) {
        throw mapProviderError(error, 'provider_invitation_revoke_failed', 422);
      }
    },

    async getInvitation(invitationId) {
      try {
        return await userManagement.getInvitation(invitationId);
      } catch (error) {
        throw mapProviderError(error, 'provider_invitation_lookup_failed', 404);
      }
    },

    async findInvitationByToken(invitationToken) {
      if (!invitationToken) throw new CRMIdentityProviderError('provider_invitation_invalid', 400);
      try {
        return await userManagement.findInvitationByToken(invitationToken);
      } catch (error) {
        throw mapProviderError(error, 'provider_invitation_invalid', 403);
      }
    },

    async sendPasswordReset(email) {
      try {
        await userManagement.createPasswordReset({ email: normalizedEmail(email) });
        return { accepted: true };
      } catch (error) {
        throw mapProviderError(error, 'password_reset_delivery_failed', 503);
      }
    },

    async revokeSession(sessionId) {
      if (!sessionId) return;
      try {
        await userManagement.revokeSession({ sessionId });
      } catch (error) {
        throw mapProviderError(error, 'provider_session_revoke_failed');
      }
    },

    async revokeAllUserSessions(providerUserId) {
      try {
        const sessions = await userManagement.listSessions(providerUserId, { limit: 100 });
        await Promise.all(sessions.data.map((session) => userManagement.revokeSession({ sessionId: session.id })));
        return { revoked: sessions.data.length };
      } catch (error) {
        throw mapProviderError(error, 'provider_session_revoke_failed');
      }
    },
  };
}
