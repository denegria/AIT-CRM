import { createHmac, timingSafeEqual } from 'crypto';

export const FB_VERIFY_TOKEN_ENV = 'FACEBOOK_WEBHOOK_VERIFY_TOKEN';
export const META_VERIFY_TOKEN_ENV = 'META_WEBHOOK_VERIFY_TOKEN';
export const FB_APP_SECRET_ENV = 'FACEBOOK_APP_SECRET';
export const META_APP_SECRET_ENV = 'META_APP_SECRET';
export const WHATSAPP_VERIFY_TOKEN_ENV = 'WHATSAPP_WEBHOOK_VERIFY_TOKEN';
export const WHATSAPP_APP_SECRET_ENV = 'WHATSAPP_APP_SECRET';
export const META_PAGE_ACCESS_TOKEN_ENV = 'META_PAGE_ACCESS_TOKEN';
export const META_PAGE_ACCESS_TOKEN_MAP_ENV = 'META_PAGE_ACCESS_TOKEN_MAP';
export const META_PAGE_BUSINESS_UNIT_MAP_ENV = 'META_PAGE_BUSINESS_UNIT_MAP';
export const META_WHATSAPP_BUSINESS_UNIT_MAP_ENV = 'META_WHATSAPP_BUSINESS_UNIT_MAP';
export const META_WHATSAPP_ACCESS_TOKEN_ENV = 'META_WHATSAPP_ACCESS_TOKEN';
export const META_WHATSAPP_ACCESS_TOKEN_MAP_ENV = 'META_WHATSAPP_ACCESS_TOKEN_MAP';
export const META_GRAPH_API_VERSION = 'v24.0';
export const META_PAGE_ACCESS_TOKEN_MISSING_REASON = `${META_PAGE_ACCESS_TOKEN_ENV} or ${META_PAGE_ACCESS_TOKEN_MAP_ENV} missing`;
export const META_WHATSAPP_ACCESS_TOKEN_MISSING_REASON = `${META_WHATSAPP_ACCESS_TOKEN_ENV} or ${META_WHATSAPP_ACCESS_TOKEN_MAP_ENV} missing`;

export function parseMetaObjectMap(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseMetaPageAccessTokenMap(raw) {
  return parseMetaObjectMap(raw);
}

export function parseMetaPageBusinessUnitMap(raw) {
  return parseMetaObjectMap(raw);
}

export function parseMetaWhatsAppBusinessUnitMap(raw) {
  return parseMetaObjectMap(raw);
}

export function parseMetaWhatsAppAccessTokenMap(raw) {
  return parseMetaObjectMap(raw);
}

export function createMetaProviderConfig({
  facebookVerifyToken = '',
  whatsappVerifyToken = '',
  metaVerifyToken = '',
  appSecret = '',
  defaultPageAccessToken = '',
  pageAccessTokenMapRaw = '',
  pageBusinessUnitMapRaw = '',
  whatsappBusinessUnitMapRaw = '',
  defaultWhatsAppAccessToken = '',
  whatsappAccessTokenMapRaw = '',
  graphApiVersion = META_GRAPH_API_VERSION,
} = {}) {
  return {
    verifyToken: facebookVerifyToken || whatsappVerifyToken || metaVerifyToken || '',
    appSecret: appSecret || '',
    defaultPageAccessToken: defaultPageAccessToken || '',
    pageAccessTokenMap: parseMetaPageAccessTokenMap(pageAccessTokenMapRaw),
    pageBusinessUnitMap: parseMetaPageBusinessUnitMap(pageBusinessUnitMapRaw),
    whatsappBusinessUnitMap: parseMetaWhatsAppBusinessUnitMap(whatsappBusinessUnitMapRaw),
    defaultWhatsAppAccessToken: defaultWhatsAppAccessToken || '',
    whatsappAccessTokenMap: parseMetaWhatsAppAccessTokenMap(whatsappAccessTokenMapRaw),
    graphApiVersion: graphApiVersion || META_GRAPH_API_VERSION,
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMetaWebhookChallenge({
  mode = '',
  verifyToken = '',
  challenge = '',
  config = {},
} = {}) {
  const expectedVerifyToken = config.verifyToken || '';
  if (!expectedVerifyToken) {
    return { ok: false, code: 'VERIFY_TOKEN_MISSING', reason: 'Meta verify token is not configured.' };
  }
  if (mode === 'subscribe' && safeEqual(verifyToken, expectedVerifyToken)) {
    return { ok: true, challenge: challenge || '' };
  }
  return { ok: false, code: 'VERIFY_TOKEN_MISMATCH', reason: 'Verification token mismatch.' };
}

export function validateMetaAppSecretSignature({
  bodyText = '',
  signatureHeader = '',
  config = {},
} = {}) {
  const appSecret = config.appSecret || '';
  if (!appSecret) {
    return { ok: false, code: 'APP_SECRET_MISSING', reason: 'Meta app secret is not configured.' };
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, code: 'SIGNATURE_MISSING', reason: 'Meta webhook signature is missing or malformed.' };
  }

  const signature = signatureHeader.slice('sha256='.length);
  const expected = createHmac('sha256', appSecret).update(bodyText).digest('hex');
  if (!safeEqual(signature, expected)) {
    return { ok: false, code: 'SIGNATURE_MISMATCH', reason: 'Meta webhook signature mismatch.' };
  }
  return { ok: true };
}

export function resolveMetaPageAccessToken(pageId, config = {}) {
  const mapped = config.pageAccessTokenMap?.[pageId];
  const accessToken = mapped || config.defaultPageAccessToken || '';
  if (!accessToken) {
    return {
      ok: false,
      code: 'PAGE_ACCESS_TOKEN_MISSING',
      reason: META_PAGE_ACCESS_TOKEN_MISSING_REASON,
    };
  }
  return {
    ok: true,
    accessToken,
    source: mapped ? 'page_map' : 'default',
  };
}

export function resolveMetaWhatsAppAccessToken(phoneNumberId, config = {}) {
  const mapped = config.whatsappAccessTokenMap?.[phoneNumberId];
  const accessToken = mapped || config.defaultWhatsAppAccessToken || '';
  if (!accessToken) {
    return {
      ok: false,
      code: 'WHATSAPP_ACCESS_TOKEN_MISSING',
      reason: META_WHATSAPP_ACCESS_TOKEN_MISSING_REASON,
    };
  }
  return {
    ok: true,
    accessToken,
    source: mapped ? 'whatsapp_map' : 'default',
  };
}

export function resolveMetaPageBusinessUnitMapping(pageId, config = {}) {
  const mapped = config.pageBusinessUnitMap?.[pageId];
  return {
    ok: Boolean(mapped),
    businessUnit: mapped || null,
    source: mapped ? 'page_map' : null,
  };
}

export function resolveMetaWhatsAppBusinessUnitMapping(phoneNumberId, displayPhoneNumber = '', config = {}) {
  const map = config.whatsappBusinessUnitMap || {};
  const mapped = map[phoneNumberId] || map[displayPhoneNumber];
  return {
    ok: Boolean(mapped),
    businessUnit: mapped || null,
    source: mapped ? 'whatsapp_map' : null,
  };
}

function graphUrl({ id, fields, accessToken, graphApiVersion }) {
  const url = new URL(`https://graph.facebook.com/${graphApiVersion || META_GRAPH_API_VERSION}/${encodeURIComponent(id)}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  return url;
}

function graphEdgeUrl({ id, edge, accessToken, graphApiVersion }) {
  const url = new URL(`https://graph.facebook.com/${graphApiVersion || META_GRAPH_API_VERSION}/${encodeURIComponent(id)}/${edge}`);
  url.searchParams.set('access_token', accessToken);
  return url;
}

async function readGraphJson(response) {
  return response.json().catch(() => ({}));
}

function graphSendError(body, status) {
  return {
    ok: false,
    code: 'GRAPH_RESPONSE_ERROR',
    reason: body?.error?.message || `Graph API returned ${status}`,
    graphStatus: status,
    graphError: body?.error || null,
  };
}

function graphNetworkError(error) {
  return {
    ok: false,
    code: 'GRAPH_NETWORK_ERROR',
    reason: 'Meta Graph request failed.',
    graphStatus: null,
    graphError: { message: error?.message || 'Unknown network error' },
  };
}

async function postMetaJson({ url, body, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return graphNetworkError(error);
  }

  const payload = await readGraphJson(response);
  if (!response.ok) return graphSendError(payload, response.status);
  return { ok: true, body: payload };
}

export async function fetchMetaLeadDetails({
  leadgenId = '',
  pageId = '',
  config = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const tokenResult = resolveMetaPageAccessToken(pageId, config);
  if (!leadgenId || !tokenResult.ok) {
    return { ok: false, code: tokenResult.code || 'LEADGEN_ID_MISSING', reason: tokenResult.reason || 'Meta leadgen id missing.' };
  }

  const url = graphUrl({
    id: leadgenId,
    fields: 'id,created_time,ad_id,form_id,page_id,field_data',
    accessToken: tokenResult.accessToken,
    graphApiVersion: config.graphApiVersion,
  });

  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store' });
  } catch (error) {
    return {
      ok: false,
      code: 'GRAPH_NETWORK_ERROR',
      reason: 'Meta Graph request failed.',
      graphStatus: null,
      graphError: { message: error?.message || 'Unknown network error' },
    };
  }

  const body = await readGraphJson(response);
  if (!response.ok) {
    return {
      ok: false,
      code: 'GRAPH_RESPONSE_ERROR',
      reason: body?.error?.message || `Graph API returned ${response.status}`,
      graphStatus: response.status,
      graphError: body?.error || null,
    };
  }

  return { ok: true, lead: body };
}

export async function sendMetaMessengerTextMessage({
  pageId = '',
  recipientId = '',
  text = '',
  config = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const tokenResult = resolveMetaPageAccessToken(pageId, config);
  if (!pageId || !recipientId || !String(text || '').trim() || !tokenResult.ok) {
    return {
      ok: false,
      code: tokenResult.code || 'MESSENGER_SEND_INPUT_MISSING',
      reason: tokenResult.reason || 'Messenger page id, recipient id, and text are required.',
    };
  }

  const url = graphEdgeUrl({
    id: pageId,
    edge: 'messages',
    accessToken: tokenResult.accessToken,
    graphApiVersion: config.graphApiVersion,
  });
  const result = await postMetaJson({
    url,
    fetchImpl,
    body: {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text: String(text).trim() },
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    providerMessageId: result.body?.message_id || result.body?.recipient_id || null,
    providerResponse: result.body || {},
  };
}

export async function sendMetaWhatsAppTextMessage({
  phoneNumberId = '',
  recipientWaId = '',
  text = '',
  config = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const tokenResult = resolveMetaWhatsAppAccessToken(phoneNumberId, config);
  if (!phoneNumberId || !recipientWaId || !String(text || '').trim() || !tokenResult.ok) {
    return {
      ok: false,
      code: tokenResult.code || 'WHATSAPP_SEND_INPUT_MISSING',
      reason: tokenResult.reason || 'WhatsApp phone number id, recipient wa_id, and text are required.',
    };
  }

  const url = graphEdgeUrl({
    id: phoneNumberId,
    edge: 'messages',
    accessToken: tokenResult.accessToken,
    graphApiVersion: config.graphApiVersion,
  });
  const result = await postMetaJson({
    url,
    fetchImpl,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientWaId,
      type: 'text',
      text: { preview_url: false, body: String(text).trim() },
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    providerMessageId: result.body?.messages?.[0]?.id || null,
    providerResponse: result.body || {},
  };
}

export async function sendMetaWhatsAppTemplateMessage({
  phoneNumberId = '',
  recipientWaId = '',
  templateName = '',
  languageCode = 'en_US',
  config = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const tokenResult = resolveMetaWhatsAppAccessToken(phoneNumberId, config);
  if (!phoneNumberId || !recipientWaId || !String(templateName || '').trim() || !tokenResult.ok) {
    return {
      ok: false,
      code: tokenResult.code || 'WHATSAPP_TEMPLATE_SEND_INPUT_MISSING',
      reason: tokenResult.reason || 'WhatsApp phone number id, recipient wa_id, and approved template name are required.',
    };
  }

  const url = graphEdgeUrl({
    id: phoneNumberId,
    edge: 'messages',
    accessToken: tokenResult.accessToken,
    graphApiVersion: config.graphApiVersion,
  });
  const result = await postMetaJson({
    url,
    fetchImpl,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientWaId,
      type: 'template',
      template: {
        name: String(templateName).trim(),
        language: { code: String(languageCode || 'en_US').trim() || 'en_US' },
      },
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    providerMessageId: result.body?.messages?.[0]?.id || null,
    providerResponse: result.body || {},
  };
}

export async function fetchMetaMessengerProfile({
  senderId = '',
  pageId = '',
  config = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const tokenResult = resolveMetaPageAccessToken(pageId, config);
  if (!senderId || !tokenResult.ok) {
    return { ok: false, code: tokenResult.code || 'SENDER_ID_MISSING', reason: tokenResult.reason || 'Meta Messenger sender id missing.' };
  }

  const url = graphUrl({
    id: senderId,
    fields: 'id,name,first_name,last_name,profile_pic',
    accessToken: tokenResult.accessToken,
    graphApiVersion: config.graphApiVersion,
  });

  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store' });
  } catch (error) {
    return {
      ok: false,
      code: 'GRAPH_NETWORK_ERROR',
      reason: 'Meta Graph request failed.',
      graphStatus: null,
      graphError: { message: error?.message || 'Unknown network error' },
    };
  }

  const body = await readGraphJson(response);
  if (!response.ok) {
    return {
      ok: false,
      code: 'GRAPH_RESPONSE_ERROR',
      reason: body?.error?.message || `Graph API returned ${response.status}`,
      graphStatus: response.status,
      graphError: body?.error || null,
    };
  }

  return { ok: true, profile: body };
}

export function flattenMetaLeadgenChanges(payload) {
  if (payload?.object !== 'page') return [];
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change?.field !== 'leadgen') continue;
      const value = change.value || {};
      events.push({
        entryId: entry.id || '',
        leadgenId: value.leadgen_id || '',
        pageId: value.page_id || entry.id || '',
        formId: value.form_id || '',
        adId: value.ad_id || '',
        createdTime: value.created_time || null,
        raw: { entry, change },
      });
    }
  }
  return events;
}

export function flattenMetaMessengerEvents(payload) {
  if (payload?.object !== 'page') return [];
  const events = [];
  for (const entry of payload.entry || []) {
    for (const messaging of entry.messaging || []) {
      const message = messaging.message || null;
      const postback = messaging.postback || null;
      const senderId = messaging.sender?.id || '';
      const pageId = messaging.recipient?.id || entry.id || '';
      if (message?.is_echo) continue;
      events.push({
        entryId: entry.id || '',
        senderId,
        pageId,
        messageId: message?.mid || '',
        text: message?.text || '',
        attachments: Array.isArray(message?.attachments) ? message.attachments : [],
        postbackPayload: postback?.payload || '',
        timestamp: messaging.timestamp || null,
        raw: { entry, messaging },
      });
    }
  }
  return events;
}

function contactForWaId(contacts = [], waId = '') {
  return contacts.find((contact) => String(contact?.wa_id || '') === String(waId || '')) || contacts[0] || null;
}

function normalizeWhatsAppMessageText(message = {}) {
  const type = String(message.type || '').trim().toLowerCase();
  if (type === 'text') return String(message.text?.body || '').trim();
  if (type === 'button') return String(message.button?.text || message.button?.payload || '').trim();
  if (type === 'interactive') {
    return String(
      message.interactive?.button_reply?.title
        || message.interactive?.button_reply?.id
        || message.interactive?.list_reply?.title
        || message.interactive?.list_reply?.id
        || '',
    ).trim();
  }
  return String(message[type]?.caption || '').trim();
}

function normalizeWhatsAppAttachments(message = {}) {
  const type = String(message.type || '').trim().toLowerCase();
  const supportedMediaTypes = new Set(['audio', 'document', 'image', 'sticker', 'video']);
  if (supportedMediaTypes.has(type) && message[type]) {
    const media = message[type];
    return [{
      type,
      id: media.id || null,
      mimeType: media.mime_type || null,
      sha256: media.sha256 || null,
      caption: media.caption || null,
      filename: media.filename || null,
    }];
  }
  if (type === 'location' && message.location) {
    return [{ type, location: message.location }];
  }
  if (type === 'contacts' && Array.isArray(message.contacts)) {
    return [{ type, contacts: message.contacts }];
  }
  return [];
}

export function flattenMetaWhatsAppMessages(payload) {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change?.field !== 'messages') continue;
      const value = change.value || {};
      const metadata = value.metadata || {};
      const phoneNumberId = metadata.phone_number_id || '';
      const displayPhoneNumber = metadata.display_phone_number || '';
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const message of value.messages || []) {
        const waId = message.from || contactForWaId(contacts, message.from)?.wa_id || '';
        const contact = contactForWaId(contacts, waId);
        const messageType = String(message.type || '').trim().toLowerCase() || 'unknown';
        events.push({
          entryId: entry.id || '',
          wabaId: entry.id || '',
          phoneNumberId,
          displayPhoneNumber,
          waId,
          from: message.from || '',
          messageId: message.id || '',
          messageType,
          text: normalizeWhatsAppMessageText(message),
          attachments: normalizeWhatsAppAttachments(message),
          timestamp: message.timestamp || null,
          contactProfileName: contact?.profile?.name || '',
          raw: { entry, change, message, contact },
        });
      }
    }
  }
  return events;
}

function firstField(fields, names) {
  for (const name of names) {
    const field = fields.find((item) => item.key === name);
    const value = field?.values?.[0];
    if (value) return String(value).trim();
  }
  return '';
}

export function normalizeMetaLeadFields(fieldData = []) {
  const fields = fieldData.map((field) => ({
    key: String(field?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    values: Array.isArray(field?.values) ? field.values : [],
  }));

  const firstName = firstField(fields, ['first_name', 'firstname']);
  const lastName = firstField(fields, ['last_name', 'lastname']);
  const fullName = firstField(fields, ['full_name', 'name', 'nombre', 'contact_name']) || [firstName, lastName].filter(Boolean).join(' ');
  const email = firstField(fields, ['email', 'email_address', 'correo', 'correo_electronico']);
  const phone = firstField(fields, ['phone_number', 'phone', 'mobile_phone_number', 'telefono', 'celular']);
  const company = firstField(fields, ['company_name', 'company', 'business_name', 'empresa']);
  const address = firstField(fields, ['street_address', 'address', 'direccion']);

  return {
    name: fullName || email || phone || 'Facebook Lead',
    email,
    phone,
    company,
    address,
    field_data: fieldData,
  };
}
