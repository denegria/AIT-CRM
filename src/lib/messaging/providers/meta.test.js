import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  META_PAGE_ACCESS_TOKEN_MISSING_REASON,
  META_WHATSAPP_ACCESS_TOKEN_MISSING_REASON,
  createMetaProviderConfig,
  fetchMetaLeadDetails,
  fetchMetaLeadFormLeads,
  fetchMetaMessengerProfile,
  flattenMetaWhatsAppMessages,
  parseMetaPageAccessTokenMap,
  parseMetaWhatsAppAccessTokenMap,
  parseMetaPageBusinessUnitMap,
  parseMetaWhatsAppBusinessUnitMap,
  resolveMetaPageAccessToken,
  resolveMetaWhatsAppAccessToken,
  resolveMetaPageBusinessUnitMapping,
  resolveMetaWhatsAppBusinessUnitMapping,
  sendMetaMessengerTextMessage,
  sendMetaWhatsAppTemplateMessage,
  sendMetaWhatsAppTextMessage,
  validateMetaAppSecretSignature,
  verifyMetaWebhookChallenge,
} from './meta.js';

test('validates Meta app-secret signatures without accepting malformed headers', () => {
  const bodyText = JSON.stringify({ object: 'page', entry: [] });
  const config = { appSecret: 'app-secret' };
  const signature = createHmac('sha256', config.appSecret).update(bodyText).digest('hex');

  assert.deepEqual(
    validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature}`, config }),
    { ok: true },
  );
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature.slice(1)}`, config }).ok, false);
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: signature, config }).code, 'SIGNATURE_MISSING');
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature}`, config: {} }).code, 'APP_SECRET_MISSING');
});

test('verifies Meta challenge tokens using provider config', () => {
  const config = createMetaProviderConfig({
    facebookVerifyToken: 'facebook-token',
    metaVerifyToken: 'meta-token',
  });

  assert.deepEqual(
    verifyMetaWebhookChallenge({
      mode: 'subscribe',
      verifyToken: 'facebook-token',
      challenge: 'challenge-value',
      config,
    }),
    { ok: true, challenge: 'challenge-value' },
  );
  assert.equal(verifyMetaWebhookChallenge({ mode: 'subscribe', verifyToken: 'wrong', config }).code, 'VERIFY_TOKEN_MISMATCH');
});

test('verifies WhatsApp challenge tokens using provider config', () => {
  const config = createMetaProviderConfig({
    whatsappVerifyToken: 'whatsapp-token',
    metaVerifyToken: 'meta-token',
  });

  assert.deepEqual(
    verifyMetaWebhookChallenge({
      mode: 'subscribe',
      verifyToken: 'whatsapp-token',
      challenge: 'whatsapp-challenge',
      config,
    }),
    { ok: true, challenge: 'whatsapp-challenge' },
  );
  assert.equal(verifyMetaWebhookChallenge({ mode: 'subscribe', verifyToken: 'meta-token', config }).code, 'VERIFY_TOKEN_MISMATCH');
});

test('parses page token and business-unit maps with default token fallback', () => {
  const config = createMetaProviderConfig({
    defaultPageAccessToken: 'default-token',
    pageAccessTokenMapRaw: JSON.stringify({ 'page-1': 'mapped-token' }),
    pageBusinessUnitMapRaw: JSON.stringify({ 'page-1': 'Main Signs' }),
    whatsappBusinessUnitMapRaw: JSON.stringify({ 'phone-number-1': 'WhatsApp Signs' }),
    defaultWhatsAppAccessToken: 'default-wa-token',
    whatsappAccessTokenMapRaw: JSON.stringify({ 'phone-number-1': 'mapped-wa-token' }),
  });

  assert.deepEqual(parseMetaPageAccessTokenMap('not-json'), {});
  assert.deepEqual(parseMetaWhatsAppAccessTokenMap('{bad'), {});
  assert.deepEqual(parseMetaPageBusinessUnitMap('[]'), {});
  assert.deepEqual(parseMetaWhatsAppBusinessUnitMap('null'), {});
  assert.deepEqual(resolveMetaPageAccessToken('page-1', config), {
    ok: true,
    accessToken: 'mapped-token',
    source: 'page_map',
  });
  assert.deepEqual(resolveMetaPageAccessToken('page-2', config), {
    ok: true,
    accessToken: 'default-token',
    source: 'default',
  });
  assert.deepEqual(resolveMetaPageBusinessUnitMapping('page-1', config), {
    ok: true,
    businessUnit: 'Main Signs',
    source: 'page_map',
  });
  assert.deepEqual(resolveMetaPageBusinessUnitMapping('page-2', config), {
    ok: false,
    businessUnit: null,
    source: null,
  });
  assert.deepEqual(resolveMetaWhatsAppBusinessUnitMapping('phone-number-1', '', config), {
    ok: true,
    businessUnit: 'WhatsApp Signs',
    source: 'whatsapp_map',
  });
  assert.deepEqual(resolveMetaWhatsAppBusinessUnitMapping('phone-number-2', '+15551234567', config), {
    ok: false,
    businessUnit: null,
    source: null,
  });
  assert.deepEqual(resolveMetaWhatsAppAccessToken('phone-number-1', config), {
    ok: true,
    accessToken: 'mapped-wa-token',
    source: 'whatsapp_map',
  });
  assert.deepEqual(resolveMetaWhatsAppAccessToken('phone-number-2', config), {
    ok: true,
    accessToken: 'default-wa-token',
    source: 'default',
  });
  assert.deepEqual(resolveMetaWhatsAppAccessToken('phone-number-2', createMetaProviderConfig()), {
    ok: false,
    code: 'WHATSAPP_ACCESS_TOKEN_MISSING',
    reason: META_WHATSAPP_ACCESS_TOKEN_MISSING_REASON,
  });
});

test('flattens WhatsApp Cloud API inbound message fixtures', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+1 555 111 2222',
                phone_number_id: 'phone-number-1',
              },
              contacts: [
                {
                  profile: { name: 'Ada Signs' },
                  wa_id: '15550001111',
                },
              ],
              messages: [
                {
                  from: '15550001111',
                  id: 'wamid-1',
                  timestamp: '1779275460',
                  type: 'text',
                  text: { body: 'Need a storefront sign' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(flattenMetaWhatsAppMessages({ object: 'page', entry: [] }), []);
  const events = flattenMetaWhatsAppMessages(payload);
  assert.equal(events.length, 1);
  assert.equal(events[0].entryId, 'waba-1');
  assert.equal(events[0].phoneNumberId, 'phone-number-1');
  assert.equal(events[0].displayPhoneNumber, '+1 555 111 2222');
  assert.equal(events[0].waId, '15550001111');
  assert.equal(events[0].messageId, 'wamid-1');
  assert.equal(events[0].messageType, 'text');
  assert.equal(events[0].text, 'Need a storefront sign');
  assert.equal(events[0].contactProfileName, 'Ada Signs');
  assert.equal(events[0].raw.message.id, 'wamid-1');
});

test('returns structured missing-token errors before calling Graph', async () => {
  let called = false;
  const result = await fetchMetaLeadDetails({
    leadgenId: 'lead-1',
    pageId: 'page-1',
    config: createMetaProviderConfig(),
    fetchImpl: async () => {
      called = true;
      throw new Error('should not call fetch without a page token');
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, {
    ok: false,
    code: 'PAGE_ACCESS_TOKEN_MISSING',
    reason: META_PAGE_ACCESS_TOKEN_MISSING_REASON,
  });
});

test('returns structured errors for failed lead Graph responses', async () => {
  const calls = [];
  const config = createMetaProviderConfig({
    defaultPageAccessToken: 'default-token',
    pageAccessTokenMapRaw: JSON.stringify({ 'page-1': 'mapped-token' }),
  });

  const result = await fetchMetaLeadDetails({
    leadgenId: 'lead-1',
    pageId: 'page-1',
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        async json() {
          return { error: { message: 'Invalid lead id', code: 190 } };
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].url.pathname, '/v24.0/lead-1');
  assert.equal(calls[0].url.searchParams.get('access_token'), 'mapped-token');
  assert.equal(calls[0].url.searchParams.get('fields'), 'id,created_time,ad_id,form_id,field_data');
  assert.deepEqual(result, {
    ok: false,
    code: 'GRAPH_RESPONSE_ERROR',
    reason: 'Invalid lead id',
    graphStatus: 400,
    graphError: { message: 'Invalid lead id', code: 190 },
  });
});

test('fetches Lead Ads form leads with pagination', async () => {
  const calls = [];
  const config = createMetaProviderConfig({
    defaultPageAccessToken: 'default-token',
    pageAccessTokenMapRaw: JSON.stringify({ 'page-1': 'mapped-token' }),
  });

  const result = await fetchMetaLeadFormLeads({
    formId: 'form-1',
    pageId: 'page-1',
    config,
    limit: 2,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              data: [{ id: 'lead-1' }],
              paging: { next: 'https://graph.facebook.com/v24.0/form-1/leads?after=cursor' },
            };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ id: 'lead-2' }] };
        },
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].url.pathname, '/v24.0/form-1/leads');
  assert.equal(calls[0].url.searchParams.get('access_token'), 'mapped-token');
  assert.equal(calls[0].url.searchParams.get('fields'), 'id,created_time,ad_id,form_id,field_data');
  assert.equal(calls[0].url.searchParams.get('limit'), '2');
  assert.deepEqual(result, { ok: true, leads: [{ id: 'lead-1' }, { id: 'lead-2' }] });
});

test('returns structured errors for failed Messenger profile Graph responses', async () => {
  const config = createMetaProviderConfig({ defaultPageAccessToken: 'default-token' });

  const result = await fetchMetaMessengerProfile({
    senderId: 'sender-1',
    pageId: 'page-2',
    config,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() {
        throw new Error('invalid json');
      },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    code: 'GRAPH_RESPONSE_ERROR',
    reason: 'Graph API returned 503',
    graphStatus: 503,
    graphError: null,
  });
});

test('returns structured errors for Graph network failures', async () => {
  const config = createMetaProviderConfig({ defaultPageAccessToken: 'default-token' });

  const leadResult = await fetchMetaLeadDetails({
    leadgenId: 'lead-1',
    pageId: 'page-1',
    config,
    fetchImpl: async () => {
      throw new Error('socket closed');
    },
  });

  assert.deepEqual(leadResult, {
    ok: false,
    code: 'GRAPH_NETWORK_ERROR',
    reason: 'Meta Graph request failed.',
    graphStatus: null,
    graphError: { message: 'socket closed' },
  });

  const profileResult = await fetchMetaMessengerProfile({
    senderId: 'sender-1',
    pageId: 'page-1',
    config,
    fetchImpl: async () => {
      throw new Error('socket closed');
    },
  });

  assert.deepEqual(profileResult, {
    ok: false,
    code: 'GRAPH_NETWORK_ERROR',
    reason: 'Meta Graph request failed.',
    graphStatus: null,
    graphError: { message: 'socket closed' },
  });
});

test('sends Messenger text messages with explicit parameters and mocked fetch', async () => {
  const calls = [];
  const result = await sendMetaMessengerTextMessage({
    pageId: 'page-1',
    recipientId: 'sender-1',
    text: 'Thanks for reaching out',
    config: createMetaProviderConfig({ defaultPageAccessToken: 'page-token' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { recipient_id: 'sender-1', message_id: 'mid-out-1' };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'mid-out-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/v24.0/page-1/messages');
  assert.equal(calls[0].url.searchParams.get('access_token'), 'page-token');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    recipient: { id: 'sender-1' },
    messaging_type: 'RESPONSE',
    message: { text: 'Thanks for reaching out' },
  });
});

test('sends WhatsApp text and template messages with mocked fetch', async () => {
  const calls = [];
  const config = createMetaProviderConfig({
    defaultWhatsAppAccessToken: 'wa-token',
  });
  const textResult = await sendMetaWhatsAppTextMessage({
    phoneNumberId: 'phone-number-1',
    recipientWaId: '15550001111',
    text: 'Manual follow-up',
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { messages: [{ id: 'wamid.out.1' }] };
        },
      };
    },
  });
  const templateResult = await sendMetaWhatsAppTemplateMessage({
    phoneNumberId: 'phone-number-1',
    recipientWaId: '15550001111',
    templateName: 'manual_follow_up',
    languageCode: 'en_US',
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { messages: [{ id: 'wamid.template.1' }] };
        },
      };
    },
  });

  assert.equal(textResult.providerMessageId, 'wamid.out.1');
  assert.equal(templateResult.providerMessageId, 'wamid.template.1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, '/v24.0/phone-number-1/messages');
  assert.equal(calls[0].url.searchParams.get('access_token'), 'wa-token');
  assert.equal(JSON.parse(calls[0].options.body).type, 'text');
  assert.equal(JSON.parse(calls[1].options.body).template.name, 'manual_follow_up');
});

test('outbound sends fail closed before mocked fetch when tokens are missing', async () => {
  let called = false;
  const result = await sendMetaWhatsAppTextMessage({
    phoneNumberId: 'phone-number-1',
    recipientWaId: '15550001111',
    text: 'Manual follow-up',
    config: createMetaProviderConfig(),
    fetchImpl: async () => {
      called = true;
      throw new Error('should not call fetch without token');
    },
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WHATSAPP_ACCESS_TOKEN_MISSING');
});
