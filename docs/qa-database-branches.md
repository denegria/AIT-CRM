# Production-derived QA database branches

This runbook implements the MIS-313 three-environment policy.

## Environment policy

- **Production** is the sole source of truth for employee and client business data.
- **Persistent staging** is a stable synthetic environment for authentication, RBAC, integration configuration, and routine regression QA. It is not a production-data mirror.
- **Temporary QA branches** are short-lived Neon branches created from a known production branch for imports, migrations, and validation that requires current production-shaped data.

Never synchronize staging rows into production. Never continuously synchronize production rows into persistent staging. A production write requires a separately reviewed operation and explicit approval.

Temporary branches contain production-sensitive data. Keep their Vercel previews protected, limit access to authorized reviewers, and never use them for demos, training, or general development.

## What the workflow guards

`npm run qa:db-branch` is dry-run by default. Mutating commands require `--execute`.

The workflow:

- requires both production and persistent-staging Neon branch IDs to be listed as protected;
- requires the production parent by exact Neon branch ID;
- creates only `qa-*` branches with a provider-enforced expiry of at most 72 hours;
- writes a local metadata manifest without storing a connection string;
- adds `DATABASE_URL` only to the selected Vercel Preview Git branch;
- enables `AIT_CRM_EXTERNAL_IO_DISABLED=true` on that preview branch;
- disables Facebook automatic promotion and SMS live/test/production sending;
- verifies the Neon project/branch fingerprint, required tables, foreign-key validation state, RBAC membership baseline, and migration journal;
- requires exact branch-name confirmation before deletion;
- removes branch-scoped Vercel variables before deleting the temporary Neon branch.

When `AIT_CRM_EXTERNAL_IO_DISABLED=true`, public provider webhooks return `503`, Meta manual sends fail before provider fetch, Lead Ads backfill is blocked after authorization, and SMS live/test sending remains disabled.

## Prerequisites

- Neon CLI authentication with access to the AIT CRM project, or `NEON_API_KEY` in the operator environment.
- Vercel CLI authentication and the AIT CRM project linked from the canonical checkout, or `--vercel-project` supplied.
- Exact Neon IDs for production and persistent staging. Obtain them from approved environment configuration; do not infer them from hostnames.
- A non-production Git branch that will own the protected preview deployment.

Push the non-production code branch before creating the Neon branch. Vercel requires a real branch in the connected Git repository before it accepts branch-specific environment variables. The branch's initial preview uses the normal Preview environment; production-derived data is not attached until the guarded workflow runs.

Set operator-only values without committing them:

```bash
export NEON_PROJECT_ID="<project-id>"
export AIT_CRM_PRODUCTION_NEON_BRANCH_ID="<production-branch-id>"
export AIT_CRM_PROTECTED_NEON_BRANCH_IDS="<production-branch-id>,<staging-branch-id>"
```

## 1. Plan and create

Push the selected non-production branch and let its ordinary Preview deployment start first:

```bash
git push origin "qa/mis-313-<purpose>"
```

First inspect the plan. This does not mutate Neon or Vercel:

```bash
npm run qa:db-branch -- create \
  --issue MIS-313 \
  --owner "<operator>" \
  --purpose "Validate <bounded operation>" \
  --preview-branch "qa/mis-313-<purpose>" \
  --ttl-hours 24
```

After reviewing the parent ID, preview branch, expiry, and manifest path, repeat with `--execute`:

```bash
npm run qa:db-branch -- create \
  --issue MIS-313 \
  --owner "<operator>" \
  --purpose "Validate <bounded operation>" \
  --preview-branch "qa/mis-313-<purpose>" \
  --ttl-hours 24 \
  --execute
```

Record the returned manifest path. Manifests live under `.qa-branches/`, are ignored by Git, and contain identifiers and lifecycle evidence only.

## 2. Attach the protected preview

Plan the Vercel changes:

```bash
npm run qa:db-branch -- attach --manifest-path ".qa-branches/<branch>.json"
```

Apply the branch-scoped Preview variables:

```bash
npm run qa:db-branch -- attach \
  --manifest-path ".qa-branches/<branch>.json" \
  --vercel-project "<project-name-or-id>" \
  --execute
```

After attachment, redeploy the same preview Git branch so Vercel applies its branch-specific variables. Do not run `vercel --prod` and do not target the persistent staging branch.

Push or redeploy only the selected non-production preview branch through the normal Git/Vercel preview path. Verify that Deployment Protection is active before authenticating or inspecting production-derived data.

## 3. Verify

Database-only verification may run before preview attachment:

```bash
npm run qa:db-branch -- verify \
  --manifest-path ".qa-branches/<branch>.json" \
  --database-only
```

Full verification requires the branch-scoped external-I/O kill switch to have been attached:

```bash
npm run qa:db-branch -- verify --manifest-path ".qa-branches/<branch>.json"
```

Then perform the bounded import, migration, or QA task. Use the temporary branch only. Print the safe fingerprint before every write and record the verification summary, preview URL, and result on the linked Linear issue.

## 4. Detect expiry and destroy

List local manifests whose TTL has elapsed without recorded cleanup:

```bash
npm run qa:db-branch -- expired
```

Plan cleanup:

```bash
npm run qa:db-branch -- destroy \
  --manifest-path ".qa-branches/<branch>.json" \
  --confirm-branch "<exact-qa-branch-name>"
```

After reviewing the exact target, execute cleanup:

```bash
npm run qa:db-branch -- destroy \
  --manifest-path ".qa-branches/<branch>.json" \
  --confirm-branch "<exact-qa-branch-name>" \
  --execute
```

If Neon has already deleted the branch at its provider-enforced expiry, explicitly acknowledge that while removing the remaining Vercel overrides and closing the manifest:

```bash
npm run qa:db-branch -- destroy \
  --manifest-path ".qa-branches/<branch>.json" \
  --confirm-branch "<exact-qa-branch-name>" \
  --branch-already-expired \
  --execute
```

Record deletion evidence in Linear. Do not delete the local manifest until closeout is recorded.

## Interrupted-run recovery

1. Run `status` against the manifest and confirm the exact Neon and Preview Git branch identifiers.
2. Run `expired` to determine whether the recorded TTL has elapsed.
3. If Vercel attachment partially failed, do not deploy. Re-run the dry-run attachment plan and inspect the branch-specific variables in Vercel before deciding whether to continue or clean up.
4. If environment-variable removal fails, stop before deleting Neon. Resolve the scoped Vercel cleanup first so no preview remains pointed at an unmanaged database.
5. Never substitute production or persistent staging IDs to “repair” a failed temporary workflow.
