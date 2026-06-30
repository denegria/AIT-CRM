import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSmsCampaignSendConfigFromEnv,
  sendTelnyxSmsMessage,
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
  });

  assert.equal(staging.liveSendEnabled, true);
  assert.equal(staging.testSendMode, true);
  assert.equal(staging.maxRecipients, 1);
  assert.deepEqual(staging.recipientAllowlist, ['+15550001111', '+15550002222']);

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
  assert.equal(requests[0].url, 'https://api.telnyx.com/v2/messages');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer redacted');
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
});
