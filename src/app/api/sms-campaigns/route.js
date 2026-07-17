import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { sessionHasAdminRole } from '@/lib/auth/admin-policy.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  createSmsCampaignSendConfigFromEnv,
  retrieveTelnyx10dlcPhoneNumberCampaign,
  retrieveTelnyxPhoneNumberMessagingSettings,
  retrieveTelnyxSmsMessage,
  sendTelnyxSmsMessage,
  smsPhoneDiagnostic,
} from '@/lib/messaging/providers/sms.js';
import { externalIoDisabledResponse } from '@/lib/runtime-safety.js';
import {
  approveSmsCampaign,
  cancelSmsCampaign,
  createSmsCampaign,
  listSmsCampaigns,
  loadSmsCampaign,
  previewAndSnapshotSmsCampaign,
  previewSmsCampaignAudience,
  refreshSmsCampaignDeliveryStatuses,
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

function cleanJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function loadLatestTelnyxRecipientDiagnostic(client, { organizationId, campaignId }) {
  const result = await client.query(
    `
      select
        id::text,
        delivery_status,
        provider_message_id,
        metadata_json,
        updated_at
      from sms_campaign_recipients
      where organization_id = $1
        and campaign_id = $2
        and eligibility_status = 'included'
        and provider = 'telnyx'
        and provider_message_id is not null
      order by updated_at desc, created_at desc
      limit 1
    `,
    [organizationId, campaignId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const metadata = cleanJsonObject(row.metadata_json);
  const statusRefresh = cleanJsonObject(metadata.statusRefresh);
  const providerResponse = cleanJsonObject(statusRefresh.providerResponse);
  const mdrData = cleanJsonObject(providerResponse.data);
  const recipient = Array.isArray(mdrData.to) ? mdrData.to[0] || {} : {};
  return {
    recipientId: row.id,
    deliveryStatus: cleanText(row.delivery_status),
    providerMessageId: cleanText(row.provider_message_id),
    providerStatus: cleanText(metadata.providerStatus || mdrData.status || recipient.status),
    mdrMessagingProfileId: cleanText(mdrData.messaging_profile_id),
    mdrRecipientStatus: cleanText(recipient.status),
    mdrRecipientErrorCode: cleanText(recipient.error_code),
    mdrRecipientErrorMessage: cleanText(recipient.error_message),
    mdrRecipientErrorDetail: cleanText(recipient.error_detail),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : cleanText(row.updated_at),
  };
}

function telnyxSenderDiagnosticResponse({
  campaign,
  sendConfig,
  sender,
  recipientDiagnostic,
  senderSettings,
  phoneNumberCampaign,
}) {
  const settings = cleanJsonObject(senderSettings.providerResponse?.data);
  const tenDlc = cleanJsonObject(phoneNumberCampaign.providerResponse?.data);
  const smsFeatures = cleanJsonObject(settings.features?.sms);
  const senderProfileId = cleanText(settings.messaging_profile_id);
  const mdrProfileId = cleanText(recipientDiagnostic?.mdrMessagingProfileId);
  const configuredProfileId = cleanText(sendConfig.telnyxMessagingProfileId);
  const assignmentStatus = cleanText(tenDlc.assignmentStatus).toUpperCase();
  const profileMatchesConfigured = Boolean(configuredProfileId && senderProfileId && configuredProfileId === senderProfileId);
  const profileMatchesMdr = Boolean(senderProfileId && mdrProfileId && senderProfileId === mdrProfileId);
  const tenDlcAssigned = phoneNumberCampaign.ok && assignmentStatus === 'ASSIGNED';

  return {
    provider: 'telnyx',
    campaignId: campaign.id,
    sender: smsPhoneDiagnostic(sender),
    configuredMessagingProfileId: configuredProfileId || null,
    recipientDiagnostic,
    senderMessagingSettings: {
      ok: senderSettings.ok,
      code: senderSettings.code || null,
      reason: senderSettings.reason || null,
      ...senderSettings.providerResponse,
    },
    tenDlcPhoneNumberCampaign: {
      ok: phoneNumberCampaign.ok,
      code: phoneNumberCampaign.code || null,
      reason: phoneNumberCampaign.reason || null,
      ...phoneNumberCampaign.providerResponse,
    },
    checks: {
      apiKeyConfigured: Boolean(sendConfig.telnyxApiKey),
      senderConfigured: Boolean(sender),
      senderMessagingSettingsFound: Boolean(senderSettings.ok),
      domesticSmsTwoWayEnabled: smsFeatures.domestic_two_way === true,
      senderProfileId: senderProfileId || null,
      profileMatchesConfigured,
      mdrMessagingProfileId: mdrProfileId || null,
      profileMatchesMdr,
      messagingProduct: settings.messaging_product || null,
      trafficType: settings.traffic_type || null,
      tenDlcAssigned,
      tenDlcAssignmentStatus: assignmentStatus || null,
      tenDlcFailureReasons: tenDlc.failureReasons || null,
    },
    fixability: {
      canAttemptApiProfileRepair: Boolean(senderSettings.ok && configuredProfileId && senderProfileId && senderProfileId !== configuredProfileId),
      likelyRequiresTelnyxRegistrationOrPortal: Boolean(senderSettings.ok && (!phoneNumberCampaign.ok || !tenDlcAssigned)),
    },
  };
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  if (!sessionHasAdminRole(session)) {
    return NextResponse.json(
      { error: 'SMS campaign management requires administrator access.' },
      { status: 403 },
    );
  }

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
  if (!sessionHasAdminRole(session)) {
    return NextResponse.json(
      { error: 'SMS campaign management requires administrator access.' },
      { status: 403 },
    );
  }

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
        const sendConfig = createSmsCampaignSendConfigFromEnv(process.env);
        const result = await requestSmsCampaignLaunch(client, {
          organizationId: session.user.organizationId,
          campaignId: campaign.id,
          actorUserId: session.user.id,
          liveSendEnabled: sendConfig.liveSendEnabled,
          testSendMode: sendConfig.testSendMode,
          providerSendReady: sendConfig.provider === 'telnyx'
            && Boolean(sendConfig.telnyxApiKey)
            && Boolean(campaign.senderAccountId || sendConfig.telnyxFromNumber)
            && sendConfig.recipientAllowlist.length > 0,
          maxLiveRecipients: sendConfig.maxRecipients,
          allowedRecipientPhones: sendConfig.recipientAllowlist,
          sendSmsMessage: async ({ campaign: launchCampaign, recipient, text }) => sendTelnyxSmsMessage({
            apiKey: sendConfig.telnyxApiKey,
            messagingProfileId: sendConfig.telnyxMessagingProfileId,
            from: launchCampaign.senderAccountId || sendConfig.telnyxFromNumber,
            to: recipient.normalizedPhone || recipient.phone,
            text,
            requestId: `${launchCampaign.id}:${recipient.contactId || recipient.leadId || recipient.normalizedPhone || recipient.phone}`,
          }),
        });
        return NextResponse.json(result, { status: result.policy?.blocked ? 409 : 200 });
      }

      if (action === 'refresh_delivery') {
        const sendConfig = createSmsCampaignSendConfigFromEnv(process.env);
        if (sendConfig.externalIoDisabled) {
          return NextResponse.json(externalIoDisabledResponse(), { status: 503 });
        }
        if (sendConfig.provider !== 'telnyx' || !sendConfig.telnyxApiKey) {
          return NextResponse.json(
            { error: 'Telnyx credentials are required before refreshing SMS delivery status.' },
            { status: 503 },
          );
        }
        const result = await refreshSmsCampaignDeliveryStatuses(client, {
          organizationId: session.user.organizationId,
          campaignId: campaign.id,
          actorUserId: session.user.id,
          retrieveSmsMessage: async ({ messageId }) => retrieveTelnyxSmsMessage({
            apiKey: sendConfig.telnyxApiKey,
            messageId,
          }),
        });
        return NextResponse.json(result);
      }

      if (action === 'diagnose_telnyx_sender') {
        const sendConfig = createSmsCampaignSendConfigFromEnv(process.env);
        if (sendConfig.externalIoDisabled) {
          return NextResponse.json(externalIoDisabledResponse(), { status: 503 });
        }
        const sender = campaign.senderAccountId || sendConfig.telnyxFromNumber;
        if (sendConfig.provider !== 'telnyx' || !sendConfig.telnyxApiKey || !sender) {
          return NextResponse.json(
            { error: 'Telnyx API key and sender number are required before diagnosing sender delivery configuration.' },
            { status: 503 },
          );
        }

        const [recipientDiagnostic, senderSettings, phoneNumberCampaign] = await Promise.all([
          loadLatestTelnyxRecipientDiagnostic(client, {
            organizationId: session.user.organizationId,
            campaignId: campaign.id,
          }),
          retrieveTelnyxPhoneNumberMessagingSettings({
            apiKey: sendConfig.telnyxApiKey,
            phoneNumber: sender,
          }),
          retrieveTelnyx10dlcPhoneNumberCampaign({
            apiKey: sendConfig.telnyxApiKey,
            phoneNumber: sender,
          }),
        ]);

        return NextResponse.json({
          diagnostic: telnyxSenderDiagnosticResponse({
            campaign,
            sendConfig,
            sender,
            recipientDiagnostic,
            senderSettings,
            phoneNumberCampaign,
          }),
        });
      }

      return NextResponse.json({ error: 'Unsupported SMS campaign action.' }, { status: 400 });
    } catch (requestError) {
      return jsonError(requestError);
    }
  });
}
