# AIT CRM Production Runbook

## Release Gate

Run these before pushing to `master`:

```bash
npm run lint
npm run build
```

If a migration was added, apply it to production before code that depends on it:

```bash
vercel env pull --environment=production .env.production.local
node --env-file=.env.production.local node_modules/drizzle-kit/bin.cjs migrate --config drizzle.config.mjs
```

Use `node --env-file` instead of shell-sourcing Vercel env files so database URLs with special characters are parsed safely.

## Production Verification

After deploy, run the readiness check with production env loaded:

```bash
node --env-file=.env.production.local scripts/verify-production-readiness.mjs
npm run verify:rbac
```

The check verifies:

- required production env vars are present
- the production app responds
- the Meta webhook rejects an invalid verify token
- the Meta webhook accepts the configured verify token
- required CRM tables exist
- the v1 `work_orders` columns exist
- the Drizzle migration journal is readable
- role permissions and scoped test-account boundaries are enforced

Vercel may omit sensitive env values from local pulls. If the app is already deployed and Meta has been verified externally, skip only the sensitive-value check:

```bash
SKIP_SENSITIVE_ENV=1 SKIP_META_VALID_TOKEN=1 node --env-file=.env.production.local scripts/verify-production-readiness.mjs
```

If production env is not available locally at all, the HTTP-only portion can still be run with:

```bash
SKIP_ENV=1 SKIP_DB=1 SKIP_META_VALID_TOKEN=1 npm run verify:production
```

## Meta Page Additions

Each Facebook Page is connected separately in Meta.

1. Subscribe the Page to the app/webhook fields used by Messenger or Lead Ads.
2. Add the Page ID to `META_PAGE_BUSINESS_UNIT_MAP`.
3. If the Page uses a different Page token, add it to `META_PAGE_ACCESS_TOKEN_MAP`.
4. Redeploy after env changes.
5. Send a real Messenger test message or Lead Ads test lead and confirm the CRM contact/lead lands in the expected division.

Do not replace the existing Page token unless the new token covers every Page currently in production.

## Rollback

If a release breaks production:

1. Use Vercel to rollback to the previous production deployment.
2. Do not roll back database migrations unless the migration is proven destructive and a restore plan is ready.
3. Confirm `/` returns HTTP 200.
4. Confirm `/api/webhooks/facebook-leads` rejects a wrong verify token with HTTP 403.
5. Record the failed commit, deployment ID, and root cause before the next push.

## Backup/Restore Baseline

The source of truth is Postgres. Before a risky data operation:

1. Confirm the current database provider backup snapshot exists.
2. Export a point-in-time backup if the provider supports manual snapshots.
3. Run the operation against a staging or copied database first when practical.
4. Keep import promotions reversible by preserving raw source rows, normalized records, and review decisions.

For v1, do not use Google Sheets as the source of truth. It can be added later as a read-only backup/export layer if needed.
