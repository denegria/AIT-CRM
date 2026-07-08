import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  createSmsCampaignSendConfigFromEnv,
  flattenSmsProviderEvents,
  parseTelnyxWebhookPayloadText,
  retrieveTelnyx10dlcPhoneNumberCampaign,
  retrieveTelnyxPhoneNumberMessagingSettings,
  retrieveTelnyxSmsMessage,
  sendTelnyxSmsMessage,
  smsPhoneDiagnostic,
  validateTelnyxWebhookSignature,
} from './sms.js';

test('creates staging SMS send config with recipient allowlist and production block', () => {
  const staging = createSmsCampaignSendConfigFromEnv({
    VERCEL_ENV: 'preview',
    SMS_CAMPAIGN_LIVE_SEND_ENABLED: 'true',
    SMS_CAMPAIGN_LIVE_SEND_TEST_MODE: 'true',
    SMS_CAMPAIGN_LIVE_SEND_MAX_RECIPIENTS: '1',
    SMS_CAMPAIGN_LIVE_SEND_RECIPIENT_ALLOWLIST: '+1 (555) 000-1111, 5550002222',
    TELNYX_API_KEY: 'redacted',
    TELNYX_MESSAGING_PROFILE_ID: 'profile-1',
    TELNYX_FROM_NUMBER: '(555) 222-3333',
  });

  assert.equal(staging.liveSendEnabled, true);
  assert.equal(staging.testSendMode, true);
  assert.equal(staging.maxRecipients, 1);
  assert.deepEqual(staging.recipientAllowlist, ['+15550001111', '+15550002222']);
  assert.equal(staging.telnyxFromNumber, '+15552223333');

  const production = createSmsCampaignSendConfigFromEnv({
    VERCEL_ENV: 'production',
    SMS_CAMPAIGN_LIVE_SEND_ENABLED: 'true',
    SMS_CAMPAIGN_LIVE_SEND_TEST_MODE: 'true',
  });
  assert.equal(production.liveSendEnabled, false);
  assert.equal(production.testSendMode, false);
  assert.equal(production.productionBlocked, true);
});

test('sends Telnyx SMS through v2 messages endpoint', async () => {
  const requests = [];
  const result = await sendTelnyxSmsMessage({
    apiKey: 'redacted',
    messagingProfileId: 'profile-1',
    from: '+15552223333',
    to: '(555) 000-1111',
    text: 'Hello',
    requestId: 'sms-request-1',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            data: {
              id: 'telnyx-message-1',
              to: [{ phone_number: '+15550001111', status: 'queued' }],
            },
          };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'telnyx-message-1');
  assert.equal(result.providerStatus, 'queued');
  assert.equal(result.deliveryStatus, 'pending');
  assert.equal(requests[0].url, 'https://api.telnyx.com/v2/messages');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer redacted');
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'sms-request-1');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    from: '+15552223333',
    to: '+15550001111',
    text: 'Hello',
    messaging_profile_id: 'profile-1',
  });
});

test('returns structured Telnyx SMS errors', async () => {
  const result = await sendTelnyxSmsMessage({
    apiKey: 'redacted',
    from: '+15552223333',
    to: '+15550001111',
    text: 'Hello',
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async json() {
        return { errors: [{ code: '40301', detail: 'Sender registration required.' }] };
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, '40301');
  assert.equal(result.reason, 'Sender registration required.');
  assert.equal(result.providerStatus, 403);
  assert.equal(result.deliveryStatus, 'failed');
  assert.deepEqual(result.providerResponse, {
    errors: [{ code: '40301', title: null }],
  });
});

test('fails closed before Telnyx fetch when send config is missing', async () => {
  let called = false;
  const result = await sendTelnyxSmsMessage({
    apiKey: '',
    from: '+15552223333',
    to: '+15550001111',
    text: 'Hello',
    fetchImpl: async () => {
      called = true;
      throw new Error('should not send without required config');
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, {
    ok: false,
    code: 'TELNYX_SMS_INPUT_MISSING',
    reason: 'Telnyx API key, sender number, recipient number, and message text are required.',
    deliveryStatus: 'failed',
    providerResponse: {},
  });
});

test('returns structured Telnyx network errors without provider payload', async () => {
  const result = await sendTelnyxSmsMessage({
    apiKey: 'redacted',
    from: '+15552223333',
    to: '+15550001111',
    text: 'Hello',
    fetchImpl: async () => {
      throw new Error('socket timeout');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'TELNYX_SMS_NETWORK_ERROR');
  assert.equal(result.reason, 'socket timeout');
  assert.equal(result.deliveryStatus, 'failed');
  assert.deepEqual(result.providerResponse, {});
});

test('redacts Telnyx success payload while preserving provider identifiers and status', async () => {
  const result = await sendTelnyxSmsMessage({
    apiKey: 'redacted',
    from: '+15552223333',
    to: '+15550001111',
    text: 'Hello',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          data: {
            id: 'telnyx-message-1',
            record_type: 'message',
            direction: 'outbound',
            type: 'SMS',
            messaging_profile_id: 'profile-1',
            from: { phone_number: '+15552223333', carrier: 'TELNYX LLC', line_type: 'VoIP' },
            to: [{ phone_number: '+15550001111', status: 'sent', carrier: 'T-MOBILE USA, INC.', line_type: 'Wireless' }],
            text: 'Hello',
            webhook_url: 'https://example.invalid/webhook',
          },
        };
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'telnyx-message-1');
  assert.equal(result.providerStatus, 'sent');
  assert.equal(result.deliveryStatus, 'sent');
  assert.deepEqual(result.providerResponse, {
    data: {
      id: 'telnyx-message-1',
      record_type: 'message',
      direction: 'outbound',
      type: 'SMS',
      messaging_profile_id: 'profile-1',
      status: null,
      from: {
        carrier: 'TELNYX LLC',
        line_type: 'VoIP',
      },
      to: [{
        status: 'sent',
        carrier: 'T-MOBILE USA, INC.',
        line_type: 'Wireless',
        error_code: null,
        error_message: null,
        error_detail: null,
      }],
    },
  });
  assert.equal(JSON.stringify(result.providerResponse).includes('+15550001111'), false);
  assert.equal(JSON.stringify(result.providerResponse).includes('Hello'), false);
});

test('retrieves Telnyx SMS delivery status by provider message id', async () => {
  const requests = [];
  const result = await retrieveTelnyxSmsMessage({
    apiKey: 'redacted',
    messageId: 'telnyx-message-1',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            data: {
              id: 'telnyx-message-1',
            record_type: 'message',
            direction: 'outbound',
            status: 'sent',
            type: 'SMS',
            messaging_profile_id: 'profile-1',
            from: { phone_number: '+15552223333', carrier: 'TELNYX LLC', line_type: 'VoIP' },
            to: [{
              phone_number: '+15550001111',
              status: 'delivered',
              carrier: 'T-MOBILE USA, INC.',
              line_type: 'Wireless',
              error_code: null,
            }],
            text: 'Hello',
          },
        };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'telnyx-message-1');
  assert.equal(result.providerStatus, 'delivered');
  assert.equal(result.deliveryStatus, 'delivered');
  assert.equal(requests[0].url, 'https://api.telnyx.com/v2/messages/telnyx-message-1');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer redacted');
  assert.equal(JSON.stringify(result.providerResponse).includes('+15550001111'), false);
  assert.equal(JSON.stringify(result.providerResponse).includes('Hello'), false);
});

test('returns structured Telnyx SMS retrieve errors', async () => {
  const result = await retrieveTelnyxSmsMessage({
    apiKey: 'redacted',
    messageId: 'telnyx-message-1',
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      async json() {
        return { errors: [{ code: '10010', title: 'Not found', detail: 'Message not found.' }] };
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, '10010');
  assert.equal(result.reason, 'Message not found.');
  assert.equal(result.deliveryStatus, 'failed');
  assert.deepEqual(result.providerResponse, {
    errors: [{ code: '10010', title: 'Not found' }],
  });
});

test('redacts phone numbers in Telnyx sender messaging diagnostics', async () => {
  const requests = [];
  const result = await retrieveTelnyxPhoneNumberMessagingSettings({
    apiKey: 'redacted',
    phoneNumber: '(555) 222-3333',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              record_type: 'messaging_settings',
              id: '1293384261075731499',
              phone_number: '+15552223333',
              messaging_profile_id: 'profile-1',
              country_code: 'US',
              type: 'local',
              traffic_type: 'A2P',
              messaging_product: 'A2P',
              eligible_messaging_products: ['A2P'],
              health: {
                message_count: 3,
                inbound_outbound_ratio: 0.5,
                success_ratio: 0.25,
                spam_ratio: 0,
              },
              features: {
                sms: {
                  domestic_two_way: true,
                  international_inbound: false,
                  international_outbound: false,
                },
                mms: null,
              },
              created_at: '2026-07-01T00:00:00Z',
              updated_at: '2026-07-02T00:00:00Z',
            },
          };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests[0].url, 'https://api.telnyx.com/v2/phone_numbers/%2B15552223333/messaging');
  assert.equal(requests[0].options.method, 'GET');
  assert.deepEqual(result.providerResponse.data.phone_number, {
    present: true,
    last4: '3333',
    digitCount: 11,
    countryCode: '+1',
    e164Like: true,
  });
  assert.equal(result.providerResponse.data.messaging_profile_id, 'profile-1');
  assert.equal(result.providerResponse.data.features.sms.domestic_two_way, true);
  assert.equal(JSON.stringify(result.providerResponse).includes('+15552223333'), false);
});

test('retrieves 10DLC phone number campaign assignment without leaking full number', async () => {
  const requests = [];
  const result = await retrieveTelnyx10dlcPhoneNumberCampaign({
    apiKey: 'redacted',
    phoneNumber: '+15552223333',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            phoneNumber: '+15552223333',
            campaignId: 'campaign-1',
            assignmentStatus: 'ASSIGNED',
            failureReasons: null,
          };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests[0].url, 'https://api.telnyx.com/v2/10dlc/phone_number_campaigns/%2B15552223333');
  assert.equal(result.providerResponse.data.phoneNumber.last4, '3333');
  assert.equal(result.providerResponse.data.campaignId, 'campaign-1');
  assert.equal(result.providerResponse.data.assignmentStatus, 'ASSIGNED');
  assert.equal(JSON.stringify(result.providerResponse).includes('+15552223333'), false);
});

test('returns safe Telnyx diagnostic errors', async () => {
  const result = await retrieveTelnyx10dlcPhoneNumberCampaign({
    apiKey: 'redacted',
    phoneNumber: '+15552223333',
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      async json() {
        return { errors: [{ code: '10010', title: 'Not found', detail: 'No assignment for +15552223333.' }] };
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, '10010');
  assert.equal(result.reason, 'Not found');
  assert.deepEqual(result.providerResponse, {
    errors: [{ code: '10010', title: 'Not found' }],
  });
  assert.equal(JSON.stringify(result).includes('+15552223333'), false);
});

test('describes SMS phone diagnostics without storing full phone value', () => {
  assert.deepEqual(smsPhoneDiagnostic('732-354-7648'), {
    present: true,
    last4: '7648',
    digitCount: 11,
    countryCode: '+1',
    e164Like: true,
  });
});

function signedTelnyxFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyHex = publicKeyDer.subarray(-32).toString('hex');
  const bodyText = JSON.stringify({
    data: {
      id: 'telnyx-event-1',
      event_type: 'message.received',
      payload: {
        id: 'telnyx-message-1',
        from: { phone_number: '+15550001111' },
        to: [{ phone_number: '+15552223333' }],
        text: 'STOP',
      },
    },
  });
  const timestamp = '1800000000';
  const signature = sign(null, Buffer.from(`${timestamp}|${bodyText}`), privateKey).toString('base64');
  return { bodyText, publicKeyHex, signature, timestamp };
}

test('validates Telnyx Ed25519 webhook signatures over raw timestamp and payload', () => {
  const fixture = signedTelnyxFixture();
  const result = validateTelnyxWebhookSignature({
    bodyText: fixture.bodyText,
    signatureHeader: fixture.signature,
    timestampHeader: fixture.timestamp,
    config: { telnyxPublicKey: fixture.publicKeyHex },
    now: new Date(Number(fixture.timestamp) * 1000),
  });

  assert.deepEqual(result, { ok: true });
});

test('fails Telnyx webhook verification closed for missing, stale, or bad signatures', () => {
  const fixture = signedTelnyxFixture();
  const now = new Date(Number(fixture.timestamp) * 1000);

  assert.deepEqual(
    validateTelnyxWebhookSignature({
      bodyText: fixture.bodyText,
      signatureHeader: fixture.signature,
      timestampHeader: fixture.timestamp,
      config: {},
      now,
    }),
    {
      ok: false,
      code: 'TELNYX_PUBLIC_KEY_MISSING',
      reason: 'TELNYX_PUBLIC_KEY is not configured.',
    },
  );
  assert.equal(validateTelnyxWebhookSignature({
    bodyText: fixture.bodyText,
    signatureHeader: '',
    timestampHeader: fixture.timestamp,
    config: { telnyxPublicKey: fixture.publicKeyHex },
    now,
  }).code, 'TELNYX_SIGNATURE_MISSING');
  assert.equal(validateTelnyxWebhookSignature({
    bodyText: fixture.bodyText,
    signatureHeader: fixture.signature,
    timestampHeader: fixture.timestamp,
    config: { telnyxPublicKey: fixture.publicKeyHex },
    now: new Date((Number(fixture.timestamp) + 600) * 1000),
  }).code, 'TELNYX_TIMESTAMP_OUT_OF_RANGE');
  assert.equal(validateTelnyxWebhookSignature({
    bodyText: fixture.bodyText.replace('STOP', 'START'),
    signatureHeader: fixture.signature,
    timestampHeader: fixture.timestamp,
    config: { telnyxPublicKey: fixture.publicKeyHex },
    now,
  }).code, 'TELNYX_SIGNATURE_MISMATCH');
});

test('parses Telnyx webhook JSON payloads without accepting malformed bodies', () => {
  const fixture = signedTelnyxFixture();
  const parsed = parseTelnyxWebhookPayloadText(fixture.bodyText);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.data.id, 'telnyx-event-1');
  assert.deepEqual(parseTelnyxWebhookPayloadText('{bad json'), {
    ok: false,
    code: 'TELNYX_WEBHOOK_PAYLOAD_INVALID',
    reason: 'Invalid Telnyx webhook JSON payload.',
  });
  assert.deepEqual(parseTelnyxWebhookPayloadText('[]'), {
    ok: false,
    code: 'TELNYX_WEBHOOK_PAYLOAD_INVALID',
    reason: 'Telnyx webhook payload must be a JSON object.',
  });
});

test('ignores malformed or unsupported Telnyx webhook event objects', () => {
  assert.deepEqual(flattenSmsProviderEvents('telnyx', {}), []);
  assert.deepEqual(flattenSmsProviderEvents('telnyx', {
    data: {
      id: 'event-1',
      event_type: 'message.unknown',
      payload: { id: 'message-1' },
    },
  }), []);
  assert.deepEqual(flattenSmsProviderEvents('telnyx', {
    data: {
      id: 'event-2',
      event_type: 'message.received',
      payload: { id: 'message-2', from: {}, to: [] },
    },
  }), []);
});
