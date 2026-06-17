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
  fetchMetaLeadFormLeads,
} from '@/lib/messaging/providers/meta.js';
import {
  FACEBOOK_LEAD_ADS_AUTO_PROMOTE_ENV,
  FACEBOOK_LEAD_ADS_FORM_BUSINESS_UNIT_MAP_ENV,
  facebookLeadAdsAutoPromotionEnabled,
  ingestFacebookLeadAdsEvents,
  parseFacebookLeadAdsFormBusinessUnitMap,
} from '@/lib/ingestion/facebook-lead-ads.js';

const BACKFILL_FORM_ID = '1514075503748068';
const BACKFILL_PAGE_ID = '637956449579628';

function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

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

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return jsonError('DATABASE_URL is required before Lead Ads backfill can run.', 503);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

function fieldNames(lead = {}) {
  return (lead.field_data || [])
    .map((field) => String(field?.name || '').trim())
    .filter(Boolean);
}

function fieldValues(lead = {}) {
  return (lead.field_data || []).flatMap((field) => (
    Array.isArray(field?.values) ? field.values.map((value) => String(value || '')) : []
  ));
}

function hasField(lead, names) {
  const wanted = new Set(names);
  return (lead.field_data || []).some((field) => wanted.has(String(field?.name || '').toLowerCase()));
}

function likelyMetaTestLead(lead = {}) {
  const joined = fieldValues(lead).join(' ').toLowerCase();
  return joined.includes('<test lead:') || joined.includes('test@meta.com') || joined.includes(' dummy data');
}

function summarizeLead(lead, existingByLeadgenId) {
  const existing = existingByLeadgenId.get(lead.id);
  return {
    leadgenId: lead.id,
    createdTime: lead.created_time || null,
    formId: lead.form_id || BACKFILL_FORM_ID,
    adIdPresent: Boolean(lead.ad_id),
    fieldNames: fieldNames(lead),
    fieldCount: fieldNames(lead).length,
    hasEmail: hasField(lead, ['email', 'email_address']),
    hasPhone: hasField(lead, ['phone', 'phone_number', 'mobile_phone_number']),
    likelyTest: likelyMetaTestLead(lead),
    alreadyImported: Boolean(existing),
    existingStatus: existing?.status || null,
    existingLeadId: existing?.lead_id || null,
    existingContactId: existing?.contact_id || null,
  };
}

async function existingLeadgenRows(client, leadgenIds) {
  if (!leadgenIds.length) return new Map();
  const result = await client.query(
    `
      select
        proposed_lead_json->>'leadgen_id' as leadgen_id,
        status,
        proposed_lead_json->>'lead_id' as lead_id,
        proposed_contact_json->>'contact_id' as contact_id
      from import_normalized_records
      where proposed_lead_json->>'leadgen_id' = any($1::text[])
    `,
    [leadgenIds],
  );
  return new Map(result.rows.map((row) => [row.leadgen_id, row]));
}

function normalizeMode(value) {
  return String(value || 'dryRun').trim() === 'execute' ? 'execute' : 'dryRun';
}

async function readBody(request) {
  if (!request.body) return {};
  return request.json().catch(() => ({}));
}

function backfillEventFromLead(lead, pageId) {
  return {
    entryId: pageId,
    leadgenId: lead.id || '',
    pageId,
    formId: lead.form_id || BACKFILL_FORM_ID,
    adId: lead.ad_id || '',
    createdTime: lead.created_time || null,
    raw: {
      source: 'facebook_lead_ads_backfill',
      lead: {
        id: lead.id || '',
        created_time: lead.created_time || null,
        form_id: lead.form_id || BACKFILL_FORM_ID,
        ad_id: lead.ad_id || '',
      },
    },
  };
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.IMPORT_REVIEW_WRITE);
  if (error) return error;

  const body = await readBody(request);
  const mode = normalizeMode(body.mode);
  const formId = String(body.formId || BACKFILL_FORM_ID);
  const pageId = String(body.pageId || BACKFILL_PAGE_ID);
  const excludeLikelyTests = body.excludeLikelyTests !== false;
  const requestedLeadgenIds = Array.isArray(body.leadgenIds)
    ? body.leadgenIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  if (formId !== BACKFILL_FORM_ID || pageId !== BACKFILL_PAGE_ID) {
    return jsonError('This backfill endpoint is scoped to the approved Facebook form and Page only.', 403);
  }

  const metaConfig = getMetaProviderConfig();
  const fetched = await fetchMetaLeadFormLeads({ formId, pageId, config: metaConfig });
  if (!fetched.ok) {
    return NextResponse.json({
      ok: false,
      mode,
      error: fetched.reason,
      code: fetched.code,
      graphStatus: fetched.graphStatus || null,
    }, { status: 502 });
  }

  return withClient(async (client) => {
    const leads = fetched.leads || [];
    const existingByLeadgenId = await existingLeadgenRows(client, leads.map((lead) => lead.id).filter(Boolean));
    const summaries = leads
      .map((lead) => summarizeLead(lead, existingByLeadgenId))
      .sort((left, right) => String(left.createdTime || '').localeCompare(String(right.createdTime || '')));
    const importable = summaries.filter((summary) => (
      !summary.alreadyImported
      && (!excludeLikelyTests || !summary.likelyTest)
      && (!requestedLeadgenIds.length || requestedLeadgenIds.includes(summary.leadgenId))
    ));

    if (mode !== 'execute') {
      return NextResponse.json({
        ok: true,
        mode,
        formId,
        pageId,
        totalFromMeta: summaries.length,
        alreadyImported: summaries.filter((summary) => summary.alreadyImported).length,
        likelyTests: summaries.filter((summary) => summary.likelyTest).length,
        importable: importable.length,
        oldestCreatedTime: summaries[0]?.createdTime || null,
        newestCreatedTime: summaries.at(-1)?.createdTime || null,
        leads: summaries,
      });
    }

    const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
    const selectedLeads = importable.map((summary) => leadsById.get(summary.leadgenId)).filter(Boolean);
    const events = selectedLeads.map((lead) => backfillEventFromLead(lead, pageId));

    const result = await ingestFacebookLeadAdsEvents(client, {
      organizationId: session.user.organizationId,
      events,
      metaConfig,
      autoPromote: facebookLeadAdsAutoPromotionEnabled(process.env[FACEBOOK_LEAD_ADS_AUTO_PROMOTE_ENV]),
      formBusinessUnitMap: parseFacebookLeadAdsFormBusinessUnitMap(
        process.env[FACEBOOK_LEAD_ADS_FORM_BUSINESS_UNIT_MAP_ENV],
      ),
      fetchLeadDetails: async ({ leadgenId }) => {
        const lead = leadsById.get(leadgenId);
        return lead ? { ok: true, lead } : { ok: false, reason: 'Lead was not included in fetched backfill payload.' };
      },
    });

    return NextResponse.json({
      ok: true,
      mode,
      formId,
      pageId,
      totalFromMeta: summaries.length,
      requested: requestedLeadgenIds.length || null,
      selected: selectedLeads.length,
      excludedAlreadyImported: summaries.filter((summary) => summary.alreadyImported).length,
      excludedLikelyTests: excludeLikelyTests ? summaries.filter((summary) => summary.likelyTest).length : 0,
      result,
    });
  });
}
