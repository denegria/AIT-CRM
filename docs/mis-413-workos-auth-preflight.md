# MIS-413 WorkOS authentication preflight

## Decision

Adopt WorkOS AuthKit as the AIT CRM authentication and external session plane.
Keep AIT CRM/Postgres authoritative for application users, organization scope,
roles, permissions, business-unit membership, active/inactive state, and audit
events.

Production remains approval-gated. The implementation must first prove the
entire cutover in the isolated development lane and the WorkOS staging
environment.

## Current state

- CRM stores PBKDF2-HMAC-SHA512 credentials and opaque local sessions.
- Login and re-authentication verify passwords locally.
- Employee signup uses a reusable, stateless signed bearer link that is not
  bound to an email and cannot be revoked.
- Product Admin can create a user and choose an initial password or replace a
  password directly.
- AIT USA Portal already proves WorkOS password authentication, password reset,
  sealed sessions, refresh, and session revocation in a separate application.

## Target boundary

### Routes/actions own product policy

- Require `settings:write` for invite, resend, revoke, and reset-link actions.
- Validate organization, role, and business-unit scope before provider calls.
- Bind every invitation to one normalized email and one immutable access
  snapshot.
- Provision local access only after WorkOS returns the verified invited email.
- Reject inactive, cross-organization, unlinked, or mismatched identities.
- Enforce last-admin, self-deactivation, and business-unit rules locally.
- Record privacy-safe audit events for each auth lifecycle transition.

### WorkOS adapter owns provider mechanics

- Authorization URL and code exchange.
- Password authentication used by the existing session-switch re-auth flow.
- Sealed-session creation, validation, refresh, and revocation.
- User creation/update with imported PBKDF2 credentials.
- Invitation creation, resend, lookup, and revocation.
- Password-reset delivery.
- Provider error normalization with no token, password, or email leakage.

The adapter receives explicit values and never reads request sessions, roles,
or business-unit policy.

## Data model

### `users`

- `workos_user_id` nullable unique text.
- `auth_migrated_at` nullable timestamp.

Legacy credential/session rows remain during the staged rollback window but are
never consulted when `AIT_CRM_AUTH_MODE=workos`. They are retired only under a
separate production-approved cleanup.

### `employee_auth_invitations`

- Organization, intended email, display name, role, creator, and provider
  invitation ID.
- State: `pending`, `accepted`, `revoked`, `expired`, or `failed`.
- Provider timestamps plus accepted local user, replacement invitation, and
  privacy-safe failure code.
- No raw provider token or acceptance URL is persisted.

### `employee_auth_invitation_business_units`

- Normalized immutable business-unit snapshot for each invitation.
- Composite uniqueness prevents duplicate memberships.

## Password migration

CRM credentials use SHA-512, 310,000 iterations, a 32-character hexadecimal
salt string, and a 64-byte derived key. WorkOS supports PBKDF2-SHA512 in PHC
format at 210,000–1,000,000 iterations.

The migration serializer must encode the exact UTF-8 salt string and derived
key as unpadded Base64:

`$pbkdf2$i=310000,d=sha512$<salt-b64>$<hash-b64>`

Migration is idempotent by local user ID as WorkOS `external_id`. Existing
passwords are preserved only after a synthetic staging user authenticates with
the unchanged known password. Forced reset is fallback-only.

## Session and cutover contract

- `AIT_CRM_AUTH_MODE=legacy` keeps the current path during code deployment.
- `AIT_CRM_AUTH_MODE=workos` fails closed unless the CRM-specific WorkOS API
  key, client ID, organization ID, and 32+ character cookie password exist.
- The WorkOS cookie is HttpOnly, Secure in production, SameSite=Lax for the
  hosted callback, and scoped to `/`.
- Every authenticated request validates/refreshes the WorkOS sealed session,
  then loads current local RBAC by `workos_user_id` and verified email.
- Local account deactivation immediately denies authorization even if the
  external WorkOS session remains valid; the admin action also attempts bounded
  revocation of active provider sessions.
- Logout revokes the provider session before clearing the local cookie.
- No fallback to legacy authentication occurs while WorkOS mode is active.

## Delivery slices

### 1. Provider and schema foundation

- Add WorkOS dependency, adapter, runtime config, PHC serializer, schema, and
  forward migration.
- Focused tests: configuration, PHC conversion, error normalization, session
  refresh/revocation, and schema contract.

### 2. Session cutover and existing-user migration

- Replace login/session/logout/reauth mechanics behind the auth-mode switch.
- Add callback/authorize routes and idempotent migration script.
- Focused tests: inactive/unlinked/cross-email rejection, local RBAC loading,
  refresh, logout, and no legacy fallback.

### 3. Invitation and recovery actions

- Replace legacy stateless invite/signup routes with persisted WorkOS-backed
  invitation actions.
- Add generic forgot-password and admin send-reset actions.
- Focused tests: exact email, expiration, revoke, replacement, replay,
  concurrent acceptance, enumeration resistance, and rate-limit mapping.

### 4. Product Admin and employee UI

- Replace initial-password account creation with Send invite.
- Show pending/accepted/revoked/expired state; expose resend/revoke/send-reset.
- Use AuthKit-hosted sign-in/recovery and preserve a clear CRM access-denied
  experience after callback.

### 5. Staging migration and release proof

- Print the safe staging DB fingerprint before any approved write.
- Run a synthetic WorkOS password-import canary, authenticate, verify local
  linkage/session/RBAC, and clean the exact synthetic records.
- Run focused security tests, `npm run validate`, schema rollback validation,
  authenticated desktop/mobile QA, and privacy-safe error review.
- Push only the accepted commit to `staging`; production remains blocked.

## Stop conditions

- WorkOS cannot authenticate the imported CRM-format canary password.
- Provider environment or application identity is ambiguous.
- A provider response would require logging or persisting raw auth tokens.
- Invitation acceptance cannot be made atomic with local access provisioning.
- The staging database or base URL fingerprint does not match the canonical
  staging branch.
- Required configuration would alter production.

## Acceptance

- Existing employees authenticate through WorkOS with unchanged passwords.
- New employees receive email-bound, expiring, revocable invitations.
- Invite redemption creates local access exactly once with the intended role
  and business-unit scope.
- Password reset is self-service, generic, rate-limited by the provider, and
  revokes prior sessions.
- Product Admin never sees or sets an employee password.
- Local deactivation and RBAC changes remain immediately authoritative.
- Legacy stateless invite and local-password login are disabled in WorkOS mode.
- No raw credentials, hashes, invite tokens, reset tokens, or session material
  appear in logs, Linear, tests, or durable memory.
