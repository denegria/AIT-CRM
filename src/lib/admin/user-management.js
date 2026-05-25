import { pbkdf2Sync, randomBytes } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  businessUnitMemberships,
  userPasswordCredentials,
  userRoles,
  userSessions,
  users,
} from '../../db/schema.js';
import { buildMembershipRows } from './user-access-values.js';

const PASSWORD_ITERATIONS = 310000;

function hashPassword(password, salt = randomBytes(16).toString('hex'), iterations = PASSWORD_ITERATIONS) {
  const hash = pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('base64');
  return { hash, salt, iterations };
}

export async function upsertUserPasswordCredential({ tx, userId, email, password }) {
  if (!password) return null;

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

  return { userId, email };
}

export async function createOrUpdateUserRecord({
  tx,
  organizationId,
  existingUser = null,
  name,
  email,
  isActive = true,
}) {
  if (existingUser?.id) {
    const [updatedUser] = await tx
      .update(users)
      .set({ name, isActive, updatedAt: new Date() })
      .where(eq(users.id, existingUser.id))
      .returning({ id: users.id });
    return updatedUser?.id || existingUser.id;
  }

  const [insertedUser] = await tx
    .insert(users)
    .values({
      organizationId,
      name,
      email,
      isActive,
    })
    .returning({ id: users.id });

  return insertedUser?.id || null;
}

export async function replaceManagedUserRole({ tx, userId, roleId, managedRoleIds = [] }) {
  if (managedRoleIds.length) {
    await tx
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, managedRoleIds)));
  }

  await tx.insert(userRoles).values({ userId, roleId });
}

export async function replaceBusinessUnitMemberships({ tx, userId, roleId, businessUnitIds = [] }) {
  await tx.delete(businessUnitMemberships).where(eq(businessUnitMemberships.userId, userId));

  const membershipRows = buildMembershipRows({ userId, roleId, businessUnitIds });
  for (const membershipRow of membershipRows) {
    await tx.insert(businessUnitMemberships).values(membershipRow);
  }

  return membershipRows;
}

export async function provisionUserAccess({
  tx,
  organizationId,
  existingUser = null,
  name,
  email,
  password = '',
  roleId,
  managedRoleIds = [],
  businessUnitIds = [],
  isActive = true,
}) {
  const userId = await createOrUpdateUserRecord({
    tx,
    organizationId,
    existingUser,
    name,
    email,
    isActive,
  });

  if (!userId) throw new Error('Failed to save user.');

  await upsertUserPasswordCredential({ tx, userId, email, password });
  await replaceManagedUserRole({ tx, userId, roleId, managedRoleIds });
  await replaceBusinessUnitMemberships({ tx, userId, roleId, businessUnitIds });

  return { userId };
}

export async function updateUserAccess({
  tx,
  existingUser,
  name,
  email,
  password = '',
  roleId,
  managedRoleIds = [],
  businessUnitIds = [],
  isActive = true,
}) {
  const userId = await createOrUpdateUserRecord({
    tx,
    organizationId: existingUser.organizationId,
    existingUser,
    name,
    email,
    isActive,
  });

  await upsertUserPasswordCredential({ tx, userId, email, password });
  await replaceManagedUserRole({ tx, userId, roleId, managedRoleIds });
  await replaceBusinessUnitMemberships({ tx, userId, roleId, businessUnitIds });

  return { userId };
}

export async function deactivateUserAccount({ tx, userId }) {
  const [user] = await tx
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  await tx
    .update(userSessions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(userSessions.userId, userId));

  return { userId: user?.id || userId };
}
