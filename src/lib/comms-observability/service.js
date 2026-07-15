import { createHash } from 'crypto';
import {
  SMS_BUSINESS_UNIT_MAP_ENV,
  SMS_PROVIDER_ENV,
  SMS_WEBHOOK_SHARED_SECRET_ENV,
  TELNYX_PUBLIC_KEY_ENV,
  TWILIO_AUTH_TOKEN_ENV,
  parseSmsObjectMap,
} from '../messaging/providers/sms.js';
import {
  FB_APP_SECRET_ENV,
  FB_VERIFY_TOKEN_ENV,
  META_APP_SECRET_ENV,
  META_PAGE_ACCESS_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_MAP_ENV,
  META_PAGE_BUSINESS_UNIT_MAP_ENV,
  META_VERIFY_TOKEN_ENV,
  META_WHATSAPP_ACCESS_TOKEN_ENV,
  META_WHATSAPP_ACCESS_TOKEN_MAP_ENV,
  META_WHATSAPP_BUSINESS_UNIT_MAP_ENV,
  WHATSAPP_APP_SECRET_ENV,
  WHATSAPP_VERIFY_TOKEN_ENV,
  parseMetaObjectMap,
} from '../messaging/providers/meta.js';

const META_CHANNELS = ['messenger', 'whatsapp'];
const SMS_CHANNELS = ['sms'];
const CHANNELS = [...META_CHANNELS, ...SMS_CHANNELS];
const META_PROVIDER = 'meta';
const SMS_PROVIDERS = ['telnyx', 'twilio', 'bandwidth'];
const PROVIDERS = [META_PROVIDER, ...SMS_PROVIDERS];
const RECENT_LIMIT = 12;

function cleanText(value) {
  return String(value || '').trim();
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function bool(value) {
  return Boolean(value);
}

function numberValue(value) {
  return Number(value || 0);
}

function isoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function rowCount(row, key = 'count') {
  return numberValue(row?.[key]);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

export function redactIdentifier(value, { prefixLength = 4, suffixLength = 4 } = {}) {
  const text = cleanText(value);
  if (!text) return '';
  if (text.length <= prefixLength + suffixLength) return `${'*'.repeat(Math.max(4, text.length))}`;
  return `${text.slice(0, prefixLength)}...${text.slice(-suffixLength)}`;
}

export function stableRedactedHash(value) {
  const text = cleanText(value);
  if (!text) return '';
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function parseMapSummary(raw) {
  const parsed = parseMetaObjectMap(raw || '');
  return {
    configured: Boolean(raw),
    validJson: !raw || Object.keys(parsed).length > 0,
    entryCount: Object.keys(parsed).length,
    keys: Object.keys(parsed).slice(0, 8).map((key) => ({
      redacted: redactIdentifier(key),
      hash: stableRedactedHash(key),
    })),
  };
}

function parseSmsMapSummary(raw) {
  const parsed = parseSmsObjectMap(raw || '');
  return {
    configured: Boolean(raw),
    validJson: !raw || Object.keys(parsed).length > 0,
    entryCount: Object.keys(parsed).length,
    keys: Object.keys(parsed).slice(0, 8).map((key) => ({
      redacted: redactIdentifier(key),
      hash: stableRedactedHash(key),
    })),
  };
}

function envPresent(env, ...names) {
  return names.some((name) => Boolean(env?.[name]));
}

export function buildProviderConfigDiagnostics(env = process.env) {
  const messengerTokenMap = parseMapSummary(env[META_PAGE_ACCESS_TOKEN_MAP_ENV]);
  const whatsappTokenMap = parseMapSummary(env[META_WHATSAPP_ACCESS_TOKEN_MAP_ENV]);
  const pageBuMap = parseMapSummary(env[META_PAGE_BUSINESS_UNIT_MAP_ENV]);
  const whatsappBuMap = parseMapSummary(env[META_WHATSAPP_BUSINESS_UNIT_MAP_ENV]);

  const webhook = {
    verifyTokenConfigured: envPresent(env, META_VERIFY_TOKEN_ENV, FB_VERIFY_TOKEN_ENV, WHATSAPP_VERIFY_TOKEN_ENV),
    appSecretConfigured: envPresent(env, META_APP_SECRET_ENV, FB_APP_SECRET_ENV, WHATSAPP_APP_SECRET_ENV),
  };
  const messenger = {
    defaultAccessTokenConfigured: envPresent(env, META_PAGE_ACCESS_TOKEN_ENV),
    mappedAccessTokens: messengerTokenMap,
    businessUnitMap: pageBuMap,
  };
  const whatsapp = {
    defaultAccessTokenConfigured: envPresent(env, META_WHATSAPP_ACCESS_TOKEN_ENV),
    mappedAccessTokens: whatsappTokenMap,
    businessUnitMap: whatsappBuMap,
  };
  const smsBusinessUnitMap = parseSmsMapSummary(env[SMS_BUSINESS_UNIT_MAP_ENV]);
  const sms = {
    provider: cleanLower(env[SMS_PROVIDER_ENV] || 'telnyx'),
    webhookSharedSecretConfigured: envPresent(env, SMS_WEBHOOK_SHARED_SECRET_ENV),
    telnyxPublicKeyConfigured: envPresent(env, TELNYX_PUBLIC_KEY_ENV),
    twilioAuthTokenConfigured: envPresent(env, TWILIO_AUTH_TOKEN_ENV),
    businessUnitMap: smsBusinessUnitMap,
  };

  return {
    webhook,
    messenger,
    whatsapp,
    sms,
    blockers: [
      !webhook.verifyTokenConfigured ? providerBlock('webhook_verify_token_missing', 'Meta webhook verify token is not configured.') : null,
      !webhook.appSecretConfigured ? providerBlock('webhook_app_secret_missing', 'Meta webhook signature app secret is not configured.') : null,
      !messenger.defaultAccessTokenConfigured && messengerTokenMap.entryCount === 0
        ? providerBlock('messenger_access_token_missing', 'Messenger outbound requires a default or mapped page access token.')
        : null,
      !whatsapp.defaultAccessTokenConfigured && whatsappTokenMap.entryCount === 0
        ? providerBlock('whatsapp_access_token_missing', 'WhatsApp outbound requires a default or mapped access token.')
        : null,
      whatsappBuMap.entryCount === 0
        ? providerBlock('whatsapp_business_unit_map_missing', 'WhatsApp inbound should be routed by phone number id or display number before live traffic.')
        : null,
      !sms.webhookSharedSecretConfigured
        ? providerBlock('sms_webhook_secret_missing', 'SMS webhook shared secret is not configured for staging/provider callback ingestion.')
        : null,
      smsBusinessUnitMap.entryCount === 0
        ? providerBlock('sms_business_unit_map_missing', 'SMS inbound should be routed by sender/profile/number before live traffic.')
        : null,
    ].filter(Boolean),
  };
}

function providerBlock(code, message) {
  return { code, message };
}

function blockedReasonList(value) {
  const reasons = cleanText(value);
  if (!reasons) return [];
  return reasons.split(',').map((reason) => cleanLower(reason)).filter(Boolean);
}

function templateBlockedReasons(row) {
  const reasons = [];
  const channel = cleanLower(row.channel || 'all');
  if (!row.is_enabled) reasons.push('template_disabled');
  if (cleanLower(row.status) !== 'active') reasons.push('template_not_active');
  if ((channel === 'whatsapp' || channel === 'all') && cleanLower(row.provider_status) !== 'approved') {
    reasons.push('template_not_approved');
  }
  return reasons;
}

function settingBlockedReasons(row) {
  if (!row) return ['channel_setting_missing'];
  return row.is_enabled ? [] : ['channel_disabled'];
}

function scopedSettingSummary(rows = []) {
  const enabledCount = rows.filter((row) => row.is_enabled).length;
  return {
    enabled: enabledCount > 0,
    blockers: rows.length ? (enabledCount > 0 ? [] : ['channel_disabled']) : ['channel_setting_missing'],
    scopedCount: rows.length,
    enabledScopedCount: enabledCount,
    lastUpdatedAt: isoTimestamp(rows.reduce((latest, row) => {
      if (!row.updated_at) return latest;
      if (!latest) return row.updated_at;
      return new Date(row.updated_at).getTime() > new Date(latest).getTime() ? row.updated_at : latest;
    }, null)),
  };
}

function normalizeErrorCode(value, fallback = 'provider_error') {
  const code = cleanLower(value);
  if (!code || code === 'none' || code === 'unknown') return fallback;
  return code;
}

function classifyProviderError(code, hasMessage = false) {
  const normalized = normalizeErrorCode(code, hasMessage ? 'provider_error' : 'unknown');
  if (normalized.includes('rate') || normalized.includes('throttl')) return 'rate_limited';
  if (normalized.includes('auth') || normalized.includes('token') || normalized.includes('permission')) return 'auth_or_permission';
  if (normalized.includes('template')) return 'template';
  if (normalized.includes('recipient') || normalized.includes('window') || normalized.includes('phone')) return 'recipient_or_window';
  return 'provider_rejected';
}

function channelConfigStatus(row) {
  const active = rowCount(row, 'active_count');
  const inactive = rowCount(row, 'inactive_count');
  if (active > 0 && inactive === 0) return 'ready';
  if (active > 0 && inactive > 0) return 'mixed';
  if (inactive > 0) return 'inactive';
  return 'missing';
}

function groupRowsByChannel(rows = []) {
  const grouped = Object.fromEntries(CHANNELS.map((channel) => [channel, []]));
  for (const row of rows) {
    const channel = cleanLower(row.channel);
    if (grouped[channel]) grouped[channel].push(row);
  }
  return grouped;
}

function groupedStatusCounts(rows = [], statusKey = 'status') {
  return rows.map((row) => ({
    status: cleanLower(row[statusKey] || 'unknown'),
    count: rowCount(row),
    lastAt: isoTimestamp(row.last_at),
  }));
}

function businessUnitScopeParam(businessUnitIds) {
  return Array.isArray(businessUnitIds) ? businessUnitIds : null;
}

async function query(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows || [];
}

async function loadInboundDiagnostics(client, { organizationId, businessUnitIds }) {
  const scope = businessUnitScopeParam(businessUnitIds);
  const [summaryRows, recentRows, channelRows] = await Promise.all([
    query(client, `
      select
        channel,
        provider,
        delivery_status,
        count(*)::int as count,
        count(distinct idempotency_key)::int as distinct_idempotency_keys,
        max(occurred_at) as last_at
      from conversation_messages
      where organization_id = $1
        and provider = any($4::text[])
        and channel = any($2::text[])
        and direction = 'inbound'
        and ($3::text[] is null or business_unit_id is null or business_unit_id::text = any($3::text[]))
      group by channel, provider, delivery_status
      order by channel, provider, delivery_status
    `, [organizationId, CHANNELS, scope, PROVIDERS]),
    query(client, `
      select
        id,
        business_unit_id,
        channel,
        provider,
        provider_account_id,
        external_message_id,
        idempotency_key,
        delivery_status,
        occurred_at,
        created_at
      from conversation_messages
      where organization_id = $1
        and provider = any($5::text[])
        and channel = any($2::text[])
        and direction = 'inbound'
        and ($3::text[] is null or business_unit_id is null or business_unit_id::text = any($3::text[]))
      order by occurred_at desc
      limit $4
    `, [organizationId, CHANNELS, scope, RECENT_LIMIT, PROVIDERS]),
    query(client, `
      select
        channel,
        provider,
        count(*) filter (where is_active = true)::int as active_count,
        count(*) filter (where is_active = false)::int as inactive_count,
        max(updated_at) as last_at
      from conversation_channels
      where organization_id = $1
        and provider = any($4::text[])
        and channel = any($2::text[])
        and ($3::text[] is null or business_unit_id is null or business_unit_id::text = any($3::text[]))
      group by channel, provider
    `, [organizationId, CHANNELS, scope, PROVIDERS]),
  ]);

  const channelConfigs = Object.fromEntries(CHANNELS.map((channel) => {
    const row = channelRows.find((entry) => cleanLower(entry.channel) === channel);
    return [channel, {
      status: channelConfigStatus(row),
      activeCount: rowCount(row, 'active_count'),
      inactiveCount: rowCount(row, 'inactive_count'),
      lastUpdatedAt: isoTimestamp(row?.last_at),
    }];
  }));

  return {
    byStatus: groupRowsByChannel(summaryRows),
    channelConfigs,
    recent: recentRows.map((row) => compactObject({
      id: row.id,
      businessUnitId: row.business_unit_id,
      channel: cleanLower(row.channel),
      provider: cleanLower(row.provider),
      providerAccount: {
        redacted: redactIdentifier(row.provider_account_id),
        hash: stableRedactedHash(row.provider_account_id),
      },
      externalMessageId: redactIdentifier(row.external_message_id),
      idempotencyKeyHash: stableRedactedHash(row.idempotency_key),
      deliveryStatus: cleanLower(row.delivery_status),
      occurredAt: isoTimestamp(row.occurred_at),
      createdAt: isoTimestamp(row.created_at),
    })),
  };
}

async function loadManualOutboundDiagnostics(client, { organizationId, businessUnitIds }) {
  const scope = businessUnitScopeParam(businessUnitIds);
  const [summaryRows, errorRows, recentRows] = await Promise.all([
    query(client, `
      select
        channel,
        provider,
        delivery_status,
        count(*)::int as count,
        max(updated_at) as last_at
      from conversation_messages
      where organization_id = $1
        and provider = any($4::text[])
        and channel = any($2::text[])
        and direction = 'outbound'
        and raw_payload_json->>'source' = 'manual_outbound'
        and ($3::text[] is null or business_unit_id is null or business_unit_id::text = any($3::text[]))
      group by channel, provider, delivery_status
      order by channel, provider, delivery_status
    `, [organizationId, CHANNELS, scope, PROVIDERS]),
    query(client, `
      select
        channel,
        provider,
        coalesce(nullif(error_code, ''), 'provider_error') as error_code,
        count(*)::int as count,
        max(updated_at) as last_at
      from conversation_messages
      where organization_id = $1
        and provider = any($4::text[])
        and channel = any($2::text[])
        and direction = 'outbound'
        and raw_payload_json->>'source' = 'manual_outbound'
        and delivery_status = 'failed'
        and ($3::text[] is null or business_unit_id is null or business_unit_id::text = any($3::text[]))
      group by channel, provider, coalesce(nullif(error_code, ''), 'provider_error')
      order by count desc, error_code
    `, [organizationId, CHANNELS, scope, PROVIDERS]),
    query(client, `
      select
        id,
        business_unit_id,
        channel,
        provider,
        delivery_status,
        provider_account_id,
        external_message_id,
        idempotency_key,
        error_code,
        (error_message is not null and nullif(error_message, '') is not null) as has_error_message,
        occurred_at,
        updated_at
      from conversation_messages
      where organization_id = $1
        and provider = any($5::text[])
        and channel = any($2::text[])
        and direction = 'outbound'
        and raw_payload_json->>'source' = 'manual_outbound'
        and delivery_status in ('pending', 'failed')
        and ($3::text[] is null or business_unit_id is null or business_unit_id::text = any($3::text[]))
      order by updated_at desc
      limit $4
    `, [organizationId, CHANNELS, scope, RECENT_LIMIT, PROVIDERS]),
  ]);

  return {
    byStatus: groupRowsByChannel(summaryRows),
    failures: errorRows.map((row) => ({
      channel: cleanLower(row.channel),
      provider: cleanLower(row.provider),
      code: normalizeErrorCode(row.error_code),
      classifier: classifyProviderError(row.error_code, true),
      count: rowCount(row),
      lastAt: isoTimestamp(row.last_at),
    })),
    pendingOrFailed: recentRows.map((row) => compactObject({
      id: row.id,
      businessUnitId: row.business_unit_id,
      channel: cleanLower(row.channel),
      provider: cleanLower(row.provider),
      deliveryStatus: cleanLower(row.delivery_status),
      providerAccount: {
        redacted: redactIdentifier(row.provider_account_id),
        hash: stableRedactedHash(row.provider_account_id),
      },
      externalMessageId: redactIdentifier(row.external_message_id),
      idempotencyKeyHash: stableRedactedHash(row.idempotency_key),
      error: row.error_code || row.has_error_message ? {
        code: normalizeErrorCode(row.error_code, row.has_error_message ? 'provider_error' : 'unknown'),
        classifier: classifyProviderError(row.error_code, row.has_error_message),
        hasProviderDetail: bool(row.has_error_message),
      } : null,
      occurredAt: isoTimestamp(row.occurred_at),
      updatedAt: isoTimestamp(row.updated_at),
    })),
  };
}

async function loadTemplateDiagnostics(client, { organizationId, businessUnitIds }) {
  const scope = businessUnitScopeParam(businessUnitIds);
  const [templateRows, settingRows] = await Promise.all([
    query(client, `
      select
        id,
        business_unit_id,
        channel,
        purpose,
        display_name,
        status,
        provider_status,
        is_enabled,
        updated_at
      from message_templates
      where organization_id = $1
        and ($2::text[] is null or business_unit_id is null or business_unit_id::text = any($2::text[]))
      order by channel, purpose, display_name
    `, [organizationId, scope]),
    query(client, `
      select
        id,
        business_unit_id,
        scope_key,
        intake_route_key,
        channel,
        is_enabled,
        updated_at
      from message_channel_settings
      where organization_id = $1
        and ($2::text[] is null or business_unit_id is null or business_unit_id::text = any($2::text[]))
      order by channel, scope_key
    `, [organizationId, scope]),
  ]);

  const settingsByChannel = Object.fromEntries(CHANNELS.map((channel) => {
    const rows = settingRows.filter((row) => cleanLower(row.channel) === channel);
    const orgDefault = rows.find((row) => !row.business_unit_id && row.intake_route_key === 'default') || null;
    const effectiveScoped = scopedSettingSummary(rows);
    return [channel, {
      organizationDefault: orgDefault ? {
        id: orgDefault.id,
        enabled: bool(orgDefault.is_enabled),
        blockers: settingBlockedReasons(orgDefault),
        lastUpdatedAt: isoTimestamp(orgDefault.updated_at),
      } : {
        enabled: false,
        blockers: ['channel_setting_missing'],
        lastUpdatedAt: null,
      },
      effectiveScoped,
      scopedCount: rows.length,
      enabledScopedCount: rows.filter((row) => row.is_enabled).length,
    }];
  }));

  const templates = templateRows.map((row) => ({
    id: row.id,
    businessUnitId: row.business_unit_id || '',
    channel: cleanLower(row.channel || 'all'),
    purpose: cleanLower(row.purpose),
    displayName: cleanText(row.display_name),
    status: cleanLower(row.status),
    providerStatus: cleanLower(row.provider_status),
    enabled: bool(row.is_enabled),
    blockers: templateBlockedReasons(row),
    lastUpdatedAt: isoTimestamp(row.updated_at),
  }));

  return {
    settings: settingsByChannel,
    templates,
    summary: {
      total: templates.length,
      enabled: templates.filter((template) => template.enabled).length,
      blocked: templates.filter((template) => template.blockers.length).length,
      whatsappApproved: templates.filter((template) => (
        (template.channel === 'whatsapp' || template.channel === 'all')
        && template.providerStatus === 'approved'
      )).length,
    },
  };
}

async function loadFollowUpDiagnostics(client, { organizationId, businessUnitIds }) {
  const scope = businessUnitScopeParam(businessUnitIds);
  const [enrollmentRows, runRows, blockerRows, recentRunRows] = await Promise.all([
    query(client, `
      select
        status,
        channel,
        count(*)::int as count,
        min(next_step_due_at) as next_due_at,
        max(updated_at) as last_at
      from follow_up_sequence_enrollments
      where organization_id = $1
        and ($2::text[] is null or business_unit_id::text = any($2::text[]))
      group by status, channel
      order by status, channel
    `, [organizationId, scope]),
    query(client, `
      select
        status,
        count(*)::int as count,
        max(updated_at) as last_at
      from follow_up_sequence_step_runs
      where organization_id = $1
        and ($2::text[] is null or business_unit_id::text = any($2::text[]))
      group by status
      order by status
    `, [organizationId, scope]),
    query(client, `
      select
        coalesce(nullif(blocked_reason, ''), 'none') as blocked_reason,
        count(*)::int as count,
        max(updated_at) as last_at
      from follow_up_sequence_step_runs
      where organization_id = $1
        and status = 'blocked'
        and ($2::text[] is null or business_unit_id::text = any($2::text[]))
      group by coalesce(nullif(blocked_reason, ''), 'none')
      order by count desc, blocked_reason
    `, [organizationId, scope]),
    query(client, `
      select
        id,
        business_unit_id,
        sequence_id,
        enrollment_id,
        step_id,
        contact_id,
        lead_id,
        task_id,
        status,
        blocked_reason,
        due_at,
        executed_at,
        created_at,
        updated_at
      from follow_up_sequence_step_runs
      where organization_id = $1
        and ($2::text[] is null or business_unit_id::text = any($2::text[]))
      order by created_at desc
      limit $3
    `, [organizationId, scope, RECENT_LIMIT]),
  ]);

  return {
    enrollments: enrollmentRows.map((row) => ({
      status: cleanLower(row.status),
      channel: cleanLower(row.channel),
      count: rowCount(row),
      nextDueAt: isoTimestamp(row.next_due_at),
      lastAt: isoTimestamp(row.last_at),
    })),
    runs: groupedStatusCounts(runRows),
    blockers: blockerRows.map((row) => ({
      codes: blockedReasonList(row.blocked_reason),
      count: rowCount(row),
      lastAt: isoTimestamp(row.last_at),
    })),
    recentRuns: recentRunRows.map((row) => ({
      id: row.id,
      businessUnitId: row.business_unit_id,
      sequenceId: row.sequence_id,
      enrollmentId: row.enrollment_id,
      stepId: row.step_id,
      contactId: row.contact_id,
      leadId: row.lead_id,
      taskId: row.task_id,
      status: cleanLower(row.status),
      blockedReasons: blockedReasonList(row.blocked_reason),
      dueAt: isoTimestamp(row.due_at),
      executedAt: isoTimestamp(row.executed_at),
      createdAt: isoTimestamp(row.created_at),
      updatedAt: isoTimestamp(row.updated_at),
    })),
  };
}

async function loadContactBlockers(client, { organizationId, businessUnitIds }) {
  const scope = businessUnitScopeParam(businessUnitIds);
  const rows = await query(client, `
    select
      count(*) filter (where is_do_not_call = true)::int as dnc_count,
      count(*) filter (where is_wrong_number = true)::int as wrong_number_count,
      count(*) filter (where is_do_not_call = true or is_wrong_number = true)::int as blocked_count
    from contacts
    where organization_id = $1
      and ($2::text[] is null or primary_business_unit_id is null or primary_business_unit_id::text = any($2::text[]))
  `, [organizationId, scope]);
  const row = rows[0] || {};
  return {
    doNotCall: rowCount(row, 'dnc_count'),
    wrongNumber: rowCount(row, 'wrong_number_count'),
    blockedContacts: rowCount(row, 'blocked_count'),
  };
}

export async function buildCommsObservabilitySnapshot(client, {
  organizationId,
  businessUnitIds = null,
  env = process.env,
  now = new Date(),
} = {}) {
  const [
    inbound,
    manualOutbound,
    templates,
    followUps,
    contactBlockers,
  ] = await Promise.all([
    loadInboundDiagnostics(client, { organizationId, businessUnitIds }),
    loadManualOutboundDiagnostics(client, { organizationId, businessUnitIds }),
    loadTemplateDiagnostics(client, { organizationId, businessUnitIds }),
    loadFollowUpDiagnostics(client, { organizationId, businessUnitIds }),
    loadContactBlockers(client, { organizationId, businessUnitIds }),
  ]);

  return {
    generatedAt: isoTimestamp(now),
    scope: {
      organizationId,
      businessUnitIds: businessUnitScopeParam(businessUnitIds),
    },
    providerConfig: buildProviderConfigDiagnostics(env),
    contactBlockers,
    inbound,
    manualOutbound,
    templates,
    followUps,
    notes: [
      'Provider identifiers are redacted and hashed for operational correlation.',
      'Message bodies, raw payloads, tokens, and webhook secrets are intentionally omitted.',
      'Inbound duplicate provider events are expected to collapse through idempotency keys before new message rows are created.',
      'Follow-up runs create review tasks/drafts only; autoSendEnabled remains false.',
    ],
  };
}
