import { NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  businessUnitMemberships,
  businessUnits,
  roles,
  userRoles,
  users,
} from '@/db/schema.js';
import {
  MANAGED_ROLE_KEYS,
  MANAGED_ROLE_LOOKUP_KEYS,
  normalizeBusinessUnitIds,
  normalizeEmail,
  normalizeManagedRoleKey,
  normalizeName,
  requiresBusinessUnitMembership,
  toRoleOption,
  validateUserAccessDraft,
} from '@/lib/admin/user-policy.js';
import { canonicalRoleKey, canonicalRoleKeys, preferredRoleRowForKey } from '@/lib/roles.js';
import {
  deactivateUserAccount,
  provisionUserAccess,
  updateUserAccess,
} from '@/lib/admin/user-management.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { isUuid } from '@/lib/crm/validation.js';

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function errorResponse(error, fallback = 'User administration request failed.') {
  return NextResponse.json(
    { error: error.message || fallback },
    { status: error.status || 400 },
  );
}

function sortRoleKeys(roleKeys) {
  return canonicalRoleKeys(roleKeys).sort((left, right) => {
    const leftIndex = MANAGED_ROLE_KEYS.indexOf(left);
    const rightIndex = MANAGED_ROLE_KEYS.indexOf(right);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
      || left.localeCompare(right);
  });
}

function toUserPayload(user, roleKeys, memberships) {
  const sortedRoleKeys = sortRoleKeys(roleKeys);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    roleKeys: sortedRoleKeys,
    primaryRoleKey: sortedRoleKeys.includes('admin') ? 'admin' : sortedRoleKeys[0] || 'account_coordinator',
    businessUnitIds: memberships.map((membership) => membership.businessUnitId),
    memberships,
    createdAt: user.createdAt?.toISOString?.() || null,
    updatedAt: user.updatedAt?.toISOString?.() || null,
  };
}

async function readUsersForOrganization(db, organizationId) {
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.organizationId, organizationId))
    .orderBy(desc(users.isActive), asc(users.name), asc(users.email));

  if (!userRows.length) return [];
  const userIds = userRows.map((row) => row.id);

  const [roleRows, membershipRows] = await Promise.all([
    db
      .select({
        userId: userRoles.userId,
        roleKey: roles.key,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(
        inArray(userRoles.userId, userIds),
        eq(roles.organizationId, organizationId),
      )),
    db
      .select({
        userId: businessUnitMemberships.userId,
        businessUnitId: businessUnitMemberships.businessUnitId,
        isPrimary: businessUnitMemberships.isPrimary,
        businessUnitName: businessUnits.name,
        businessUnitIsActive: businessUnits.isActive,
      })
      .from(businessUnitMemberships)
      .innerJoin(businessUnits, eq(businessUnitMemberships.businessUnitId, businessUnits.id))
      .where(and(
        inArray(businessUnitMemberships.userId, userIds),
        eq(businessUnits.organizationId, organizationId),
      )),
  ]);

  const rolesByUser = new Map();
  for (const roleRow of roleRows) {
    if (!rolesByUser.has(roleRow.userId)) rolesByUser.set(roleRow.userId, new Set());
    rolesByUser.get(roleRow.userId).add(canonicalRoleKey(roleRow.roleKey));
  }

  const membershipsByUser = new Map();
  for (const membership of membershipRows) {
    if (!membershipsByUser.has(membership.userId)) membershipsByUser.set(membership.userId, []);
    membershipsByUser.get(membership.userId).push({
      businessUnitId: membership.businessUnitId,
      businessUnitName: membership.businessUnitName,
      businessUnitIsActive: Boolean(membership.businessUnitIsActive),
      isPrimary: Boolean(membership.isPrimary),
    });
  }

  return userRows.map((row) => {
    const roleKeys = [...(rolesByUser.get(row.id) || new Set())];
    const memberships = membershipsByUser.get(row.id) || [];
    return toUserPayload(row, roleKeys, memberships);
  });
}

async function readManagedRoleContext(tx, organizationId) {
  const roleRows = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(
      eq(roles.organizationId, organizationId),
      inArray(roles.key, MANAGED_ROLE_LOOKUP_KEYS),
    ));

  const roleByKey = new Map();
  for (const roleKey of MANAGED_ROLE_KEYS) {
    const roleRow = preferredRoleRowForKey(roleRows, roleKey);
    if (roleRow) roleByKey.set(roleKey, roleRow);
  }
  const missingRoles = MANAGED_ROLE_KEYS.filter((roleKey) => !roleByKey.has(roleKey));
  if (missingRoles.length) {
    throw httpError(`Managed roles are missing: ${missingRoles.join(', ')}. Run bootstrap role provisioning first.`, 500);
  }

  return {
    roleByKey,
    managedRoleIds: roleRows.map((role) => role.id),
  };
}

async function validateBusinessUnitMemberships(tx, organizationId, businessUnitIds) {
  if (!businessUnitIds.length) return;

  const validUnits = await tx
    .select({ id: businessUnits.id })
    .from(businessUnits)
    .where(and(
      eq(businessUnits.organizationId, organizationId),
      eq(businessUnits.isActive, true),
      inArray(businessUnits.id, businessUnitIds),
    ));

  if (validUnits.length !== businessUnitIds.length) {
    throw httpError('One or more divisions are inactive or invalid for this organization.', 400);
  }
}

async function readOrganizationUserById(tx, organizationId, id) {
  const [user] = await tx
    .select({
      id: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
    .limit(1);
  return user || null;
}

async function readExistingUserByEmail(tx, email) {
  const [user] = await tx
    .select({
      id: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user || null;
}

async function readUserRoleKeys(tx, userId) {
  const roleRows = await tx
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return canonicalRoleKeys(roleRows.map((role) => role.key));
}

async function countActiveAdmins(tx, organizationId) {
  const adminRows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(
      eq(users.organizationId, organizationId),
      eq(users.isActive, true),
      eq(roles.key, 'admin'),
    ));

  return new Set(adminRows.map((row) => row.id)).size;
}

async function readResponseUsers(db, organizationId, selectedUserId = null) {
  const records = await readUsersForOrganization(db, organizationId);
  return {
    users: records,
    user: selectedUserId ? records.find((record) => record.id === selectedUserId) || null : null,
    roleOptions: MANAGED_ROLE_KEYS.map(toRoleOption),
  };
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const db = getDb();
  return NextResponse.json(await readResponseUsers(db, session.user.organizationId));
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const name = normalizeName(body.name);
  const password = String(body.password || '');
  const roleKey = normalizeManagedRoleKey(body.roleKey);
  const businessUnitIds = roleKey === 'admin' ? [] : normalizeBusinessUnitIds(body.businessUnitIds);
  const validation = validateUserAccessDraft({
    email,
    name,
    password,
    roleKey,
    businessUnitIds,
    requirePassword: true,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  const db = getDb();

  try {
    let savedUserId = null;
    await db.transaction(async (tx) => {
      const { roleByKey, managedRoleIds } = await readManagedRoleContext(tx, session.user.organizationId);
      const roleRow = roleByKey.get(roleKey);

      if (requiresBusinessUnitMembership(roleKey)) {
        await validateBusinessUnitMemberships(tx, session.user.organizationId, businessUnitIds);
      }

      const existingUser = await readExistingUserByEmail(tx, email);
      if (existingUser && existingUser.organizationId !== session.user.organizationId) {
        throw httpError('A user with this email already belongs to another organization.', 409);
      }
      if (existingUser) {
        const existingRoleKeys = await readUserRoleKeys(tx, existingUser.id);
        if (existingUser.id === session.user.id && roleKey !== 'admin') {
          throw httpError('Admins cannot remove their own administrator access.', 400);
        }
        if (existingRoleKeys.includes('admin') && roleKey !== 'admin' && await countActiveAdmins(tx, session.user.organizationId) <= 1) {
          throw httpError('At least one active administrator is required.', 400);
        }
      }

      const result = await provisionUserAccess({
        tx,
        organizationId: session.user.organizationId,
        existingUser,
        name,
        email,
        password,
        roleId: roleRow.id,
        managedRoleIds,
        businessUnitIds,
        isActive: true,
      });
      savedUserId = result.userId;
    });

    const response = await readResponseUsers(db, session.user.organizationId, savedUserId);
    return NextResponse.json(response, { status: 201 });
  } catch (txError) {
    return errorResponse(txError, 'User provisioning failed.');
  }
}

export async function PATCH(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'A valid user id is required.' }, { status: 400 });
  }

  const db = getDb();

  try {
    let savedUserId = id;
    await db.transaction(async (tx) => {
      const existingUser = await readOrganizationUserById(tx, session.user.organizationId, id);
      if (!existingUser) throw httpError('User not found in this organization.', 404);

      const existingRoleKeys = await readUserRoleKeys(tx, id);
      const deactivationOnly = body.isActive === false
        && !Object.prototype.hasOwnProperty.call(body, 'roleKey')
        && !Object.prototype.hasOwnProperty.call(body, 'name')
        && !Object.prototype.hasOwnProperty.call(body, 'businessUnitIds');

      if (deactivationOnly) {
        if (id === session.user.id) throw httpError('Admins cannot deactivate their own account.', 400);
        if (existingRoleKeys.includes('admin') && await countActiveAdmins(tx, session.user.organizationId) <= 1) {
          throw httpError('At least one active administrator is required.', 400);
        }
        await deactivateUserAccount({ tx, userId: id });
        return;
      }

      const { roleByKey, managedRoleIds } = await readManagedRoleContext(tx, session.user.organizationId);
      const name = normalizeName(body.name);
      const roleKey = normalizeManagedRoleKey(body.roleKey);
      const isActive = Object.prototype.hasOwnProperty.call(body, 'isActive')
        ? Boolean(body.isActive)
        : existingUser.isActive;
      const businessUnitIds = roleKey === 'admin' ? [] : normalizeBusinessUnitIds(body.businessUnitIds);
      const validation = validateUserAccessDraft({
        name,
        password: String(body.password || ''),
        roleKey,
        businessUnitIds,
        requireEmail: false,
      });
      if (!validation.ok) throw httpError(validation.error, validation.status);

      const removesOwnAdminAccess = id === session.user.id && (roleKey !== 'admin' || !isActive);
      if (removesOwnAdminAccess) {
        throw httpError('Admins cannot remove their own administrator access.', 400);
      }

      const removesAdminAccess = existingRoleKeys.includes('admin') && (roleKey !== 'admin' || !isActive);
      if (removesAdminAccess && await countActiveAdmins(tx, session.user.organizationId) <= 1) {
        throw httpError('At least one active administrator is required.', 400);
      }

      if (requiresBusinessUnitMembership(roleKey)) {
        await validateBusinessUnitMemberships(tx, session.user.organizationId, businessUnitIds);
      }

      const roleRow = roleByKey.get(roleKey);
      const result = await updateUserAccess({
        tx,
        existingUser,
        name,
        email: existingUser.email,
        password: String(body.password || ''),
        roleId: roleRow.id,
        managedRoleIds,
        businessUnitIds,
        isActive,
      });
      savedUserId = result.userId;

      if (!isActive) {
        await deactivateUserAccount({ tx, userId: id });
      }
    });

    const response = await readResponseUsers(db, session.user.organizationId, savedUserId);
    return NextResponse.json(response);
  } catch (txError) {
    return errorResponse(txError, 'User update failed.');
  }
}
