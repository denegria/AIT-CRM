import { CRMIdentityProviderError } from './workos-provider.js';

export function normalizeEmployeeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateAcceptedEmployeeInvitation({
  invitation,
  providerInvitation,
  identity,
  expectedOrganizationId,
  now = new Date(),
}) {
  if (!invitation || invitation.status !== 'pending') {
    throw new CRMIdentityProviderError('crm_invitation_not_pending', 409);
  }
  if (!providerInvitation || providerInvitation.id !== invitation.providerInvitationId) {
    throw new CRMIdentityProviderError('provider_invitation_mismatch', 403);
  }
  if (providerInvitation.organizationId !== expectedOrganizationId) {
    throw new CRMIdentityProviderError('provider_organization_mismatch', 403);
  }
  if (providerInvitation.state !== 'accepted') {
    throw new CRMIdentityProviderError('provider_invitation_not_accepted', 403);
  }
  if (providerInvitation.acceptedUserId !== identity.providerUserId) {
    throw new CRMIdentityProviderError('provider_identity_mismatch', 403);
  }

  const intendedEmail = normalizeEmployeeEmail(invitation.intendedEmail);
  const providerEmail = normalizeEmployeeEmail(providerInvitation.email);
  if (!intendedEmail || intendedEmail !== providerEmail || intendedEmail !== identity.email) {
    throw new CRMIdentityProviderError('provider_email_mismatch', 403);
  }
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) {
    throw new CRMIdentityProviderError('crm_invitation_expired', 403);
  }
  return { intendedEmail };
}
