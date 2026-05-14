import { NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  businessUnitMemberships,
  businessUnits,
  roles,
  userPasswordCredentials,
  userRoles,
  users,
} from '@/db/schema.js';
import { hashPassword, PERMISSIONS, requirePermission } from '@/lib/auth';

const MANAGED_ROLE_KEYS = ['admin', 'designer', 'account_manager', 'sales_manager'];

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || '').trim();
}

function normalizeRoleKey(value) {
  const key = String(value || '').trim();
  return MANAGED_ROLE_KEYS.includes(key) ? key : '';
}

function normalizeBusinessUnitIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

function toUserPayload(user, roleKeys, memberships) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    roleKeys,
    primaryRoleKey: roleKeys.includes('admin') ? 'admin' : roleKeys[0] || 'account_manager',
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
    .orderBy(asc(users.name), asc(users.email));

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
      .where(inArray(userRoles.userId, userIds)),
    db
      .select({
        userId: businessUnitMemberships.userId,
        businessUnitId: businessUnitMemberships.businessUnitId,
        isPrimary: businessUnitMemberships.isPrimary,
        businessUnitName: businessUnits.name,
      })
      .from(businessUnitMemberships)
      .innerJoin(businessUnits, eq(businessUnitMemberships.businessUnitId, businessUnits.id))
      .where(inArray(businessUnitMemberships.userId, userIds)),
  ]);

  const rolesByUser = new Map();
  for (const roleRow of roleRows) {
    if (!rolesByUser.has(roleRow.userId)) rolesByUser.set(roleRow.userId, new Set());
    rolesByUser.get(roleRow.userId).add(roleRow.roleKey);
  }

  const membershipsByUser = new Map();
  for (const membership of membershipRows) {
    if (!membershipsByUser.has(membership.userId)) membershipsByUser.set(membership.userId, []);
    membershipsByUser.get(membership.userId).push({
      businessUnitId: membership.businessUnitId,
      businessUnitName: membership.businessUnitName,
      isPrimary: Boolean(membership.isPrimary),
    });
  }

  return userRows.map((row) => {
    const roleKeys = [...(rolesByUser.get(row.id) || new Set())];
    const memberships = membershipsByUser.get(row.id) || [];
    return toUserPayload(row, roleKeys, memberships);
  });
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const db = getDb();
  const records = await readUsersForOrganization(db, session.user.organizationId);
  return NextResponse.json({ users: records });
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const name = normalizeName(body.name);
  const password = String(body.password || '');
  const roleKey = normalizeRoleKey(body.roleKey);
  const businessUnitIds = normalizeBusinessUnitIds(body.businessUnitIds);

  if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (!roleKey) {
    return NextResponse.json({ error: `Role must be one of: ${MANAGED_ROLE_KEYS.join(', ')}.` }, { status: 400 });
  }
  if (roleKey !== 'admin' && !businessUnitIds.length) {
    return NextResponse.json({ error: 'At least one business unit is required for non-admin users.' }, { status: 400 });
  }

  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [roleRow] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.organizationId, session.user.organizationId), eq(roles.key, roleKey)))
        .limit(1);

      if (!roleRow) {
        throw new Error(`Role "${roleKey}" was not found. Run bootstrap role provisioning first.`);
      }

      if (businessUnitIds.length) {
        const validUnits = await tx
          .select({ id: businessUnits.id })
          .from(businessUnits)
          .where(and(
            eq(businessUnits.organizationId, session.user.organizationId),
            inArray(businessUnits.id, businessUnitIds),
          ));
        if (validUnits.length !== businessUnitIds.length) {
          throw new Error('One or more business units are invalid for this organization.');
        }
      }

      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      let userId = existing?.id;
      if (userId) {
        await tx
          .update(users)
          .set({ organizationId: session.user.organizationId, name, isActive: true, updatedAt: new Date() })
          .where(eq(users.id, userId));
      } else {
        const [insertedUser] = await tx
          .insert(users)
          .values({
            organizationId: session.user.organizationId,
            name,
            email,
            isActive: true,
          })
          .returning({ id: users.id });
        userId = insertedUser.id;
      }

      if (!userId) throw new Error('Failed to create user.');

      if (password) {
        const passwordData = hashPassword(password);
        await tx
          .insert(userPasswordCredentials)
          .values({
            userId,
            email,
            passwordHash: passwordData.hash,
            passwordSalt: passwordData.salt,
            passwordIterations: passwordData.iterations,
          })
          .onConflictDoUpdate({
            target: userPasswordCredentials.email,
            set: {
              userId,
              passwordHash: passwordData.hash,
              passwordSalt: passwordData.salt,
              passwordIterations: passwordData.iterations,
              updatedAt: new Date(),
            },
          });
      }

      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      await tx.insert(userRoles).values({ userId, roleId: roleRow.id });

      await tx.delete(businessUnitMemberships).where(eq(businessUnitMemberships.userId, userId));
      for (let index = 0; index < businessUnitIds.length; index += 1) {
        await tx.insert(businessUnitMemberships).values({
          userId,
          businessUnitId: businessUnitIds[index],
          roleId: roleRow.id,
          isPrimary: index === 0,
        });
      }
    });

    const records = await readUsersForOrganization(db, session.user.organizationId);
    const created = records.find((record) => record.email === email) || null;
    return NextResponse.json({ user: created, users: records }, { status: created ? 201 : 200 });
  } catch (txError) {
    return NextResponse.json({ error: txError.message || 'User provisioning failed.' }, { status: 400 });
  }
}
