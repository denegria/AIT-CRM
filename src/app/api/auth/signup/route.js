import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  businessUnitMemberships,
  businessUnits,
  roles,
  userPasswordCredentials,
  userRoles,
  users,
} from '@/db/schema.js';
import { createUserSession, hashPassword, setAuthCookie } from '@/lib/auth';
import { verifySignupInviteToken } from '@/lib/signup-invites';
import {
  INVITE_ROLE_KEYS,
  MANAGED_ROLE_LOOKUP_KEYS,
  compatibleRoleLookupKeys,
  normalizeRoleKey,
  preferredRoleRowForKey,
} from '@/lib/roles.js';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || '').trim();
}

function normalizeBusinessUnitIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const invite = verifySignupInviteToken(body.inviteToken);
  if (!invite.ok) {
    return NextResponse.json({ error: invite.error }, { status: 403 });
  }

  const email = normalizeEmail(body.email);
  const name = normalizeName(body.name);
  const password = String(body.password || '');
  const roleKey = normalizeRoleKey(invite.payload.roleKey, INVITE_ROLE_KEYS);
  const organizationId = String(invite.payload.organizationId || '');
  const businessUnitIds = normalizeBusinessUnitIds(invite.payload.businessUnitIds);

  if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }
  if (!organizationId || !roleKey || !businessUnitIds.length) {
    return NextResponse.json({ error: 'Signup link is not valid for employee registration.' }, { status: 403 });
  }

  const db = getDb();

  try {
    let signedInUserId = null;

    await db.transaction(async (tx) => {
      const roleLookupKeys = compatibleRoleLookupKeys(roleKey);
      const roleRows = await tx
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(and(eq(roles.organizationId, organizationId), inArray(roles.key, roleLookupKeys)))
        .limit(roleLookupKeys.length);

      const roleRow = preferredRoleRowForKey(roleRows, roleKey);
      if (!roleRow) throw new Error('Employee role is not available.');

      const managedRoleRows = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.organizationId, organizationId), inArray(roles.key, MANAGED_ROLE_LOOKUP_KEYS)));
      const managedRoleIds = managedRoleRows.map((row) => row.id);
      if (!managedRoleIds.length) throw new Error('Employee roles are not available.');

      const validUnits = await tx
        .select({ id: businessUnits.id })
        .from(businessUnits)
        .where(and(
          eq(businessUnits.organizationId, organizationId),
          eq(businessUnits.isActive, true),
          inArray(businessUnits.id, businessUnitIds),
        ));
      if (validUnits.length !== businessUnitIds.length) {
        throw new Error('One or more invite divisions are no longer available.');
      }

      const [existing] = await tx
        .select({ id: users.id, organizationId: users.organizationId })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      let userId = existing?.id || null;
      if (userId) {
        if (existing.organizationId !== organizationId) {
          throw new Error('This email already belongs to another organization.');
        }
        throw new Error('This account already exists. Please sign in instead.');
      } else {
        const [insertedUser] = await tx
          .insert(users)
          .values({
            organizationId,
            name,
            email,
            isActive: true,
          })
          .returning({ id: users.id });
        userId = insertedUser.id;
      }

      if (!userId) throw new Error('Failed to create employee account.');

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
        .onConflictDoNothing({
          target: userPasswordCredentials.email,
        });

      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, managedRoleIds)));
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

      signedInUserId = userId;
    });

    const { token, expiresAt } = await createUserSession(signedInUserId);
    const response = NextResponse.json({ ok: true });
    setAuthCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Employee signup failed.' }, { status: 400 });
  }
}
