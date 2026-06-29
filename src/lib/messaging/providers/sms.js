import { timingSafeEqual } from 'crypto';
import {
  CONVERSATION_PROVIDERS,
  MESSAGE_DELIVERY_STATUSES,
} from '../../conversations/constants.js';

export const SMS_WEBHOOK_SHARED_SECRET_ENV = 'SMS_WEBHOOK_SHARED_SECRET';
export const SMS_PROVIDER_ENV = 'SMS_PROVIDER';
export const SMS_BUSINESS_UNIT_MAP_ENV = 'SMS_BUSINESS_UNIT_MAP';
export const TELNYX_PUBLIC_KEY_ENV = 'TELNYX_PUBLIC_KEY';
export const TWILIO_AUTH_TOKEN_ENV = 'TWILIO_AUTH_TOKEN';

export const SMS_EVENT_KINDS = Object.freeze({
  INBOUND_MESSAGE: 'inbound_message',
  DELIVERY_STATUS: 'delivery_status',
  IGNORED: 'ignored',
});

const SUPPORTED_SMS_PROVIDERS = new Set([
  CONVERSATION_PROVIDERS.BANDWIDTH,
  CONVERSATION_PROVIDERS.TELNYX,
  CONVERSATION_PROVIDERS.TWILIO,
]);

const TELNYX_DELIVERY_EVENT_STATUS = Object.freeze({
  'message.sent': MESSAGE_DELIVERY_STATUSES.SENT,
  'message.delivered': MESSAGE_DELIVERY_STATUSES.DELIVERED,
  'message.finalized': MESSAGE_DELIVERY_STATUSES.DELIVERED,
  'message.failed': MESSAGE_DELIVERY_STATUSES.FAILED,
});

const TWILIO_DELIVERY_STATUS = Object.freeze({
  accepted: MESSAGE_DELIVERY_STATUSES.PENDING,
  queued: MESSAGE_DELIVERY_STATUSES.PENDING,
  sending: MESSAGE_DELIVERY_STATUSES.PENDING,
  sent: MESSAGE_DELIVERY_STATUSES.SENT,
  delivered: MESSAGE_DELIVERY_STATUSES.DELIVERED,
  undelivered: MESSAGE_DELIVERY_STATUSES.FAILED,
  failed: MESSAGE_DELIVERY_STATUSES.FAILED,
  read: MESSAGE_DELIVERY_STATUSES.READ,
});

const BANDWIDTH_DELIVERY_STATUS = Object.freeze({
  'message-sending': MESSAGE_DELIVERY_STATUSES.PENDING,
  'message-delivered': MESSAGE_DELIVERY_STATUSES.DELIVERED,
  'message-failed': MESSAGE_DELIVERY_STATUSES.FAILED,
  'message-read': MESSAGE_DELIVERY_STATUSES.READ,
});

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

function firstValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function normalizeSmsProvider(value) {
  const provider = cleanLower(value || CONVERSATION_PROVIDERS.TELNYX);
  return SUPPORTED_SMS_PROVIDERS.has(provider) ? provider : '';
}

export function normalizeSmsPhone(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^[A-Za-z][\w.-]*$/.test(text)) return text;
  const digits = text.replace(/\D+/g, '');
  return digits ? `+${digits}` : text;
}

function normalizeDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function parseSmsObjectMap(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function createSmsProviderConfig({
  provider = '',
  webhookSharedSecret = '',
  businessUnitMapRaw = '',
  telnyxPublicKey = '',
  twilioAuthToken = '',
} = {}) {
  return {
    provider: normalizeSmsProvider(provider),
    webhookSharedSecret: cleanText(webhookSharedSecret),
    businessUnitMap: parseSmsObjectMap(businessUnitMapRaw),
    telnyxPublicKey: cleanText(telnyxPublicKey),
    twilioAuthToken: cleanText(twilioAuthToken),
  };
}

export function createSmsProviderConfigFromEnv(env = process.env) {
  return createSmsProviderConfig({
    provider: env[SMS_PROVIDER_ENV],
    webhookSharedSecret: env[SMS_WEBHOOK_SHARED_SECRET_ENV],
    businessUnitMapRaw: env[SMS_BUSINESS_UNIT_MAP_ENV],
    telnyxPublicKey: env[TELNYX_PUBLIC_KEY_ENV],
    twilioAuthToken: env[TWILIO_AUTH_TOKEN_ENV],
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateSmsWebhookSharedSecret({ secretHeader = '', config = {} } = {}) {
  const expected = config.webhookSharedSecret || '';
  if (!expected) {
    return { ok: false, code: 'SMS_WEBHOOK_SECRET_MISSING', reason: `${SMS_WEBHOOK_SHARED_SECRET_ENV} is not configured.` };
  }
  if (!secretHeader || !safeEqual(secretHeader, expected)) {
    return { ok: false, code: 'SMS_WEBHOOK_SECRET_MISMATCH', reason: 'SMS webhook shared secret mismatch.' };
  }
  return { ok: true };
}

function eventId(provider, ...parts) {
  return [provider, ...parts.map((part) => cleanText(part) || 'unknown')].join(':');
}

function textOrAttachment(text, fallback = '[SMS message]') {
  const body = cleanText(text);
  return body || fallback;
}

function telnyxPhone(value) {
  return normalizeSmsPhone(value?.phone_number || value);
}

function telnyxEvent(payload = {}) {
  const data = payload?.data || payload || {};
  const eventType = cleanText(data.event_type || data.eventType);
  const body = data.payload || {};
  const from = telnyxPhone(body.from);
  const to = telnyxPhone(firstValue(body.to));
  const messageId = cleanText(body.id || body.message_id || data.id);
  const occurredAt = normalizeDate(body.received_at || body.sent_at || body.completed_at || data.occurred_at || data.created_at);
  const autoresponseType = cleanText(body.autoresponse_type).toUpperCase();
  const deliveryStatus = cleanLower(body.delivery_status || body.status || firstValue(body.to)?.status);

  if (eventType === 'message.received') {
    return {
      provider: CONVERSATION_PROVIDERS.TELNYX,
      kind: SMS_EVENT_KINDS.INBOUND_MESSAGE,
      eventType,
      eventId: cleanText(data.id) || eventId('telnyx', eventType, messageId),
      messageId,
      providerAccountId: to || cleanText(body.messaging_profile_id) || 'telnyx',
      ownedNumber: to,
      participantPhone: from,
      senderPhone: from,
      recipientPhone: to,
      text: textOrAttachment(body.text),
      consentKeyword: autoresponseType || body.text || '',
      occurredAt,
      raw: payload,
    };
  }

  const mappedStatus = TELNYX_DELIVERY_EVENT_STATUS[eventType]
    || TWILIO_DELIVERY_STATUS[deliveryStatus]
    || MESSAGE_DELIVERY_STATUSES.SENT;
  return {
    provider: CONVERSATION_PROVIDERS.TELNYX,
    kind: SMS_EVENT_KINDS.DELIVERY_STATUS,
    eventType,
    eventId: cleanText(data.id) || eventId('telnyx', eventType, messageId),
    messageId,
    providerAccountId: from || cleanText(body.messaging_profile_id) || 'telnyx',
    ownedNumber: from,
    participantPhone: to,
    senderPhone: from,
    recipientPhone: to,
    deliveryStatus: mappedStatus,
    errorCode: cleanNullableText(body.errors?.[0]?.code || body.error_code),
    errorMessage: cleanNullableText(body.errors?.[0]?.title || body.error_message),
    occurredAt,
    raw: payload,
  };
}

function twilioEvent(payload = {}) {
  const status = cleanLower(payload.MessageStatus || payload.SmsStatus || payload.status);
  const messageId = cleanText(payload.MessageSid || payload.SmsMessageSid || payload.SmsSid);
  const from = normalizeSmsPhone(payload.From);
  const to = normalizeSmsPhone(payload.To);
  const messagingService = cleanText(payload.MessagingServiceSid);
  const account = cleanText(payload.AccountSid);
  const providerAccountId = messagingService || to || account || 'twilio';
  const occurredAt = normalizeDate(payload.Timestamp || payload.timestamp);
  const optOutType = cleanText(payload.OptOutType).toUpperCase();

  if (!status && (payload.Body || payload.NumMedia || optOutType)) {
    return {
      provider: CONVERSATION_PROVIDERS.TWILIO,
      kind: SMS_EVENT_KINDS.INBOUND_MESSAGE,
      eventType: 'message.received',
      eventId: eventId('twilio', 'incoming', messageId),
      messageId,
      providerAccountId,
      ownedNumber: to,
      participantPhone: from,
      senderPhone: from,
      recipientPhone: to,
      text: textOrAttachment(payload.Body, payload.NumMedia ? '[SMS media]' : '[SMS message]'),
      consentKeyword: optOutType || payload.Body || '',
      occurredAt,
      raw: payload,
    };
  }

  return {
    provider: CONVERSATION_PROVIDERS.TWILIO,
    kind: SMS_EVENT_KINDS.DELIVERY_STATUS,
    eventType: status ? `message.${status}` : 'message.status',
    eventId: eventId('twilio', status || 'status', messageId),
    messageId,
    providerAccountId: messagingService || from || account || 'twilio',
    ownedNumber: from,
    participantPhone: to,
    senderPhone: from,
    recipientPhone: to,
    deliveryStatus: TWILIO_DELIVERY_STATUS[status] || MESSAGE_DELIVERY_STATUSES.SENT,
    errorCode: cleanNullableText(payload.ErrorCode),
    errorMessage: cleanNullableText(payload.ErrorMessage),
    occurredAt,
    raw: payload,
  };
}

function bandwidthEvent(callback = {}) {
  const eventType = cleanText(callback.type);
  const message = callback.message || {};
  const messageId = cleanText(message.id);
  const owner = normalizeSmsPhone(message.owner || callback.to);
  const from = normalizeSmsPhone(message.from);
  const to = normalizeSmsPhone(firstValue(message.to) || callback.to);
  const occurredAt = normalizeDate(message.time || callback.eventTime || callback.time);
  const isInbound = eventType === 'message-received';

  if (isInbound) {
    return {
      provider: CONVERSATION_PROVIDERS.BANDWIDTH,
      kind: SMS_EVENT_KINDS.INBOUND_MESSAGE,
      eventType,
      eventId: eventId('bandwidth', eventType, messageId, callback.time),
      messageId,
      providerAccountId: owner || to || cleanText(message.applicationId) || 'bandwidth',
      ownedNumber: owner || to,
      participantPhone: from,
      senderPhone: from,
      recipientPhone: to,
      text: textOrAttachment(message.text || message.content?.text, message.media?.length ? '[SMS media]' : '[SMS message]'),
      consentKeyword: message.text || message.content?.text || '',
      occurredAt,
      raw: callback,
    };
  }

  return {
    provider: CONVERSATION_PROVIDERS.BANDWIDTH,
    kind: SMS_EVENT_KINDS.DELIVERY_STATUS,
    eventType,
    eventId: eventId('bandwidth', eventType, messageId, callback.time),
    messageId,
    providerAccountId: owner || normalizeSmsPhone(message.from) || cleanText(message.applicationId) || 'bandwidth',
    ownedNumber: owner || normalizeSmsPhone(message.from),
    participantPhone: normalizeSmsPhone(firstValue(message.to) || callback.to),
    senderPhone: normalizeSmsPhone(message.from),
    recipientPhone: normalizeSmsPhone(firstValue(message.to) || callback.to),
    deliveryStatus: BANDWIDTH_DELIVERY_STATUS[eventType] || MESSAGE_DELIVERY_STATUSES.SENT,
    errorCode: cleanNullableText(callback.errorCode),
    errorMessage: cleanNullableText(callback.description),
    occurredAt,
    raw: callback,
  };
}

export function flattenSmsProviderEvents(provider, payload = {}) {
  const normalizedProvider = normalizeSmsProvider(provider);
  if (!normalizedProvider) return [];

  if (normalizedProvider === CONVERSATION_PROVIDERS.TELNYX) {
    const events = Array.isArray(payload?.data) ? payload.data.map((data) => ({ data })) : [payload];
    return events.map(telnyxEvent);
  }

  if (normalizedProvider === CONVERSATION_PROVIDERS.TWILIO) {
    return [twilioEvent(payload)];
  }

  if (normalizedProvider === CONVERSATION_PROVIDERS.BANDWIDTH) {
    const callbacks = Array.isArray(payload) ? payload : [payload];
    return callbacks.map(bandwidthEvent);
  }

  return [];
}

export function smsProviderEventKey(event = {}) {
  if (event.eventId) return `${event.provider}:sms-event:${event.eventId}`;
  if (event.messageId && event.kind) return `${event.provider}:sms:${event.kind}:${event.messageId}`;
  return [
    event.provider || 'sms',
    event.kind || 'unknown',
    event.providerAccountId || 'unknown',
    event.participantPhone || 'unknown',
    event.occurredAt instanceof Date ? event.occurredAt.toISOString() : cleanText(event.occurredAt) || 'unknown',
    event.text || event.deliveryStatus || 'event',
  ].join(':');
}

export function resolveSmsBusinessUnitMapping(event = {}, config = {}) {
  const map = config.businessUnitMap || {};
  const candidates = [
    event.providerAccountId,
    event.ownedNumber,
    event.recipientPhone,
    event.senderPhone,
  ].map((value) => cleanText(value)).filter(Boolean);
  for (const candidate of candidates) {
    if (map[candidate]) return { ok: true, businessUnit: map[candidate], source: 'sms_map', matchedKey: candidate };
  }
  return { ok: false, businessUnit: null, source: null, matchedKey: null };
}
