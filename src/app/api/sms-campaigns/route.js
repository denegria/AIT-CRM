import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { isUuid } from '@/lib/crm/validation.js';
import {
  approveSmsCampaign,
  cancelSmsCampaign,
  createSmsCampaign,
  listSmsCampaigns,
  loadSmsCampaign,
  previewAndSnapshotSmsCampaign,
  previewSmsCampaignAudience,
  requestSmsCampaignLaunch,
  scheduleSmsCampaign,
} from '@/lib/sms-campaigns/service.js';

function cleanText(value) {
  return String(value || '').trim();
}

function jsonError(error, fallback = 'SMS campaign request failed.') {
  return NextResponse.json(
    { error: error.message || fallback },
    { status: error.status || 400 },
  );
}

function scopedBusinessUnitIds(session) {
  if (session.user.canAccessAllBusinessUnits) return null;
  return session.user.businessUnitIds || [];
}

function canAccessBusinessUnit(session, businessUnitId) {
  if (session.user.canAccessAllBusinessUnits) return true;
  return (session.user.businessUnitIds || []).includes(businessUnitId);
}

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is required before SMS campaigns can run.' }, { status: 503 });
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function assertBusinessUnitAccess(client, session, businessUnitId) {
  const id = cleanText(businessUnitId);
  if (!isUuid(id)) {
    const error = new Error('A valid business unit id is required.');
    error.status = 400;
    throw error;
  }
  const result = await client.query(
    `
      select id
      from business_units
      where organization_id = $1 and id = $2 and is_active = true
      limit 1
    `,
    [session.user.organizationId, id],
  );
  if (!result.rows[0]?.id) {
    const error = new Error('Business unit not found.');
    error.status = 404;
    throw error;
  }
  if (!canAccessBusinessUnit(session, id)) {
    const error = new Error('Insufficient business-unit access.');
    error.status = 403;
    throw error;
  }
  return id;
}

async function assertCampaignAccess(client, session, campaignId) {
  const id = cleanText(campaignId);
  if (!isUuid(id)) {
    const error = new Error('A valid SMS campaign id is required.');
    error.status = 400;
    throw error;
  }
  const campaign = await loadSmsCampaign(client, {
    organizationId: session.user.organizationId,
    campaignId: id,
    businessUnitIds: scopedBusinessUnitIds(session),
  });
  if (!campaign) {
    const error = new Error('SMS campaign not found.');
    error.status = 404;
    throw error;
  }
  return campaign;
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const requestedBusinessUnitId = cleanText(searchParams.get('businessUnitId'));

  return withClient(async (client) => {
    try {
      let businessUnitIds = scopedBusinessUnitIds(session);
      if (requestedBusinessUnitId) {
        await assertBusinessUnitAccess(client, session, requestedBusinessUnitId);
        businessUnitIds = [requestedBusinessUnitId];
      }
      const campaigns = await listSmsCampaigns(client, {
        organizationId: session.user.organizationId,
        businessUnitIds,
        limit: Number(searchParams.get('limit') || 50),
      });
      return NextResponse.json({ campaigns });
    } catch (requestError) {
      return jsonError(requestError);
    }
  });
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const action = cleanText(body.action || 'create').toLowerCase();

  return withClient(async (client) => {
    try {
      if (action === 'create') {
        await assertBusinessUnitAccess(client, session, body.businessUnitId);
        const campaign = await createSmsCampaign(client, {
          organizationId: session.user.organizationId,
          actorUserId: session.user.id,
          values: body,
        });
        return NextResponse.json({ campaign }, { status: 201 });
      }

      if (action === 'preview_draft') {
        await assertBusinessUnitAccess(client, session, body.businessUnitId);
        const preview = await previewSmsCampaignAudience(client, {
          organizationId: session.user.organizationId,
          businessUnitId: body.businessUnitId,
          audienceFilterJson: body.audienceFilterJson || body.audienceFilters || {},
          messageBody: body.messageBody,
          limit: Number(body.limit || 500),
        });
        return NextResponse.json({ preview });
      }

      const campaign = await assertCampaignAccess(client, session, body.campaignId);

      if (action === 'preview') {
        const preview = await previewSmsCampaignAudience(client, {
          organizationId: session.user.organizationId,
          campaign,
          limit: Number(body.limit || 500),
        });
        return NextResponse.json({ campaign, preview });
      }

      if (action === 'snapshot') {
        const result = await previewAndSnapshotSmsCampaign(client, {
          organizationId: session.user.organizationId,
          campaignId: campaign.id,
          actorUserId: session.user.id,
          limit: Number(body.limit || 500),
        });
        return NextResponse.json(result);
      }

      if (action === 'approve') {
        const updated = await approveSmsCampaign(client, {
          organizationId: session.user.organizationId,
          campaignId: campaign.id,
          actorUserId: session.user.id,
        });
        return NextResponse.json({ campaign: updated });
      }

      if (action === 'schedule') {
        const updated = await scheduleSmsCampaign(client, {
          organizationId: session.user.organizationId,
          campaignId: campaign.id,
          actorUserId: session.user.id,
          scheduledAt: body.scheduledAt,
        });
        return NextResponse.json({ campaign: updated });
      }

      if (action === 'cancel') {
        const updated = await cancelSmsCampaign(client, {
          organizationId: session.user.organizationId,
          campaignId: campaign.id,
          actorUserId: session.user.id,
          reason: body.reason,
        });
        return NextResponse.json({ campaign: updated });
      }

      if (action === 'launch') {
        const result = await requestSmsCampaignLaunch(client, {
          organizationId: session.user.organizationId,
          campaignId: campaign.id,
          actorUserId: session.user.id,
          liveSendEnabled: false,
        });
        return NextResponse.json(result, { status: result.policy?.blocked ? 409 : 200 });
      }

      return NextResponse.json({ error: 'Unsupported SMS campaign action.' }, { status: 400 });
    } catch (requestError) {
      return jsonError(requestError);
    }
  });
}
