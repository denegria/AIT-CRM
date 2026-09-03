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
import { reconcileFacebookLeadAdsFailures } from '@/lib/ingestion/facebook-lead-reconciliation.js';

const PAGE_ID = '637956449579628';
const FORM_ID = '2334348260704702';
const SINCE = '2026-08-16T00:00:00.000Z';

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
