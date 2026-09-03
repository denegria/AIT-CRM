import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { requirePermission, PERMISSIONS } from '@/lib/auth';
import {
  FB_APP_SECRET_ENV,
  FB_VERIFY_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_MAP_ENV,
  META_PAGE_BUSINESS_UNIT_MAP_ENV,
  META_VERIFY_TOKEN_ENV,
  createMetaProviderConfig,
} from '@/lib/messaging/providers/meta.js';
import {
  applyFacebookLeadAdsRecovery,
  reconcileFacebookLeadAdsFailures,
} from '@/lib/ingestion/facebook-lead-reconciliation.js';

const PAGE_ID = '637956449579628';
const FORM_ID = '2334348260704702';
const SINCE = '2026-08-16T00:00:00.000Z';
const APPLY_CONFIRMATION = 'APPLY_APPROVED_FACEBOOK_RECOVERY_FINAL_FOUR';
const APPROVED_COUNTS = Object.freeze({
  preservedFailureRows: 4,
  graphFetched: 4,
  graphFailed: 0,
  exactExistingContactCandidates: 0,
  conflictingContactPointCandidates: 2,
  possibleManualCandidates: 1,
  ambiguousManualCandidates: 1,
  unmatchedAfterManualScan: 0,
});
const APPROVED_RESOLUTION_COUNTS = Object.freeze({
  create_new_contact_and_opportunity: 3,
  merge_existing_active_opportunity: 1,
});
const APPROVED_DECISIONS = Object.freeze({
  '1369232774807458': Object.freeze({
    kind: 'create_new_contact_and_opportunity',
    forceNewContact: true,
  }),
  '1438296515018091': Object.freeze({
    kind: 'create_new_contact_and_opportunity',
    forceNewContact: true,
  }),
  '1015237171482803': Object.freeze({
    kind: 'merge_existing_active_opportunity',
    existingContactId: 'a687b77f-22ae-4ee8-a878-779c8828cb9f',
    existingLeadId: '210738c8-9170-4c92-ac25-80872dc71488',
  }),
  '2220773902045466': Object.freeze({
    kind: 'create_new_contact_and_opportunity',
    forceNewContact: true,
  }),
});

function getMetaProviderConfig() {
  return createMetaProviderConfig({
    facebookVerifyToken: process.env[FB_VERIFY_TOKEN_ENV],
    metaVerifyToken: process.env[META_VERIFY_TOKEN_ENV],
    appSecret: process.env[FB_APP_SECRET_ENV],
    defaultPageAccessToken: process.env[META_PAGE_ACCESS_TOKEN_ENV],
    pageAccessTokenMapRaw: process.env[META_PAGE_ACCESS_TOKEN_MAP_ENV],
    pageBusinessUnitMapRaw: process.env[META_PAGE_BUSINESS_UNIT_MAP_ENV],
  });
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.IMPORT_REVIEW_WRITE);
  if (error) return error;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is required before reconciliation can run.' }, { status: 503 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const manifest = await reconcileFacebookLeadAdsFailures(client, {
      organizationId: session.user.organizationId,
      pageId: PAGE_ID,
      formId: FORM_ID,
      since: SINCE,
      metaConfig: getMetaProviderConfig(),
    });
    return NextResponse.json({ ok: manifest.totals.graphFailed === 0, ...manifest }, {
      status: manifest.totals.graphFailed === 0 ? 200 : 502,
    });
  } finally {
    await client.end();
  }
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.IMPORT_REVIEW_WRITE);
  if (error) return error;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is required before recovery can run.' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.confirmation !== APPLY_CONFIRMATION || typeof body.approvalManifestHash !== 'string') {
    return NextResponse.json({
      error: 'The exact recovery confirmation and approval manifest hash are required.',
    }, { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await applyFacebookLeadAdsRecovery(client, {
      organizationId: session.user.organizationId,
      pageId: PAGE_ID,
      formId: FORM_ID,
      since: SINCE,
      metaConfig: getMetaProviderConfig(),
    }, {
      expectedApprovalManifestHash: body.approvalManifestHash,
      expectedCounts: APPROVED_COUNTS,
      expectedResolutionCounts: APPROVED_RESOLUTION_COUNTS,
      approvedDecisions: APPROVED_DECISIONS,
      actorUserId: session.user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (recoveryError) {
    if (String(recoveryError?.code || '').startsWith('FACEBOOK_RECOVERY_')) {
      return NextResponse.json({
        ok: false,
        code: recoveryError.code,
        error: recoveryError.message,
      }, { status: 409 });
    }
    throw recoveryError;
  } finally {
    await client.end();
  }
}
