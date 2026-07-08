import { randomUUID } from 'crypto';
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_PROVIDERS,
  MESSAGE_DELIVERY_STATUSES,
} from './constants.js';
import {
  manualOutboundConversationMessageInput,
  recordConversationMessage,
  updateConversationMessageDeliveryStatus,
} from './service.js';
import {
  MESSAGE_TEMPLATE_CHANNELS,
  MESSAGE_TEMPLATE_PROVIDER_STATUSES,
  MESSAGE_TEMPLATE_PURPOSES,
  MESSAGE_TEMPLATE_STATUSES,
} from '../message-templates/constants.js';
import {
  resolveMetaPageAccessToken,
  resolveMetaWhatsAppAccessToken,
  sendMetaMessengerTextMessage,
  sendMetaWhatsAppTemplateMessage,
  sendMetaWhatsAppTextMessage,
} from '../messaging/providers/meta.js';
import { normalizeSmsPhone, sendTelnyxSmsMessage } from '../messaging/providers/sms.js';
import {
  SMS_CONSENT_STATUSES,
  loadSmsConsentForContact,
} from '../communication-consent/sms-consent.js';

export const MANUAL_OUTBOUND_BLOCK_CODES = Object.freeze({
  CHANNEL_UNSUPPORTED: 'channel_unsupported',
  CHANNEL_CONFIG_MISSING: 'channel_config_missing',
  CHANNEL_CONFIG_INACTIVE: 'channel_config_inactive',
  CONTACT_BLOCKED: 'contact_blocked',
  MESSAGE_BODY_MISSING: 'message_body_missing',
  PROVIDER_CONFIG_MISSING: 'provider_config_missing',
  CHANNEL_SETTING_MISSING: 'channel_setting_missing',
  CHANNEL_DISABLED: 'channel_disabled',
  QUIET_HOURS: 'quiet_hours',
  RECIPIENT_MISSING: 'recipient_missing',
  SERVICE_WINDOW_CLOSED: 'service_window_closed',
  TEMPLATE_REQUIRED: 'template_required',
  TEMPLATE_NOT_FOUND: 'template_not_found',
  TEMPLATE_NOT_ENABLED: 'template_not_enabled',
  TEMPLATE_NOT_APPROVED: 'template_not_approved',
  TEMPLATE_PROVIDER_NAME_MISSING: 'template_provider_name_missing',
  SMS_SEND_DISABLED: 'sms_send_disabled',
  SMS_RECIPIENT_NOT_ALLOWLISTED: 'sms_recipient_not_allowlisted',
  SMS_OPTED_OUT: 'sms_opted_out',
});

const SUPPORTED_CHANNELS = new Set([
  CONVERSATION_CHANNELS.MESSENGER,
  CONVERSATION_CHANNELS.SMS,
  CONVERSATION_CHANNELS.WHATSAPP,
]);

const DEFAULT_SERVICE_WINDOW_HOURS = 24;

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

function manualChannelScopeKey({ businessUnitId = null, intakeRouteKey = 'default' } = {}) {
  const routeKey = cleanText(intakeRouteKey) || 'default';
  const unitId = cleanNullableText(businessUnitId);
  return unitId ? `business_unit:${unitId}:route:${routeKey}` : `organization:route:${routeKey}`;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursSince(value, now = new Date()) {
  const date = normalizeDate(value);
  if (!date) return Infinity;
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function quietHoursWindow(settingsJson = {}) {
  const quietHours = settingsJson.quietHours && typeof settingsJson.quietHours === 'object'
    ? settingsJson.quietHours
    : {};
  return {
    enabled: quietHours.enabled !== false,
    startHour: Number.isInteger(quietHours.startHour) ? quietHours.startHour : 20,
    endHour: Number.isInteger(quietHours.endHour) ? quietHours.endHour : 8,
  };
}

export function isWithinQuietHours({ now = new Date(), settingsJson = {} } = {}) {
  const quietHours = quietHoursWindow(settingsJson);
  if (!quietHours.enabled) return false;
  const hour = now.getUTCHours();
  const start = Math.max(0, Math.min(23, quietHours.startHour));
  const end = Math.max(0, Math.min(23, quietHours.endHour));
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function normalizeManualOutboundRequest(input = {}) {
  const channel = cleanLower(input.channel);
  const textBody = cleanText(input.textBody || input.text || '');
  const templateId = cleanNullableText(input.templateId);
  return {
    channel,
    textBody,
    templateId,
    requestId: cleanText(input.requestId) || randomUUID(),
  };
}

export function renderManualTemplateBody(bodyText = '', variables = {}) {
  return String(bodyText || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  }).trim();
}

function block(code, message) {
  return { code, message };
}

function metadataJson(row = {}) {
  return row.metadata_json || row.metadataJson || row.settings_json || row.settingsJson || {};
}

function isServiceWindowOpen(conversation, now) {
  return hoursSince(conversation?.last_inbound_at || conversation?.lastInboundAt, now) <= DEFAULT_SERVICE_WINDOW_HOURS;
}

function hasPriorInboundMessage(conversation) {
  return Boolean(normalizeDate(conversation?.last_inbound_at || conversation?.lastInboundAt));
}

function hasConversationRecipient({ conversation, channel, smsConfig = {} } = {}) {
  if (!conversation?.external_participant_id || !conversation?.provider_thread_id || !hasPriorInboundMessage(conversation)) {
    return false;
  }
  if (channel === CONVERSATION_CHANNELS.SMS) {
    return Boolean(conversation.provider_account_id || smsConfig.telnyxFromNumber);
  }
  return Boolean(conversation.provider_account_id);
}

function isSmsRecipientAllowlisted(conversation = {}, smsConfig = {}) {
  const allowlist = Array.isArray(smsConfig.recipientAllowlist)
    ? smsConfig.recipientAllowlist.map(normalizeSmsPhone).filter(Boolean)
    : [];
  if (!allowlist.length) return true;
  return allowlist.includes(normalizeSmsPhone(conversation.external_participant_id));
}

function templateMatchesChannel(template, channel) {
  return template.channel === channel || template.channel === MESSAGE_TEMPLATE_CHANNELS.ALL;
}

function templateProviderName(template) {
  const metadata = metadataJson(template);
  return cleanText(metadata.providerTemplateName || metadata.metaTemplateName || metadata.whatsappTemplateName);
}

function templateLanguageCode(template) {
  const metadata = metadataJson(template);
  return cleanText(metadata.languageCode || metadata.locale || 'en_US') || 'en_US';
}

function canUseTemplate(template, channel) {
  if (!template) {
    return block(MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_NOT_FOUND, 'Template not found for this organization and channel.');
  }
  if (
    template.status !== MESSAGE_TEMPLATE_STATUSES.ACTIVE
    || !template.is_enabled
    || !templateMatchesChannel(template, channel)
  ) {
    return block(MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_NOT_ENABLED, 'Template must be active, enabled, and match this channel.');
  }
  if (
    channel === CONVERSATION_CHANNELS.WHATSAPP
    && template.provider_status !== MESSAGE_TEMPLATE_PROVIDER_STATUSES.APPROVED
  ) {
    return block(MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_NOT_APPROVED, 'WhatsApp templates must be provider approved before sending.');
  }
  return null;
}

export function evaluateManualOutboundGuardrails({
  contact,
  conversation,
  channelSetting,
  template = null,
  context = {},
  smsConsent = null,
  request,
  metaConfig = {},
  smsConfig = {},
  now = new Date(),
} = {}) {
  const reasons = [];
  const channel = request?.channel;

  if (!SUPPORTED_CHANNELS.has(channel)) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.CHANNEL_UNSUPPORTED, 'Manual sending supports Messenger, SMS, and WhatsApp only.'));
  }
  if (contact?.is_do_not_call || contact?.isDoNotCall || contact?.is_wrong_number || contact?.isWrongNumber) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.CONTACT_BLOCKED, 'Contact is marked do-not-call or wrong number.'));
  }
  if (!request?.templateId && !cleanText(request?.textBody)) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.MESSAGE_BODY_MISSING, 'Message text or an approved template is required.'));
  }
  if (!channelSetting) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.CHANNEL_SETTING_MISSING, 'Channel settings must be configured before manual sends.'));
  } else if (!channelSetting.is_enabled) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.CHANNEL_DISABLED, 'Manual sends are disabled for this channel and scope.'));
  }
  if (conversation && !conversation.channel_id) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.CHANNEL_CONFIG_MISSING, 'Conversation must be linked to an active channel configuration before sending.'));
  } else if (conversation?.channel_is_active === false) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.CHANNEL_CONFIG_INACTIVE, 'Conversation channel configuration is inactive.'));
  }
  if (channelSetting && isWithinQuietHours({ now, settingsJson: metadataJson(channelSetting) })) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.QUIET_HOURS, 'Manual sends are blocked during configured quiet hours.'));
  }
  if (!hasConversationRecipient({ conversation, channel, smsConfig })) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.RECIPIENT_MISSING, 'A prior inbound conversation is required to identify the recipient safely.'));
  } else if (channel === CONVERSATION_CHANNELS.MESSENGER) {
    const token = resolveMetaPageAccessToken(conversation.provider_account_id, metaConfig);
    if (!token.ok) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.PROVIDER_CONFIG_MISSING, token.reason || 'Messenger provider token is missing.'));
    }
  } else if (channel === CONVERSATION_CHANNELS.WHATSAPP) {
    const token = resolveMetaWhatsAppAccessToken(conversation.provider_account_id, metaConfig);
    if (!token.ok) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.PROVIDER_CONFIG_MISSING, token.reason || 'WhatsApp provider token is missing.'));
    }
  } else if (channel === CONVERSATION_CHANNELS.SMS) {
    const resolvedSmsConsent = smsConsent || context.smsConsent || null;
    const smsConsentStatus = cleanLower(resolvedSmsConsent?.consent_status || resolvedSmsConsent?.consentStatus);
    if (smsConsentStatus === SMS_CONSENT_STATUSES.OPTED_OUT) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.SMS_OPTED_OUT, 'Contact has opted out of SMS.'));
    }
    if (conversation?.provider !== CONVERSATION_PROVIDERS.TELNYX) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.CHANNEL_CONFIG_MISSING, 'SMS manual sends require a Telnyx conversation.'));
    }
    if (!smsConfig.telnyxApiKey) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.PROVIDER_CONFIG_MISSING, 'TELNYX_API_KEY is required before SMS manual sends.'));
    }
    if (!conversation?.provider_account_id && !smsConfig.telnyxFromNumber) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.PROVIDER_CONFIG_MISSING, 'A Telnyx sender number is required before SMS manual sends.'));
    }
    if (!smsConfig.liveSendEnabled && !smsConfig.testSendMode) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.SMS_SEND_DISABLED, 'Live SMS sending is disabled for this slice.'));
    }
    if (!isSmsRecipientAllowlisted(conversation, smsConfig)) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.SMS_RECIPIENT_NOT_ALLOWLISTED, 'SMS recipient is not in the staging send allowlist.'));
    }
  }

  const hasTemplate = Boolean(request?.templateId);
  const serviceWindowOpen = isServiceWindowOpen(conversation, now);
  if (!serviceWindowOpen && channel === CONVERSATION_CHANNELS.MESSENGER) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.SERVICE_WINDOW_CLOSED, 'Messenger manual sends require an open 24-hour service window.'));
  }
  if (!serviceWindowOpen && channel === CONVERSATION_CHANNELS.WHATSAPP && !hasTemplate) {
    reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_REQUIRED, 'WhatsApp sends outside the 24-hour service window require an approved template.'));
  }
  if (hasTemplate) {
    const templateBlock = canUseTemplate(template, channel);
    if (templateBlock) reasons.push(templateBlock);
    if (channel === CONVERSATION_CHANNELS.WHATSAPP && template && !templateProviderName(template)) {
      reasons.push(block(MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_PROVIDER_NAME_MISSING, 'WhatsApp template metadata must include providerTemplateName.'));
    }
  }

  return {
    ok: reasons.length === 0,
    blocked: reasons.length > 0,
    reasons,
    serviceWindowOpen,
  };
}

async function findChannelSetting(client, { organizationId, businessUnitId, channel }) {
  const scopeKeys = [
    businessUnitId ? manualChannelScopeKey({ businessUnitId, intakeRouteKey: 'default' }) : null,
    manualChannelScopeKey({ businessUnitId: null, intakeRouteKey: 'default' }),
  ].filter(Boolean);
  const result = await client.query(
    `
      select id, business_unit_id, scope_key, intake_route_key, channel, is_enabled, settings_json
      from message_channel_settings
      where organization_id = $1
        and channel = $2
        and scope_key = any($3::text[])
      order by case when business_unit_id is not null then 0 else 1 end
      limit 1
    `,
    [organizationId, channel, scopeKeys],
  );
  return result.rows[0] || null;
}

async function findLatestConversation(client, { organizationId, contactId, channel, businessUnitIds = null }) {
  const result = await client.query(
    `
      select
        conv.id,
        conv.business_unit_id,
        conv.contact_id,
        conv.lead_id,
        conv.channel_id,
        conv.channel,
        conv.provider,
        conv.provider_account_id,
        conv.provider_thread_id,
        conv.external_participant_id,
        conv.status,
        conv.last_message_at,
        cc.is_active as channel_is_active,
        max(cm.occurred_at) filter (where cm.direction = 'inbound') as last_inbound_at
      from conversations conv
      left join conversation_channels cc on cc.id = conv.channel_id
      left join conversation_messages cm on cm.conversation_id = conv.id
      where conv.organization_id = $1
        and conv.contact_id = $2
        and conv.channel = $3
        and conv.provider = $5
        and ($4::text[] is null or conv.business_unit_id is null or conv.business_unit_id::text = any($4::text[]))
      group by conv.id, cc.is_active
      order by max(cm.occurred_at) filter (where cm.direction = 'inbound') desc nulls last, conv.last_message_at desc nulls last
      limit 1
    `,
    [
      organizationId,
      contactId,
      channel,
      Array.isArray(businessUnitIds) ? businessUnitIds : null,
      channel === CONVERSATION_CHANNELS.SMS ? CONVERSATION_PROVIDERS.TELNYX : CONVERSATION_PROVIDERS.META,
    ],
  );
  return result.rows[0] || null;
}

async function findTemplate(client, {
  organizationId,
  templateId,
  channel,
  businessUnitId = null,
  businessUnitIds = null,
}) {
  if (!templateId) return null;
  const result = await client.query(
    `
      select id, business_unit_id, channel, purpose, display_name, body_text, status, provider_status, is_enabled, metadata_json
      from message_templates
      where id = $1
        and organization_id = $2
        and purpose = $3
        and channel in ($4, $5)
        and (
          business_unit_id is null
          or business_unit_id = $6
          or ($7::text[] is not null and business_unit_id::text = any($7::text[]))
        )
      limit 1
    `,
    [
      templateId,
      organizationId,
      MESSAGE_TEMPLATE_PURPOSES.MANUAL_FOLLOW_UP,
      channel,
      MESSAGE_TEMPLATE_CHANNELS.ALL,
      businessUnitId,
      Array.isArray(businessUnitIds) ? businessUnitIds : null,
    ],
  );
  return result.rows[0] || null;
}

export async function loadManualOutboundContext(client, {
  organizationId,
  contact,
  channel,
  templateId = null,
  businessUnitIds = null,
}) {
  const businessUnitId = contact.primaryBusinessUnitId || contact.primary_business_unit_id || null;
  const [conversation, channelSetting, template, smsConsent] = await Promise.all([
    findLatestConversation(client, {
      organizationId,
      contactId: contact.id,
      channel,
      businessUnitIds,
    }),
    findChannelSetting(client, { organizationId, businessUnitId, channel }),
    findTemplate(client, {
      organizationId,
      templateId,
      channel,
      businessUnitId,
      businessUnitIds,
    }),
    channel === CONVERSATION_CHANNELS.SMS
      ? loadSmsConsentForContact(client, {
        organizationId,
        contactId: contact.id,
        businessUnitId,
      })
      : Promise.resolve(null),
  ]);

  return { conversation, channelSetting, template, smsConsent };
}

function manualTemplateVariables(contact = {}) {
  return {
    contact_name: contact.name || '',
    name: contact.name || '',
    company_name: contact.companyName || contact.company_name || '',
  };
}

function sendTextForRequest({ request, template, contact }) {
  if (template) return renderManualTemplateBody(template.body_text, manualTemplateVariables(contact));
  return request.textBody;
}

async function dispatchProviderSend({
  request,
  conversation,
  template,
  text,
  metaConfig,
  smsConfig,
  fetchImpl,
}) {
  if (request.channel === CONVERSATION_CHANNELS.MESSENGER) {
    return sendMetaMessengerTextMessage({
      pageId: conversation.provider_account_id,
      recipientId: conversation.external_participant_id,
      text,
      config: metaConfig,
      fetchImpl,
    });
  }

  if (request.channel === CONVERSATION_CHANNELS.SMS) {
    return sendTelnyxSmsMessage({
      apiKey: smsConfig.telnyxApiKey,
      messagingProfileId: smsConfig.telnyxMessagingProfileId,
      from: conversation.provider_account_id || smsConfig.telnyxFromNumber,
      to: conversation.external_participant_id,
      text,
      requestId: request.requestId,
      fetchImpl,
    });
  }

  if (template) {
    return sendMetaWhatsAppTemplateMessage({
      phoneNumberId: conversation.provider_account_id,
      recipientWaId: conversation.external_participant_id,
      templateName: templateProviderName(template),
      languageCode: templateLanguageCode(template),
      config: metaConfig,
      fetchImpl,
    });
  }

  return sendMetaWhatsAppTextMessage({
    phoneNumberId: conversation.provider_account_id,
    recipientWaId: conversation.external_participant_id,
    text,
    config: metaConfig,
    fetchImpl,
  });
}

function manualOutboundDuplicateResult(recorded) {
  const failed = recorded.deliveryStatus === MESSAGE_DELIVERY_STATUSES.FAILED;
  return {
    ok: !failed,
    duplicate: true,
    status: recorded.deliveryStatus,
    conversationId: recorded.conversationId,
    messageId: recorded.messageId,
    providerMessageId: recorded.externalMessageId || null,
    error: failed ? {
      code: recorded.errorCode,
      message: recorded.errorMessage,
    } : null,
    audit: { ok: true },
  };
}

export async function sendManualOutboundMessage(client, {
  organizationId,
  actorUserId,
  contact,
  request,
  context,
  metaConfig,
  smsConfig = {},
  fetchImpl = globalThis.fetch,
  now = new Date(),
}) {
  const text = sendTextForRequest({ request, template: context.template, contact });
  const message = manualOutboundConversationMessageInput({
    organizationId,
    businessUnitId: context.conversation.business_unit_id || contact.primaryBusinessUnitId || contact.primary_business_unit_id || null,
    contactId: contact.id,
    leadId: context.conversation.lead_id || null,
    channelId: context.conversation.channel_id || null,
    provider: context.conversation.provider || (
      request.channel === CONVERSATION_CHANNELS.SMS
        ? CONVERSATION_PROVIDERS.TELNYX
        : CONVERSATION_PROVIDERS.META
    ),
    channel: request.channel,
    providerAccountId: context.conversation.provider_account_id,
    providerThreadId: context.conversation.provider_thread_id,
    externalParticipantId: context.conversation.external_participant_id,
    senderIdentity: context.conversation.provider_account_id,
    recipientIdentity: context.conversation.external_participant_id,
    text,
    requestId: request.requestId,
    raw: {
      source: 'manual_outbound',
      actorUserId,
      templateId: context.template?.id || null,
      serviceWindowHours: DEFAULT_SERVICE_WINDOW_HOURS,
      requestedAt: now.toISOString(),
    },
    occurredAt: now,
  });
  const pending = await recordConversationMessage(client, message, {
    preserveExistingOnConflict: true,
  });

  if (!pending.inserted) {
    return manualOutboundDuplicateResult(pending);
  }

  const providerResult = await dispatchProviderSend({
    request,
    conversation: context.conversation,
    template: context.template,
    text,
    metaConfig,
    smsConfig,
    fetchImpl,
  });

  const status = providerResult.ok ? MESSAGE_DELIVERY_STATUSES.SENT : MESSAGE_DELIVERY_STATUSES.FAILED;
  let audit = { ok: true };
  try {
    const updated = await updateConversationMessageDeliveryStatus(client, {
      organizationId,
      messageId: pending.messageId,
      deliveryStatus: status,
      externalMessageId: providerResult.providerMessageId || null,
      rawPayloadJson: providerResult.providerResponse || providerResult.graphError || {},
      errorCode: providerResult.ok ? null : providerResult.code,
      errorMessage: providerResult.ok ? null : providerResult.reason,
    });
    if (!updated) {
      audit = {
        ok: false,
        code: 'audit_update_missing',
        message: 'Provider send completed, but the outbound audit row was not updated.',
      };
    }
  } catch (error) {
    audit = {
      ok: false,
      code: 'audit_update_failed',
      message: error?.message || 'Provider send completed, but the outbound audit update failed.',
    };
  }

  return {
    ok: providerResult.ok,
    status,
    duplicate: false,
    conversationId: pending.conversationId,
    messageId: pending.messageId,
    providerMessageId: providerResult.providerMessageId || null,
    error: providerResult.ok ? null : {
      code: providerResult.code,
      message: providerResult.reason,
    },
    audit,
  };
}
