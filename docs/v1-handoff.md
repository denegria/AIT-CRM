# AIT CRM V1 Handoff

This is the short operating guide for the V1 handoff. V1 is for daily CRM operations, AIT Signs import review, work order tracking, and verified lead ingestion. It is not the full automation/accounting/file-storage platform yet.

## Daily Operator Workflow

1. Open the dashboard and scan new leads, active work orders, and pending operational work.
2. Use Contacts to search, filter, and update lead/customer records.
3. Use the pipeline view to move leads through the V1 stages: New Lead, Contacted, Qualified, Proposal Sent, Won, and Lost.
4. Open contact detail before outreach. Check notes, source, activity timeline, work orders, and visible website/import details.
5. Add notes after calls, messages, meetings, or manual follow-up so the next operator does not need outside context.
6. Use Work Orders for production/install tracking. Financials and Reports remain limited V1/admin surfaces, not the accounting source of truth.

## Import Review Workflow

Import review protects production data. Staging rows are inspected and approved before they become live CRM records.

1. Load or refresh AIT Signs staging rows:

    DATABASE_URL="<production-or-staging-url>" npm run db:load-ait-signs-staging

2. Review counts before approving rows:

    DATABASE_URL="<production-or-staging-url>" npm run db:review-ait-signs-staging summary
    DATABASE_URL="<production-or-staging-url>" npm run db:review-ait-signs-staging samples --limit 20

3. Review the queue in the app at /import-review, or approve/reject exact rows from the CLI:

    DATABASE_URL="<production-or-staging-url>" npm run db:review-ait-signs-staging approve-row --sheet "Sheet Name" --row 123 --reason "clean match"
    DATABASE_URL="<production-or-staging-url>" npm run db:review-ait-signs-staging reject-row --sheet "Sheet Name" --row 123 --reason "bad match"

4. Leave ambiguous rows in needs_review. Do not force a bad merge just to clear the queue.
5. Run a dry-run promotion before writing production records:

    DATABASE_URL="<production-or-staging-url>" npm run db:promote-ait-signs-staging --dry-run

6. Promote only approved rows:

    DATABASE_URL="<production-or-staging-url>" npm run db:promote-ait-signs-staging

## Website Lead Ingestion

The live website lead endpoint is POST /api/webhooks/website-leads.

The endpoint accepts the shared secret as Authorization: Bearer <secret>, x-ait-webhook-secret, or a body field with that key. Wix Automations can send a top-level data object; the CRM unwraps it.

Expected lead fields include sourceKey, sourceName, name, email, phone, message, address, age, externalId, submittedAt, and optional businessUnit or division. The endpoint redacts secret values from import/audit storage.

AIT USA Wix lead ingestion is V1-ready. AIT Signs WordPress/Divi lead ingestion is parked until the public form stack is stable and owned.

## V1 Boundaries

- QuickBooks remains the accounting source of truth.
- Financials and Reports are limited/admin surfaces in V1.
- Files and attachments require object storage setup, such as Cloudflare R2 or another S3-compatible bucket, before implementation can be completed.
- WordPress/Divi ingestion is post-V1 unless the form stack is replaced or renewed before handoff.
- Automated outbound follow-up is post-V1 until templates, opt-in posture, owner routing, and stop conditions are approved.

## Production Support Checklist

Run before handoff or after a risky change:

    npm run lint
    npm run build
    SKIP_META_VALID_TOKEN=1 npm run diagnose:production

The diagnostic is repository/HTTP-only and cannot establish production readiness. With production env available, run the mandatory full check:

    node --env-file=.env.production.local scripts/verify-production-readiness.mjs
    npm run verify:rbac

`SKIP_DB=1` is forbidden for the authoritative production check. It must prove the approved production URL authority and connected Neon project, branch, database, catalog, and journal.

For bad data reports, capture the contact/lead name, email/phone, business unit, source, source row or external id, and what field looks wrong.
