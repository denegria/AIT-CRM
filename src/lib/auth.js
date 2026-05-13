import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import {
  businessUnitMemberships,
  permissions,
  rolePermissions,
  roles,
  userPasswordCredentials,
  userRoles,
  users,
  userSessions,
} from '@/db/schema.js';

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
  admin: Object.values(PERMISSIONS),
  designer: [
    PERMISSIONS.CRM_READ,
    PERMISSIONS.WORK_ORDERS_WRITE,
  ],
  account_manager: [
    PERMISSIONS.CRM_READ,
    PERMISSIONS.CRM_WRITE,
    PERMISSIONS.FINANCIALS_READ,
    PERMISSIONS.IMPORT_REVIEW_READ,
  ],
  sales_manager: [
    PERMISSIONS.CRM_READ,
    PERMISSIONS.CRM_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.FINANCIALS_READ,
  ],
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

function getSessionSecret() {
  return process.env[SESSION_SECRET_ENV] || '';
}

export function isAuthEnabled() {
  return Boolean(process.env.DATABASE_URL && getSessionSecret());
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
    expires: expiresAt,
    maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });
}

export function clearAuthCookie(response) {
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    ...COOKIE_OPTIONS,
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

async function loadSession(token) {
  if (!isAuthEnabled() || !token) return null;

  const db = getDb();
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

  if (!sessionRow) return null;

  const [roleRows, permissionRows, membershipRows] = await Promise.all([
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
      .select({ businessUnitId: businessUnitMemberships.businessUnitId })
      .from(businessUnitMemberships)
      .where(eq(businessUnitMemberships.userId, sessionRow.userId)),
  ]);

  const roleKeys = [...new Set(roleRows.map((role) => role.key))];
  const permissionKeys = [...new Set(permissionRows.map((permission) => permission.key))];

  return {
    sessionId: sessionRow.sessionId,
    user: {
      id: sessionRow.userId,
      organizationId: sessionRow.organizationId,
      name: sessionRow.name,
      email: sessionRow.email,
      roleKeys,
      primaryRoleKey: roleKeys.includes('admin') ? 'admin' : roleKeys[0] || 'account_manager',
      permissions: permissionKeys,
      businessUnitIds: membershipRows.map((row) => row.businessUnitId),
      canAccessAllBusinessUnits: permissionKeys.includes(PERMISSIONS.BUSINESS_UNITS_ALL),
    },
  };
}

export async function getCurrentSession() {
  return loadSession(await getServerCookieToken());
}

export async function getRequestSession(request) {
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

export async function revokeRequestSession(request) {
  const token = getRequestCookieToken(request);
  if (!isAuthEnabled() || !token) return;
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
