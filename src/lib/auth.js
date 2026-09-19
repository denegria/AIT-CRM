import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { MANAGED_ROLE_KEYS, ROLE_KEYS, canonicalRoleKeys } from '@/lib/roles.js';
import {
  businessUnits,
  businessUnitMemberships,
  permissions,
  rolePermissions,
  roles,
  userPasswordCredentials,
  userRoles,
  users,
  userSessions,
} from '@/db/schema.js';
import { applyBusinessUnitAccessPolicy } from '@/lib/auth/business-unit-policy.js';
import {
  acceptEmployeeInvitation,
  createEmployeeInvitation,
  recordEmployeePasswordResetRequest,
  reconcileAcceptedEmployeeInvitation,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
} from '@/lib/auth/employee-auth-service.js';
import {
  CRMIdentityProviderError,
  createWorkOSAuthProvider,
} from '@/lib/auth/workos-provider.js';
import {
  getWorkOSAuthConfig,
  isWorkOSAuthMode,
} from '@/lib/auth/workos-runtime.js';

export const AUTH_COOKIE_NAME = 'ait_crm_session';
export const SESSION_SECRET_ENV = 'AIT_CRM_SESSION_SECRET';
export const AUTH_BOOTSTRAP_EMAIL_ENV = 'AIT_CRM_BOOTSTRAP_ADMIN_EMAIL';
export const AUTH_BOOTSTRAP_PASSWORD_ENV = 'AIT_CRM_BOOTSTRAP_ADMIN_PASSWORD';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
export const PASSWORD_ITERATIONS = 310000;

export const PERMISSIONS = {
  CRM_READ: 'crm:read',
  CRM_WRITE: 'crm:write',
  IMPORT_REVIEW_READ: 'import_review:read',
  IMPORT_REVIEW_WRITE: 'import_review:write',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  REPORTS_READ: 'reports:read',
  FINANCIALS_READ: 'financials:read',
  FINANCIALS_WRITE: 'financials:write',
  WORK_ORDERS_WRITE: 'work_orders:write',
  BUSINESS_UNITS_ALL: 'business_units:all',
};

export const DEFAULT_ROLE_PERMISSIONS = {
  [ROLE_KEYS.ADMIN]: Object.values(PERMISSIONS),
  [ROLE_KEYS.DESIGNER]: [
    PERMISSIONS.CRM_READ,
    PERMISSIONS.WORK_ORDERS_WRITE,
  ],
  [ROLE_KEYS.ACCOUNT_COORDINATOR]: [
    PERMISSIONS.CRM_READ,
    PERMISSIONS.CRM_WRITE,
    PERMISSIONS.FINANCIALS_READ,
    PERMISSIONS.FINANCIALS_WRITE,
    PERMISSIONS.WORK_ORDERS_WRITE,
  ],
  [ROLE_KEYS.SENIOR_COORDINATOR]: [
    PERMISSIONS.CRM_READ,
    PERMISSIONS.CRM_WRITE,
    PERMISSIONS.FINANCIALS_READ,
    PERMISSIONS.FINANCIALS_WRITE,
    PERMISSIONS.WORK_ORDERS_WRITE,
  ],
  [ROLE_KEYS.SALES_MANAGER]: [
    PERMISSIONS.CRM_READ,
    PERMISSIONS.CRM_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.FINANCIALS_READ,
  ],
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

const WORKOS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
let workosProviderInstance = null;

function getWorkOSProvider() {
  if (!workosProviderInstance) {
    workosProviderInstance = createWorkOSAuthProvider(getWorkOSAuthConfig());
  }
  return workosProviderInstance;
}

function getSessionSecret() {
  return process.env[SESSION_SECRET_ENV] || '';
}

export function isAuthEnabled() {
  if (!process.env.DATABASE_URL) return false;
  try {
    if (isWorkOSAuthMode()) {
      getWorkOSAuthConfig();
      return true;
    }
    return Boolean(getSessionSecret());
  } catch {
    return false;
  }
}

function signToken(token) {
  return createHash('sha256').update(`${getSessionSecret()}:${token}`).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password, salt = randomBytes(16).toString('hex'), iterations = PASSWORD_ITERATIONS) {
  const hash = pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('base64');
  return { hash, salt, iterations };
}

export function verifyPassword(password, credential) {
  if (!credential?.passwordHash || !credential?.passwordSalt) return false;
  const { hash } = hashPassword(password, credential.passwordSalt, credential.passwordIterations || PASSWORD_ITERATIONS);
  return safeEqual(hash, credential.passwordHash);
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function setAuthCookie(response, token, expiresAt) {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    sameSite: 'strict',
    expires: expiresAt,
    maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });
}

export function setWorkOSAuthCookie(response, sessionData) {
  response.cookies.set(AUTH_COOKIE_NAME, sessionData, {
    ...COOKIE_OPTIONS,
    sameSite: 'lax',
    maxAge: WORKOS_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearAuthCookie(response) {
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    ...COOKIE_OPTIONS,
    sameSite: 'lax',
    maxAge: 0,
  });
}

function getRequestCookieToken(request) {
  return request?.cookies?.get(AUTH_COOKIE_NAME)?.value || '';
}

async function getServerCookieToken() {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value || '';
}

async function loadLegacySessionRow(db, token) {
  const [sessionRow] = await db
    .select({
      sessionId: userSessions.id,
      userId: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      expiresAt: userSessions.expiresAt,
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(and(
      eq(userSessions.tokenHash, signToken(token)),
      isNull(userSessions.revokedAt),
      gt(userSessions.expiresAt, new Date()),
      eq(users.isActive, true),
    ))
    .limit(1);

  return sessionRow || null;
}

async function loadWorkOSSessionRow(db, identity) {
  const [sessionRow] = await db
    .select({
      sessionId: users.workosUserId,
      userId: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(
      eq(users.workosUserId, identity.providerUserId),
      eq(users.isActive, true),
    ))
    .limit(1);

  if (!sessionRow || String(sessionRow.email || '').trim().toLowerCase() !== identity.email) return null;
  return { ...sessionRow, sessionId: identity.sessionId || identity.providerUserId };
}

async function loadAuthorizationContext(db, sessionRow) {
  if (!sessionRow) return null;

  const [roleRows, permissionRows, membershipRows, allBusinessUnitRows] = await Promise.all([
    db
      .select({ key: roles.key, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, sessionRow.userId)),
    db
      .select({ key: permissions.key })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, sessionRow.userId)),
    db
      .select({
        businessUnitId: businessUnitMemberships.businessUnitId,
        businessUnitName: businessUnits.name,
        isPrimary: businessUnitMemberships.isPrimary,
      })
      .from(businessUnitMemberships)
      .innerJoin(businessUnits, eq(businessUnitMemberships.businessUnitId, businessUnits.id))
      .where(eq(businessUnitMemberships.userId, sessionRow.userId))
      .orderBy(desc(businessUnitMemberships.isPrimary), businessUnitMemberships.createdAt),
    db
      .select({
        id: businessUnits.id,
        name: businessUnits.name,
        isActive: businessUnits.isActive,
      })
      .from(businessUnits)
      .where(eq(businessUnits.organizationId, sessionRow.organizationId)),
  ]);

  const roleKeys = canonicalRoleKeys(roleRows.map((role) => role.key)).sort((left, right) => {
    const leftIndex = MANAGED_ROLE_KEYS.indexOf(left);
    const rightIndex = MANAGED_ROLE_KEYS.indexOf(right);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
      || left.localeCompare(right);
  });
  const permissionKeys = [...new Set(permissionRows.map((permission) => permission.key))];
  const businessUnitAccess = applyBusinessUnitAccessPolicy({
    roleKeys,
    permissionKeys,
    allBusinessUnits: allBusinessUnitRows,
    membershipRows,
    businessUnitsAllPermission: PERMISSIONS.BUSINESS_UNITS_ALL,
  });
  const allowedMembershipRows = businessUnitAccess.membershipRows;
  const membershipPayload = allowedMembershipRows.map((row) => ({
    id: row.businessUnitId,
    name: row.businessUnitName || '',
    isPrimary: Boolean(row.isPrimary),
  }));

  return {
    sessionId: sessionRow.sessionId,
    user: {
      id: sessionRow.userId,
      organizationId: sessionRow.organizationId,
      name: sessionRow.name,
      email: sessionRow.email,
      roleKeys,
      primaryRoleKey: roleKeys.includes(ROLE_KEYS.ADMIN) ? ROLE_KEYS.ADMIN : roleKeys[0] || ROLE_KEYS.ACCOUNT_COORDINATOR,
      permissions: permissionKeys,
      businessUnitIds: businessUnitAccess.businessUnitIds,
      businessUnitMemberships: membershipPayload,
      businessUnitNamesById: Object.fromEntries(membershipPayload.map((row) => [row.id, row.name])),
      primaryBusinessUnitId: allowedMembershipRows.find((row) => row.isPrimary)?.businessUnitId || allowedMembershipRows[0]?.businessUnitId || null,
      canAccessAllBusinessUnits: businessUnitAccess.canAccessAllBusinessUnits,
      restrictedBusinessUnitIds: businessUnitAccess.restrictedBusinessUnitIds,
    },
  };
}

async function loadSession(token, { allowRefresh = true } = {}) {
  if (!isAuthEnabled() || !token) return { session: null, refreshedSessionData: null };

  const db = getDb();
  if (!isWorkOSAuthMode()) {
    const sessionRow = await loadLegacySessionRow(db, token);
    return {
      session: await loadAuthorizationContext(db, sessionRow),
      refreshedSessionData: null,
    };
  }

  try {
    const maintained = await getWorkOSProvider().maintainSession(token, { allowRefresh });
    const sessionRow = await loadWorkOSSessionRow(db, maintained.identity);
    return {
      session: await loadAuthorizationContext(db, sessionRow),
      refreshedSessionData: maintained.refreshed ? maintained.sessionData : null,
    };
  } catch {
    return { session: null, refreshedSessionData: null };
  }
}

export async function getCurrentSession() {
  // Server Components cannot persist a rotated sealed cookie. Leave refresh to
  // a Route Handler so the refreshed WorkOS session is never discarded.
  return (await loadSession(await getServerCookieToken(), { allowRefresh: false })).session;
}

export async function getRequestSession(request) {
  const state = await loadSession(getRequestCookieToken(request));
  if (state.session && state.refreshedSessionData) {
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, state.refreshedSessionData, {
      ...COOKIE_OPTIONS,
      sameSite: 'lax',
      maxAge: WORKOS_SESSION_MAX_AGE_SECONDS,
    });
  }
  return state.session;
}

export async function getRequestSessionState(request) {
  return loadSession(getRequestCookieToken(request));
}

export function hasPermission(session, permission) {
  return Boolean(session?.user?.permissions?.includes(permission));
}

export async function requirePermission(request, permission) {
  const session = await getRequestSession(request);
  if (!session) {
    return {
      error: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }),
      session: null,
    };
  }
  if (!hasPermission(session, permission)) {
    return {
      error: NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 }),
      session,
    };
  }
  return { error: null, session };
}

export async function createUserSession(userId) {
  const db = getDb();
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(userSessions).values({
    userId,
    tokenHash: signToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

async function linkWorkOSIdentity(identity) {
  if (!identity?.providerUserId || !identity.email || identity.emailVerified !== true) {
    throw new CRMIdentityProviderError('verified_identity_required', 403);
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const [providerUser] = await tx
      .select({
        id: users.id,
        organizationId: users.organizationId,
        email: users.email,
        workosUserId: users.workosUserId,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.workosUserId, identity.providerUserId))
      .limit(1);
    const [emailUser] = await tx
      .select({
        id: users.id,
        organizationId: users.organizationId,
        email: users.email,
        workosUserId: users.workosUserId,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);

    if (providerUser && emailUser && providerUser.id !== emailUser.id) {
      throw new CRMIdentityProviderError('provider_identity_conflict', 409);
    }

    const localUser = providerUser;
    if (!localUser && emailUser) {
      throw new CRMIdentityProviderError('crm_identity_not_migrated', 403);
    }
    if (!localUser || !localUser.isActive) {
      throw new CRMIdentityProviderError('crm_access_denied', 403);
    }
    if (String(localUser.email || '').trim().toLowerCase() !== identity.email) {
      throw new CRMIdentityProviderError('provider_email_mismatch', 403);
    }
    if (localUser.workosUserId && localUser.workosUserId !== identity.providerUserId) {
      throw new CRMIdentityProviderError('provider_identity_conflict', 409);
    }

    return localUser;
  });
}

async function reconcileWorkOSInvitation(identity) {
  return reconcileAcceptedEmployeeInvitation({
    db: getDb(),
    provider: getWorkOSProvider(),
    identity,
    expectedProviderOrganizationId: getWorkOSAuthConfig().organizationId,
  });
}

export function usesWorkOSAuth() {
  return isWorkOSAuthMode();
}

export async function authenticateWorkOSPassword({ email, password, ipAddress, userAgent }) {
  const result = await getWorkOSProvider().authenticatePassword({ email, password, ipAddress, userAgent });
  await reconcileWorkOSInvitation(result.identity);
  const localUser = await linkWorkOSIdentity(result.identity);
  return { ...result, localUser };
}

export async function reauthenticateWorkOSPassword({ session, password, ipAddress, userAgent }) {
  const result = await getWorkOSProvider().authenticatePassword({
    email: session?.user?.email,
    password,
    ipAddress,
    userAgent,
  });
  const localUser = await linkWorkOSIdentity(result.identity);
  if (localUser.id !== session?.user?.id) {
    throw new CRMIdentityProviderError('provider_identity_mismatch', 403);
  }
  return result;
}

export function getWorkOSAuthorizationUrl(options) {
  return getWorkOSProvider().authorizationUrl(options);
}

export async function authenticateWorkOSCode(options) {
  const result = await getWorkOSProvider().authenticateCode(options);
  await reconcileWorkOSInvitation(result.identity);
  const localUser = await linkWorkOSIdentity(result.identity);
  return { ...result, localUser };
}

export async function authenticateWorkOSInvitationCode({ invitationToken, ...options }) {
  const provider = getWorkOSProvider();
  const providerInvitation = await provider.findInvitationByToken(invitationToken);
  const result = await provider.authenticateCode({ ...options, invitationToken });
  await acceptEmployeeInvitation({
    db: getDb(),
    providerInvitation: await provider.getInvitation(providerInvitation.id),
    identity: result.identity,
    expectedProviderOrganizationId: getWorkOSAuthConfig().organizationId,
  });
  return result;
}

export async function createWorkOSEmployeeInvitation(options) {
  return createEmployeeInvitation({
    ...options,
    db: getDb(),
    provider: getWorkOSProvider(),
  });
}

export async function resendWorkOSEmployeeInvitation(options) {
  return resendEmployeeInvitation({
    ...options,
    db: getDb(),
    provider: getWorkOSProvider(),
  });
}

export async function revokeWorkOSEmployeeInvitation(options) {
  return revokeEmployeeInvitation({
    ...options,
    db: getDb(),
    provider: getWorkOSProvider(),
  });
}

export async function sendWorkOSPasswordReset(email) {
  return getWorkOSProvider().sendPasswordReset(email);
}

export async function sendAdminWorkOSPasswordReset({
  email,
  organizationId,
  actorUserId,
  subjectUserId,
}) {
  await getWorkOSProvider().sendPasswordReset(email);
  await recordEmployeePasswordResetRequest({
    db: getDb(),
    organizationId,
    actorUserId,
    subjectUserId,
  });
  return { accepted: true };
}

export async function revokeAllWorkOSUserSessions(providerUserId) {
  return getWorkOSProvider().revokeAllUserSessions(providerUserId);
}

export async function revokeRequestSession(request) {
  const token = getRequestCookieToken(request);
  if (!isAuthEnabled() || !token) return;
  if (isWorkOSAuthMode()) {
    const maintained = await getWorkOSProvider().maintainSession(token);
    await getWorkOSProvider().revokeSession(maintained.identity.sessionId);
    return;
  }
  await getDb()
    .update(userSessions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(userSessions.tokenHash, signToken(token)));
}

export async function findCredentialByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const [row] = await getDb()
    .select({
      credential: userPasswordCredentials,
      user: users,
    })
    .from(userPasswordCredentials)
    .innerJoin(users, eq(userPasswordCredentials.userId, users.id))
    .where(eq(userPasswordCredentials.email, normalizedEmail))
    .limit(1);
  return row || null;
}
