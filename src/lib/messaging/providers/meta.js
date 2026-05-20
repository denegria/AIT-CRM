import { createHmac, timingSafeEqual } from 'crypto';

export const FB_VERIFY_TOKEN_ENV = 'FACEBOOK_WEBHOOK_VERIFY_TOKEN';
export const META_VERIFY_TOKEN_ENV = 'META_WEBHOOK_VERIFY_TOKEN';
export const FB_APP_SECRET_ENV = 'FACEBOOK_APP_SECRET';
export const META_PAGE_ACCESS_TOKEN_ENV = 'META_PAGE_ACCESS_TOKEN';
export const META_PAGE_ACCESS_TOKEN_MAP_ENV = 'META_PAGE_ACCESS_TOKEN_MAP';
export const META_PAGE_BUSINESS_UNIT_MAP_ENV = 'META_PAGE_BUSINESS_UNIT_MAP';
export const META_GRAPH_API_VERSION = 'v24.0';
export const META_PAGE_ACCESS_TOKEN_MISSING_REASON = `${META_PAGE_ACCESS_TOKEN_ENV} or ${META_PAGE_ACCESS_TOKEN_MAP_ENV} missing`;

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

export function createMetaProviderConfig({
  facebookVerifyToken = '',
  metaVerifyToken = '',
  appSecret = '',
  defaultPageAccessToken = '',
  pageAccessTokenMapRaw = '',
  pageBusinessUnitMapRaw = '',
  graphApiVersion = META_GRAPH_API_VERSION,
} = {}) {
  return {
    verifyToken: facebookVerifyToken || metaVerifyToken || '',
    appSecret: appSecret || '',
    defaultPageAccessToken: defaultPageAccessToken || '',
    pageAccessTokenMap: parseMetaPageAccessTokenMap(pageAccessTokenMapRaw),
    pageBusinessUnitMap: parseMetaPageBusinessUnitMap(pageBusinessUnitMapRaw),
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

export function resolveMetaPageBusinessUnitMapping(pageId, config = {}) {
  const mapped = config.pageBusinessUnitMap?.[pageId];
  return {
    ok: Boolean(mapped),
    businessUnit: mapped || null,
    source: mapped ? 'page_map' : null,
  };
}

function graphUrl({ id, fields, accessToken, graphApiVersion }) {
  const url = new URL(`https://graph.facebook.com/${graphApiVersion || META_GRAPH_API_VERSION}/${encodeURIComponent(id)}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  return url;
}

async function readGraphJson(response) {
  return response.json().catch(() => ({}));
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
