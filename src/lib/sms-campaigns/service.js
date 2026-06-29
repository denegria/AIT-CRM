import {
  SMS_CONSENT_STATUSES,
  evaluateSmsEligibility,
  smsConsentScopeKey,
} from '../communication-consent/sms-consent.js';

export const SMS_CAMPAIGN_STATUSES = Object.freeze({
  DRAFT: 'draft',
  NEEDS_APPROVAL: 'needs_approval',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  LAUNCH_BLOCKED: 'launch_blocked',
  LAUNCHING: 'launching',
  RUNNING: 'running',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const SMS_CAMPAIGN_EVENT_TYPES = Object.freeze({
  CREATED: 'created',
  UPDATED: 'updated',
  PREVIEWED: 'previewed',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  CANCELLED: 'cancelled',
  LAUNCH_BLOCKED: 'launch_blocked',
});

export const SMS_CAMPAIGN_BLOCK_CODES = Object.freeze({
  CAMPAIGN_NOT_APPROVED: 'campaign_not_approved',
  MESSAGE_BODY_MISSING: 'message_body_missing',
  SENDER_MISSING: 'sender_missing',
  PROVIDER_NOT_READY: 'provider_not_ready',
  COMPLIANCE_NOT_READY: 'compliance_not_ready',
  AUDIENCE_EMPTY: 'audience_empty',
  LIVE_SEND_DISABLED: 'live_send_disabled',
});

const FINAL_STATUSES = new Set([
  SMS_CAMPAIGN_STATUSES.CANCELLED,
  SMS_CAMPAIGN_STATUSES.COMPLETED,
  SMS_CAMPAIGN_STATUSES.FAILED,
]);

function cleanText(value) {
  return String(value || '').trim();
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function cleanJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanTextArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(cleanText).filter(Boolean))]
    : [];
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function integerInRange(value, fallback, { min = 1, max = 10000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function normalizeSmsCampaignPhone(value) {
  const text = cleanText(value);
  if (!text) return '';
  const digits = text.replace(/\D+/g, '');
  if (digits.length === 10) return `+1${digits}`;
  return digits ? `+${digits}` : text;
}

export function normalizeSmsCampaignDraft(input = {}) {
  const name = cleanText(input.name);
  const businessUnitId = cleanText(input.businessUnitId);
  const messageBody = cleanText(input.messageBody);
  if (!businessUnitId) throw new Error('Business unit is required for SMS campaigns.');
  if (!name) throw new Error('Campaign name is required.');
  if (!messageBody) throw new Error('Campaign message body is required.');

  return {
    businessUnitId,
    name,
    status: Object.values(SMS_CAMPAIGN_STATUSES).includes(cleanLower(input.status))
      ? cleanLower(input.status)
      : SMS_CAMPAIGN_STATUSES.DRAFT,
    audienceFilterJson: cleanJsonObject(input.audienceFilterJson || input.audienceFilters),
    messageBody,
    senderProvider: cleanLower(input.senderProvider || 'telnyx') || 'telnyx',
    senderAccountId: cleanNullableText(input.senderAccountId),
    sendWindowJson: cleanJsonObject(input.sendWindowJson || input.sendWindow),
    throttlePerHour: integerInRange(input.throttlePerHour, 120, { min: 1, max: 5000 }),
    providerReadinessJson: cleanJsonObject(input.providerReadinessJson || input.providerReadiness),
    complianceReadinessJson: cleanJsonObject(input.complianceReadinessJson || input.complianceReadiness),
    scheduledAt: normalizeDate(input.scheduledAt),
    metadataJson: cleanJsonObject(input.metadataJson),
  };
}

function campaignPayload(row = {}) {
  const providerReadiness = row.provider_readiness_json || row.providerReadinessJson || {};
  const complianceReadiness = row.compliance_readiness_json || row.complianceReadinessJson || {};
  return {
    id: row.id,
    organizationId: row.organization_id || row.organizationId,
    businessUnitId: row.business_unit_id || row.businessUnitId,
    businessUnitName: row.business_unit_name || row.businessUnitName || '',
    name: row.name,
    status: row.status,
    audienceFilterJson: row.audience_filter_json || row.audienceFilterJson || {},
    messageBody: row.message_body || row.messageBody || '',
    senderProvider: row.sender_provider || row.senderProvider || 'telnyx',
    senderAccountId: row.sender_account_id || row.senderAccountId || '',
    sendWindowJson: row.send_window_json || row.sendWindowJson || {},
    throttlePerHour: Number(row.throttle_per_hour || row.throttlePerHour || 0),
    providerReadinessJson: providerReadiness,
    complianceReadinessJson: complianceReadiness,
    approvedByUserId: row.approved_by_user_id || row.approvedByUserId || '',
    approvedAt: isoTimestamp(row.approved_at || row.approvedAt),
    scheduledAt: isoTimestamp(row.scheduled_at || row.scheduledAt),
    launchedAt: isoTimestamp(row.launched_at || row.launchedAt),
    pausedAt: isoTimestamp(row.paused_at || row.pausedAt),
    cancelledAt: isoTimestamp(row.cancelled_at || row.cancelledAt),
    completedAt: isoTimestamp(row.completed_at || row.completedAt),
    createdByUserId: row.created_by_user_id || row.createdByUserId || '',
    updatedByUserId: row.updated_by_user_id || row.updatedByUserId || '',
    metadataJson: row.metadata_json || row.metadataJson || {},
    createdAt: isoTimestamp(row.created_at || row.createdAt),
    updatedAt: isoTimestamp(row.updated_at || row.updatedAt),
  };
}

function isoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function recordSmsCampaignEvent(client, {
  organizationId,
  campaignId,
  eventType,
  fromStatus = null,
  toStatus = null,
  actorUserId = null,
  message = null,
  metadataJson = {},
} = {}) {
  const result = await client.query(
    `
      insert into sms_campaign_events
        (organization_id, campaign_id, event_type, from_status, to_status, actor_user_id, message, metadata_json)
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      returning id
    `,
    [
      cleanText(organizationId),
      cleanText(campaignId),
      cleanText(eventType),
      cleanNullableText(fromStatus),
      cleanNullableText(toStatus),
      cleanNullableText(actorUserId),
      cleanNullableText(message),
      JSON.stringify(cleanJsonObject(metadataJson)),
    ],
  );
  return result.rows[0]?.id || null;
}

export async function createSmsCampaign(client, {
  organizationId,
  actorUserId = null,
  values = {},
} = {}) {
  const draft = normalizeSmsCampaignDraft(values);
  const result = await client.query(
    `
      insert into sms_campaigns (
        organization_id,
        business_unit_id,
        name,
        status,
        audience_filter_json,
        message_body,
        sender_provider,
        sender_account_id,
        send_window_json,
        throttle_per_hour,
        provider_readiness_json,
        compliance_readiness_json,
        scheduled_at,
        created_by_user_id,
        updated_by_user_id,
        metadata_json
      )
      values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16::jsonb)
      returning *
    `,
    [
      cleanText(organizationId),
      draft.businessUnitId,
      draft.name,
      draft.status,
      JSON.stringify(draft.audienceFilterJson),
      draft.messageBody,
      draft.senderProvider,
      draft.senderAccountId,
      JSON.stringify(draft.sendWindowJson),
      draft.throttlePerHour,
      JSON.stringify(draft.providerReadinessJson),
      JSON.stringify(draft.complianceReadinessJson),
      draft.scheduledAt,
      cleanNullableText(actorUserId),
      cleanNullableText(actorUserId),
      JSON.stringify(draft.metadataJson),
    ],
  );
  const campaign = campaignPayload(result.rows[0]);
  await recordSmsCampaignEvent(client, {
    organizationId,
    campaignId: campaign.id,
    eventType: SMS_CAMPAIGN_EVENT_TYPES.CREATED,
    toStatus: campaign.status,
    actorUserId,
    message: 'SMS campaign draft created.',
  });
  return campaign;
}

export async function listSmsCampaigns(client, {
  organizationId,
  businessUnitIds = null,
  limit = 50,
} = {}) {
  const result = await client.query(
    `
      select c.*, bu.name as business_unit_name
      from sms_campaigns c
      left join business_units bu on bu.id = c.business_unit_id
      where c.organization_id = $1
        and ($2::text[] is null or c.business_unit_id::text = any($2::text[]))
      order by c.updated_at desc, c.created_at desc
      limit $3
    `,
    [
      cleanText(organizationId),
      Array.isArray(businessUnitIds) ? businessUnitIds : null,
      integerInRange(limit, 50, { min: 1, max: 200 }),
    ],
  );
  return result.rows.map(campaignPayload);
}

export async function loadSmsCampaign(client, {
  organizationId,
  campaignId,
  businessUnitIds = null,
  lock = false,
} = {}) {
  const result = await client.query(
    `
      select c.*, bu.name as business_unit_name
      from sms_campaigns c
      left join business_units bu on bu.id = c.business_unit_id
      where c.organization_id = $1
        and c.id = $2
        and ($3::text[] is null or c.business_unit_id::text = any($3::text[]))
      limit 1
      ${lock ? 'for update of c' : ''}
    `,
    [cleanText(organizationId), cleanText(campaignId), Array.isArray(businessUnitIds) ? businessUnitIds : null],
  );
  return result.rows[0] ? campaignPayload(result.rows[0]) : null;
}

function contactName(candidate = {}) {
  return cleanText(candidate.contact_name || candidate.contactName || candidate.name) || 'there';
}

export function renderSmsCampaignMessage(template = '', candidate = {}) {
  const message = cleanText(template);
  return message
    .replaceAll('{{name}}', contactName(candidate))
    .replaceAll('{{first_name}}', contactName(candidate).split(/\s+/)[0] || 'there');
}

function candidateContact(candidate = {}) {
  return {
    id: candidate.contact_id || candidate.contactId || candidate.id || '',
    phone: candidate.phone || '',
    isDoNotCall: candidate.is_do_not_call ?? candidate.isDoNotCall,
    isWrongNumber: candidate.is_wrong_number ?? candidate.isWrongNumber,
  };
}

function candidateConsent(candidate = {}) {
  if (!candidate.consent_status && !candidate.consentStatus) return null;
  return {
    consent_status: candidate.consent_status || candidate.consentStatus,
  };
}

export function buildSmsCampaignAudiencePreview(candidates = [], {
  messageBody = '',
  maxRows = 500,
} = {}) {
  const included = [];
  const blocked = [];
  const seenPhones = new Set();
  const rows = Array.isArray(candidates) ? candidates.slice(0, maxRows) : [];

  for (const candidate of rows) {
    const contact = candidateContact(candidate);
    const normalizedPhone = normalizeSmsCampaignPhone(contact.phone);
    const reasons = [];
    const eligibility = evaluateSmsEligibility({
      contact,
      consent: candidateConsent(candidate),
    });
    reasons.push(...eligibility.reasons);
    if (normalizedPhone && seenPhones.has(normalizedPhone)) {
      reasons.push({
        code: 'duplicate_phone',
        message: 'Another recipient in this preview already uses this phone number.',
      });
    }

    const row = {
      contactId: contact.id || null,
      leadId: candidate.lead_id || candidate.leadId || null,
      name: contactName(candidate),
      phone: contact.phone || null,
      normalizedPhone,
      messagePreview: renderSmsCampaignMessage(messageBody, candidate),
      ok: reasons.length === 0,
      reasons,
    };

    if (row.ok) {
      included.push(row);
      seenPhones.add(normalizedPhone);
    } else {
      blocked.push(row);
      if (normalizedPhone) seenPhones.add(normalizedPhone);
    }
  }

  const reasonCounts = {};
  for (const row of blocked) {
    for (const reason of row.reasons) {
      reasonCounts[reason.code] = (reasonCounts[reason.code] || 0) + 1;
    }
  }

  return {
    total: included.length + blocked.length,
    includedCount: included.length,
    blockedCount: blocked.length,
    duplicateCount: reasonCounts.duplicate_phone || 0,
    reasonCounts,
    included,
    blocked,
  };
}

export async function loadSmsCampaignAudienceCandidates(client, {
  organizationId,
  businessUnitId,
  audienceFilterJson = {},
  limit = 500,
} = {}) {
  const filters = cleanJsonObject(audienceFilterJson);
  const leadStatuses = cleanTextArray(filters.leadStatuses);
  const leadStages = cleanTextArray(filters.leadStages);
  const sourceTypes = cleanTextArray(filters.sourceTypes);
  const rowLimit = integerInRange(limit, 500, { min: 1, max: 5000 });
  const result = await client.query(
    `
      select
        c.id::text as contact_id,
        c.name as contact_name,
        c.phone,
        c.is_do_not_call,
        c.is_wrong_number,
        l.id::text as lead_id,
        l.status as lead_status,
        l.current_stage,
        l.source_type,
        consent.consent_status
      from contacts c
      left join lateral (
        select id, status, current_stage, source_type
        from leads l
        where l.organization_id = c.organization_id
          and l.contact_id = c.id
          and l.business_unit_id = c.primary_business_unit_id
        order by l.updated_at desc, l.created_at desc
        limit 1
      ) l on true
      left join lateral (
        select consent_status
        from contact_channel_consents consent
        where consent.organization_id = c.organization_id
          and consent.contact_id = c.id
          and consent.channel = 'sms'
          and consent.scope_key = any($3::text[])
        order by case when consent.scope_key = $4 then 0 else 1 end, consent.updated_at desc
        limit 1
      ) consent on true
      where c.organization_id = $1
        and c.primary_business_unit_id = $2
        and c.archived_at is null
        and ($5::text[] is null or l.status = any($5::text[]))
        and ($6::text[] is null or l.current_stage = any($6::text[]))
        and ($7::text[] is null or l.source_type = any($7::text[]))
      order by c.updated_at desc, c.created_at desc
      limit $8
    `,
    [
      cleanText(organizationId),
      cleanText(businessUnitId),
      [smsConsentScopeKey({ businessUnitId }), smsConsentScopeKey()],
      smsConsentScopeKey({ businessUnitId }),
      leadStatuses.length ? leadStatuses : null,
      leadStages.length ? leadStages : null,
      sourceTypes.length ? sourceTypes : null,
      rowLimit,
    ],
  );
  return result.rows;
}

export async function previewSmsCampaignAudience(client, {
  organizationId,
  campaign = null,
  campaignId = '',
  businessUnitId = '',
  audienceFilterJson = {},
  messageBody = '',
  limit = 500,
} = {}) {
  const resolvedCampaign = campaign || (campaignId ? await loadSmsCampaign(client, { organizationId, campaignId }) : null);
  const resolvedBusinessUnitId = cleanText(businessUnitId || resolvedCampaign?.businessUnitId);
  const resolvedMessageBody = cleanText(messageBody || resolvedCampaign?.messageBody);
  if (!resolvedBusinessUnitId) throw new Error('Business unit is required before previewing a campaign audience.');

  const candidates = await loadSmsCampaignAudienceCandidates(client, {
    organizationId,
    businessUnitId: resolvedBusinessUnitId,
    audienceFilterJson: resolvedCampaign?.audienceFilterJson || audienceFilterJson,
    limit,
  });
  return buildSmsCampaignAudiencePreview(candidates, {
    messageBody: resolvedMessageBody,
    maxRows: limit,
  });
}

export async function replaceSmsCampaignRecipientSnapshot(client, {
  organizationId,
  campaign,
  preview,
} = {}) {
  await client.query('delete from sms_campaign_recipients where organization_id = $1 and campaign_id = $2', [
    campaign.organizationId || organizationId,
    campaign.id,
  ]);

  const rows = [...(preview.included || []), ...(preview.blocked || [])];
  for (const row of rows) {
    await client.query(
      `
        insert into sms_campaign_recipients (
          campaign_id,
          organization_id,
          business_unit_id,
          contact_id,
          lead_id,
          phone,
          normalized_phone,
          eligibility_status,
          blocked_reasons_json,
          message_preview,
          delivery_status,
          provider,
          provider_account_id,
          metadata_json
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'not_queued', $11, $12, $13::jsonb)
      `,
      [
        campaign.id,
        campaign.organizationId || organizationId,
        campaign.businessUnitId,
        row.contactId,
        row.leadId,
        row.phone || '',
        row.normalizedPhone || '',
        row.ok ? 'included' : 'blocked',
        JSON.stringify(row.reasons || []),
        row.messagePreview || '',
        campaign.senderProvider || 'telnyx',
        campaign.senderAccountId || null,
        JSON.stringify({ snapshotSource: 'preview' }),
      ],
    );
  }

  await recordSmsCampaignEvent(client, {
    organizationId: campaign.organizationId || organizationId,
    campaignId: campaign.id,
    eventType: SMS_CAMPAIGN_EVENT_TYPES.PREVIEWED,
    actorUserId: campaign.updatedByUserId || null,
    message: 'SMS campaign audience preview refreshed.',
    metadataJson: {
      total: preview.total,
      includedCount: preview.includedCount,
      blockedCount: preview.blockedCount,
      reasonCounts: preview.reasonCounts,
    },
  });
}

function readinessMissing(readiness = {}, fields = []) {
  return fields.filter((field) => !bool(readiness[field]));
}

export function evaluateSmsCampaignLaunchPolicy({
  campaign,
  preview = null,
  liveSendEnabled = false,
} = {}) {
  const blockers = [];
  const providerReadiness = campaign?.providerReadinessJson || {};
  const complianceReadiness = campaign?.complianceReadinessJson || {};

  if (!campaign || campaign.status !== SMS_CAMPAIGN_STATUSES.APPROVED) {
    blockers.push({
      code: SMS_CAMPAIGN_BLOCK_CODES.CAMPAIGN_NOT_APPROVED,
      message: 'Campaign must be approved before launch.',
    });
  }
  if (!cleanText(campaign?.messageBody)) {
    blockers.push({
      code: SMS_CAMPAIGN_BLOCK_CODES.MESSAGE_BODY_MISSING,
      message: 'Campaign message copy is required before launch.',
    });
  }
  if (!cleanText(campaign?.senderAccountId)) {
    blockers.push({
      code: SMS_CAMPAIGN_BLOCK_CODES.SENDER_MISSING,
      message: 'SMS sender/profile is required before launch.',
    });
  }
  const missingProvider = readinessMissing(providerReadiness, ['providerConfigured', 'callbacksReady', 'senderMapped']);
  if (missingProvider.length) {
    blockers.push({
      code: SMS_CAMPAIGN_BLOCK_CODES.PROVIDER_NOT_READY,
      message: `SMS provider readiness is incomplete: ${missingProvider.join(', ')}.`,
      missing: missingProvider,
    });
  }
  const missingCompliance = readinessMissing(complianceReadiness, [
    'tenDlcRegistered',
    'privacyPolicyReady',
    'termsReady',
    'optInPathApproved',
    'stopHelpCopyApproved',
  ]);
  if (missingCompliance.length) {
    blockers.push({
      code: SMS_CAMPAIGN_BLOCK_CODES.COMPLIANCE_NOT_READY,
      message: `SMS compliance readiness is incomplete: ${missingCompliance.join(', ')}.`,
      missing: missingCompliance,
    });
  }
  if (preview && Number(preview.includedCount || 0) === 0) {
    blockers.push({
      code: SMS_CAMPAIGN_BLOCK_CODES.AUDIENCE_EMPTY,
      message: 'Campaign has no eligible SMS recipients.',
    });
  }
  if (!liveSendEnabled) {
    blockers.push({
      code: SMS_CAMPAIGN_BLOCK_CODES.LIVE_SEND_DISABLED,
      message: 'Live SMS sending is disabled for this slice.',
    });
  }

  return {
    ok: blockers.length === 0,
    blocked: blockers.length > 0,
    blockers,
  };
}

async function updateCampaignStatus(client, {
  organizationId,
  campaign,
  status,
  actorUserId = null,
  eventType,
  message,
  extraSetSql = '',
  extraParams = [],
  metadataJson = {},
} = {}) {
  const params = [
    status,
    cleanNullableText(actorUserId),
    organizationId,
    campaign.id,
    ...extraParams,
  ];
  const result = await client.query(
    `
      update sms_campaigns
      set
        status = $1,
        updated_by_user_id = $2,
        updated_at = now()
        ${extraSetSql}
      where organization_id = $3 and id = $4
      returning *
    `,
    params,
  );
  const updated = campaignPayload(result.rows[0]);
  await recordSmsCampaignEvent(client, {
    organizationId,
    campaignId: campaign.id,
    eventType,
    fromStatus: campaign.status,
    toStatus: updated.status,
    actorUserId,
    message,
    metadataJson,
  });
  return updated;
}

export async function approveSmsCampaign(client, {
  organizationId,
  campaignId,
  actorUserId = null,
} = {}) {
  await client.query('begin');
  try {
    const campaign = await loadSmsCampaign(client, { organizationId, campaignId, lock: true });
    if (!campaign) throw new Error('SMS campaign not found.');
    if (FINAL_STATUSES.has(campaign.status)) throw new Error('Finalized campaigns cannot be approved.');
    const updated = await updateCampaignStatus(client, {
      organizationId,
      campaign,
      status: SMS_CAMPAIGN_STATUSES.APPROVED,
      actorUserId,
      eventType: SMS_CAMPAIGN_EVENT_TYPES.APPROVED,
      message: 'SMS campaign approved.',
      extraSetSql: ', approved_by_user_id = $5, approved_at = now()',
      extraParams: [cleanNullableText(actorUserId)],
    });
    await client.query('commit');
    return updated;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function scheduleSmsCampaign(client, {
  organizationId,
  campaignId,
  actorUserId = null,
  scheduledAt,
} = {}) {
  const scheduledDate = normalizeDate(scheduledAt);
  if (!scheduledDate) throw new Error('A valid scheduled date is required.');
  await client.query('begin');
  try {
    const campaign = await loadSmsCampaign(client, { organizationId, campaignId, lock: true });
    if (!campaign) throw new Error('SMS campaign not found.');
    if (campaign.status !== SMS_CAMPAIGN_STATUSES.APPROVED) throw new Error('Only approved campaigns can be scheduled.');
    const updated = await updateCampaignStatus(client, {
      organizationId,
      campaign,
      status: SMS_CAMPAIGN_STATUSES.SCHEDULED,
      actorUserId,
      eventType: SMS_CAMPAIGN_EVENT_TYPES.SCHEDULED,
      message: 'SMS campaign scheduled.',
      extraSetSql: ', scheduled_at = $5',
      extraParams: [scheduledDate],
      metadataJson: { scheduledAt: scheduledDate.toISOString() },
    });
    await client.query('commit');
    return updated;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function cancelSmsCampaign(client, {
  organizationId,
  campaignId,
  actorUserId = null,
  reason = '',
} = {}) {
  await client.query('begin');
  try {
    const campaign = await loadSmsCampaign(client, { organizationId, campaignId, lock: true });
    if (!campaign) throw new Error('SMS campaign not found.');
    if (FINAL_STATUSES.has(campaign.status)) throw new Error('Campaign is already finalized.');
    const updated = await updateCampaignStatus(client, {
      organizationId,
      campaign,
      status: SMS_CAMPAIGN_STATUSES.CANCELLED,
      actorUserId,
      eventType: SMS_CAMPAIGN_EVENT_TYPES.CANCELLED,
      message: cleanText(reason) || 'SMS campaign cancelled.',
      extraSetSql: ', cancelled_at = now()',
      metadataJson: { reason: cleanText(reason) || null },
    });
    await client.query('commit');
    return updated;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function previewAndSnapshotSmsCampaign(client, {
  organizationId,
  campaignId,
  actorUserId = null,
  limit = 500,
} = {}) {
  await client.query('begin');
  try {
    const campaign = await loadSmsCampaign(client, { organizationId, campaignId, lock: true });
    if (!campaign) throw new Error('SMS campaign not found.');
    const preview = await previewSmsCampaignAudience(client, {
      organizationId,
      campaign,
      limit,
    });
    await replaceSmsCampaignRecipientSnapshot(client, {
      organizationId,
      campaign: { ...campaign, updatedByUserId: actorUserId },
      preview,
    });
    await client.query('commit');
    return { campaign, preview };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function requestSmsCampaignLaunch(client, {
  organizationId,
  campaignId,
  actorUserId = null,
  liveSendEnabled = false,
} = {}) {
  await client.query('begin');
  try {
    const campaign = await loadSmsCampaign(client, { organizationId, campaignId, lock: true });
    if (!campaign) throw new Error('SMS campaign not found.');
    const preview = await previewSmsCampaignAudience(client, {
      organizationId,
      campaign,
    });
    await replaceSmsCampaignRecipientSnapshot(client, {
      organizationId,
      campaign: { ...campaign, updatedByUserId: actorUserId },
      preview,
    });
    const policy = evaluateSmsCampaignLaunchPolicy({
      campaign,
      preview,
      liveSendEnabled,
    });
    if (policy.blocked) {
      const updated = await updateCampaignStatus(client, {
        organizationId,
        campaign,
        status: SMS_CAMPAIGN_STATUSES.LAUNCH_BLOCKED,
        actorUserId,
        eventType: SMS_CAMPAIGN_EVENT_TYPES.LAUNCH_BLOCKED,
        message: 'SMS campaign launch blocked by readiness policy.',
        metadataJson: {
          blockers: policy.blockers,
          preview: {
            includedCount: preview.includedCount,
            blockedCount: preview.blockedCount,
          },
        },
      });
      await client.query('commit');
      return { campaign: updated, preview, policy };
    }

    throw new Error('Live SMS launch is not implemented in this slice.');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {}
    throw error;
  }
}
