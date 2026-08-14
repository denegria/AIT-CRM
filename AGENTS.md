# AIT CRM — Agent Contract

## Product and stack

- Operational CRM for AIT Signs and AIT USA Institute.
- Next.js 16 App Router, React 19, Neon/Postgres, Drizzle, Node 22+.
- Routes/actions own auth, policy, business-unit scope, state transitions, and user-facing failures. Reusable mechanics and provider boundaries live under `src/lib`.

## Branch and delivery policy

- Source/production: `master`; QA/staging: `staging`.
- Work in a fresh issue-bound worktree from the intended remote base. Durable worktrees are validation/deployment lanes, not scratch space.
- Git pushes trigger deployment. Do not run a second manual platform deploy.
- Production promotion always requires explicit Alvaro approval.
- Use `Builder <alvarodenegri98@gmail.com>` for commits and preserve unrelated dirty work.

## Required validation

- Every candidate: `npm run validate`.
- Add focused tests for the touched domain; the broad command is a floor, not a substitute for risk-specific verification.
- UI or sequence-sensitive changes also require authenticated desktop/mobile browser QA against staging.
- Schema, auth/RBAC, provider callback, outbound messaging, and automation changes require their applicable validation profile and independent risk review.

## Data, provider, and privacy boundaries

- AIT Signs and AIT USA data remain business-unit scoped.
- No production or staging DB writes, migrations, imports, promotions, provider sends, campaigns, or test-data creation without explicit authority.
- Before any approved data write, print the safe Neon/database fingerprint required by workspace policy; never reveal credentials.
- Do not send recordings, message bodies, phone numbers, emails, student records, provider payloads, or secrets to Sentry. Use safe identifiers, error classes, route names, and state-transition metadata only.

## Definition of done

- Acceptance criteria and `npm run validate` pass.
- A release packet records issue, brief/reference, commit, focused and broad validation, browser evidence when applicable, staging deployment, privacy-safe Sentry status, approval state, and residual risk.
- Staging live QA and Linear synchronization are explicit gates. Never call staging work production-complete.
