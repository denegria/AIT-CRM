import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  businessUnitMemberships,
  businessUnits,
  employeeAuthEvents,
  employeeAuthInvitationBusinessUnits,
  employeeAuthInvitations,
  roles,
  userRoles,
  users,
} from '@/db/schema.js';
import { MANAGED_ROLE_LOOKUP_KEYS } from '@/lib/roles.js';
import { CRMIdentityProviderError } from './workos-provider.js';
import {
  normalizeEmployeeEmail,
  validateAcceptedEmployeeInvitation,
} from './employee-auth-policy.js';

function safeFailureCode(error, fallback) {
  const code = String(error?.code || error?.message || fallback);
  return /^[a-z0-9_:-]{1,80}$/iu.test(code) ? code : fallback;
}

async function writeAuthEvent(tx, values) {
  await tx.insert(employeeAuthEvents).values({
    outcome: 'succeeded',
    metadataJson: {},
    ...values,
  });
}

export async function createEmployeeInvitation({
  db,
  provider,
  organizationId,
  actorUserId,
  name,
  email,
  roleId,
  businessUnitIds,
  expiresInDays = 7,
}) {
  const intendedEmail = normalizeEmployeeEmail(email);
  const intendedName = String(name || '').trim();
  if (!intendedEmail || !intendedName || !roleId || !Array.isArray(businessUnitIds)) {
    throw new CRMIdentityProviderError('crm_invitation_invalid', 400);
  }

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const invitation = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(employeeAuthInvitations)
      .values({
        organizationId,
        intendedEmail,
        intendedName,
        roleId,
        status: 'pending',
        expiresAt,
        createdByUserId: actorUserId,
      })
      .returning();
    if (businessUnitIds.length) {
      await tx.insert(employeeAuthInvitationBusinessUnits).values(
        businessUnitIds.map((businessUnitId, index) => ({
          invitationId: inserted.id,
          businessUnitId,
          isPrimary: index === 0,
        })),
      );
    }
    return inserted;
  });

  let providerInvitation = null;
  try {
    providerInvitation = await provider.sendInvitation({
      email: intendedEmail,
      expiresInDays,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(employeeAuthInvitations)
        .set({
          providerInvitationId: providerInvitation.id,
          expiresAt: new Date(providerInvitation.expiresAt),
          lastSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(employeeAuthInvitations.id, invitation.id),
          eq(employeeAuthInvitations.status, 'pending'),
          isNull(employeeAuthInvitations.providerInvitationId),
        ));
      await writeAuthEvent(tx, {
        organizationId,
        eventType: 'employee_invitation_sent',
        actorUserId,
        invitationId: invitation.id,
        providerReference: providerInvitation.id,
      });
    });
    return { ...invitation, providerInvitationId: providerInvitation.id, expiresAt: new Date(providerInvitation.expiresAt) };
  } catch (error) {
    if (providerInvitation?.id) {
      await provider.revokeInvitation(providerInvitation.id).catch(() => {});
    }
    const failureCode = safeFailureCode(error, 'employee_invitation_failed');
    await db.transaction(async (tx) => {
      await tx
        .update(employeeAuthInvitations)
        .set({ status: 'failed', failedAt: new Date(), failureCode, updatedAt: new Date() })
        .where(eq(employeeAuthInvitations.id, invitation.id));
      await writeAuthEvent(tx, {
        organizationId,
        eventType: 'employee_invitation_sent',
        outcome: 'failed',
        actorUserId,
        invitationId: invitation.id,
        providerReference: providerInvitation?.id || null,
        failureCode,
      });
    });
    throw error;
  }
}

export async function acceptEmployeeInvitation({
  db,
  providerInvitation,
  identity,
  expectedProviderOrganizationId,
}) {
  return db.transaction(async (tx) => {
    const [initialInvitation] = await tx
      .select()
      .from(employeeAuthInvitations)
      .where(eq(employeeAuthInvitations.providerInvitationId, providerInvitation.id))
      .limit(1);
    if (!initialInvitation) throw new CRMIdentityProviderError('crm_invitation_not_found', 403);

    await tx.execute(sql`select id from employee_auth_invitations where id = ${initialInvitation.id} for update`);
    const [invitation] = await tx
      .select()
      .from(employeeAuthInvitations)
      .where(eq(employeeAuthInvitations.id, initialInvitation.id))
      .limit(1);
    const { intendedEmail } = validateAcceptedEmployeeInvitation({
      invitation,
      providerInvitation,
      identity,
      expectedOrganizationId: expectedProviderOrganizationId,
    });

    const [role, invitationUnits, existingUser] = await Promise.all([
      tx
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(and(eq(roles.id, invitation.roleId), eq(roles.organizationId, invitation.organizationId)))
        .limit(1)
        .then((rows) => rows[0] || null),
      tx
        .select({
          businessUnitId: employeeAuthInvitationBusinessUnits.businessUnitId,
          isPrimary: employeeAuthInvitationBusinessUnits.isPrimary,
        })
        .from(employeeAuthInvitationBusinessUnits)
        .innerJoin(businessUnits, eq(employeeAuthInvitationBusinessUnits.businessUnitId, businessUnits.id))
        .where(and(
          eq(employeeAuthInvitationBusinessUnits.invitationId, invitation.id),
          eq(businessUnits.organizationId, invitation.organizationId),
          eq(businessUnits.isActive, true),
        )),
      tx
        .select({
          id: users.id,
          organizationId: users.organizationId,
          workosUserId: users.workosUserId,
        })
        .from(users)
        .where(eq(users.email, intendedEmail))
        .limit(1)
        .then((rows) => rows[0] || null),
    ]);
    if (!role || (role.key !== 'admin' && !invitationUnits.length)) {
      throw new CRMIdentityProviderError('crm_invitation_scope_invalid', 409);
    }
    if (existingUser && existingUser.organizationId !== invitation.organizationId) {
      throw new CRMIdentityProviderError('crm_identity_organization_conflict', 409);
    }
    if (existingUser?.workosUserId && existingUser.workosUserId !== identity.providerUserId) {
      throw new CRMIdentityProviderError('provider_identity_conflict', 409);
    }

    let userId = existingUser?.id || null;
    if (userId) {
      await tx
        .update(users)
        .set({
          name: invitation.intendedName,
          workosUserId: identity.providerUserId,
          authMigratedAt: new Date(),
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      const [createdUser] = await tx
        .insert(users)
        .values({
          organizationId: invitation.organizationId,
          name: invitation.intendedName,
          email: intendedEmail,
          workosUserId: identity.providerUserId,
          authMigratedAt: new Date(),
          isActive: true,
        })
        .returning({ id: users.id });
      userId = createdUser.id;
    }

    const managedRoles = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(
        eq(roles.organizationId, invitation.organizationId),
        inArray(roles.key, MANAGED_ROLE_LOOKUP_KEYS),
      ));
    if (managedRoles.length) {
      await tx.delete(userRoles).where(and(
        eq(userRoles.userId, userId),
        inArray(userRoles.roleId, managedRoles.map((row) => row.id)),
      ));
    }
    await tx.insert(userRoles).values({ userId, roleId: invitation.roleId }).onConflictDoNothing();

    await tx.delete(businessUnitMemberships).where(eq(businessUnitMemberships.userId, userId));
    if (invitationUnits.length) {
      await tx.insert(businessUnitMemberships).values(invitationUnits.map((unit) => ({
        userId,
        businessUnitId: unit.businessUnitId,
        roleId: invitation.roleId,
        isPrimary: unit.isPrimary,
      })));
    }

    const [accepted] = await tx
      .update(employeeAuthInvitations)
      .set({
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedUserId: userId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(employeeAuthInvitations.id, invitation.id),
        eq(employeeAuthInvitations.status, 'pending'),
      ))
      .returning({ id: employeeAuthInvitations.id });
    if (!accepted) throw new CRMIdentityProviderError('crm_invitation_replayed', 409);

    await writeAuthEvent(tx, {
      organizationId: invitation.organizationId,
      eventType: 'employee_invitation_accepted',
      subjectUserId: userId,
      invitationId: invitation.id,
      providerReference: providerInvitation.id,
    });
    return { userId, invitationId: invitation.id };
  });
}

export async function reconcileAcceptedEmployeeInvitation({
  db,
  provider,
  identity,
  expectedProviderOrganizationId,
}) {
  const intendedEmail = normalizeEmployeeEmail(identity?.email);
  if (!intendedEmail) return null;

  const candidates = await db
    .select({
      id: employeeAuthInvitations.id,
      providerInvitationId: employeeAuthInvitations.providerInvitationId,
    })
    .from(employeeAuthInvitations)
    .where(and(
      eq(employeeAuthInvitations.intendedEmail, intendedEmail),
      eq(employeeAuthInvitations.status, 'pending'),
    ))
    .limit(2);
  if (!candidates.length) return null;
  if (candidates.length !== 1 || !candidates[0].providerInvitationId) {
    throw new CRMIdentityProviderError('crm_invitation_ambiguous', 409);
  }

  const providerInvitation = await provider.getInvitation(candidates[0].providerInvitationId);
  return acceptEmployeeInvitation({
    db,
    providerInvitation,
    identity,
    expectedProviderOrganizationId,
  });
}

async function readScopedPendingInvitation(db, { invitationId, organizationId }) {
  const [invitation] = await db
    .select()
    .from(employeeAuthInvitations)
    .where(and(
      eq(employeeAuthInvitations.id, invitationId),
      eq(employeeAuthInvitations.organizationId, organizationId),
      eq(employeeAuthInvitations.status, 'pending'),
    ))
    .limit(1);
  if (!invitation?.providerInvitationId) {
    throw new CRMIdentityProviderError('crm_invitation_not_pending', 409);
  }
  return invitation;
}

export async function resendEmployeeInvitation({ db, provider, invitationId, organizationId, actorUserId }) {
  const invitation = await readScopedPendingInvitation(db, { invitationId, organizationId });
  const providerInvitation = await provider.resendInvitation(invitation.providerInvitationId);
  await db.transaction(async (tx) => {
    await tx
      .update(employeeAuthInvitations)
      .set({
        expiresAt: new Date(providerInvitation.expiresAt),
        lastSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(employeeAuthInvitations.id, invitation.id),
        eq(employeeAuthInvitations.status, 'pending'),
      ));
    await writeAuthEvent(tx, {
      organizationId,
      eventType: 'employee_invitation_resent',
      actorUserId,
      invitationId: invitation.id,
      providerReference: providerInvitation.id,
    });
  });
  return { id: invitation.id, status: 'pending' };
}

export async function revokeEmployeeInvitation({ db, provider, invitationId, organizationId, actorUserId }) {
  const invitation = await readScopedPendingInvitation(db, { invitationId, organizationId });
  await provider.revokeInvitation(invitation.providerInvitationId);
  await db.transaction(async (tx) => {
    await tx
      .update(employeeAuthInvitations)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(employeeAuthInvitations.id, invitation.id),
        eq(employeeAuthInvitations.status, 'pending'),
      ));
    await writeAuthEvent(tx, {
      organizationId,
      eventType: 'employee_invitation_revoked',
      actorUserId,
      invitationId: invitation.id,
      providerReference: invitation.providerInvitationId,
    });
  });
  return { id: invitation.id, status: 'revoked' };
}

export async function recordEmployeePasswordResetRequest({
  db,
  organizationId,
  actorUserId,
  subjectUserId,
  providerReference = null,
}) {
  await writeAuthEvent(db, {
    organizationId,
    eventType: 'employee_password_reset_requested',
    actorUserId,
    subjectUserId,
    providerReference,
  });
}
