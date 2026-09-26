import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAcceptedEmployeeInvitation } from './employee-auth-policy.js';

function validInput() {
  return {
    invitation: {
      status: 'pending',
      providerInvitationId: 'invitation_1',
      intendedEmail: 'employee@gmail.com',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
    providerInvitation: {
      id: 'invitation_1',
      organizationId: 'org_crm',
      state: 'accepted',
      acceptedUserId: 'user_workos',
      email: 'employee@gmail.com',
    },
    identity: {
      providerUserId: 'user_workos',
      email: 'employee@gmail.com',
    },
    expectedOrganizationId: 'org_crm',
    now: new Date('2029-01-01T00:00:00.000Z'),
  };
}

test('accepts only the exact invited email and WorkOS user', () => {
  assert.deepEqual(validateAcceptedEmployeeInvitation(validInput()), {
    intendedEmail: 'employee@gmail.com',
  });
  const wrongEmail = validInput();
  wrongEmail.identity.email = 'somebody-else@gmail.com';
  assert.throws(() => validateAcceptedEmployeeInvitation(wrongEmail), /provider_email_mismatch/u);
  const wrongUser = validInput();
  wrongUser.providerInvitation.acceptedUserId = 'different_user';
  assert.throws(() => validateAcceptedEmployeeInvitation(wrongUser), /provider_identity_mismatch/u);
});

test('rejects replay, expiry, and cross-organization acceptance', () => {
  const replay = validInput();
  replay.invitation.status = 'accepted';
  assert.throws(() => validateAcceptedEmployeeInvitation(replay), /crm_invitation_not_pending/u);
  const expired = validInput();
  expired.now = new Date('2031-01-01T00:00:00.000Z');
  assert.throws(() => validateAcceptedEmployeeInvitation(expired), /crm_invitation_expired/u);
  const crossOrganization = validInput();
  crossOrganization.providerInvitation.organizationId = 'org_other';
  assert.throws(() => validateAcceptedEmployeeInvitation(crossOrganization), /provider_organization_mismatch/u);
});
