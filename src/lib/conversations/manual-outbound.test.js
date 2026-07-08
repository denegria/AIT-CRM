import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_PROVIDERS,
  MESSAGE_DELIVERY_STATUSES,
} from './constants.js';
import {
  MANUAL_OUTBOUND_BLOCK_CODES,
  evaluateManualOutboundGuardrails,
  isWithinQuietHours,
  normalizeManualOutboundRequest,
  renderManualTemplateBody,
  sendManualOutboundMessage,
} from './manual-outbound.js';

const NOW = new Date('2026-05-26T15:00:00.000Z');
const META_CONFIG = {
  defaultPageAccessToken: 'page-token',
  defaultWhatsAppAccessToken: 'wa-token',
};
const SMS_CONFIG = {
  liveSendEnabled: true,
  testSendMode: true,
  recipientAllowlist: ['+15550001111'],
  telnyxApiKey: 'redacted',
  telnyxMessagingProfileId: 'profile-1',
  telnyxFromNumber: '+15552223333',
};

function baseContact(overrides = {}) {
  return {
    id: 'contact-1',
    name: 'Ada Signs',
    primaryBusinessUnitId: 'bu-1',
    ...overrides,
  };
}

function baseConversation(overrides = {}) {
  return {
    id: 'conversation-1',
    channel_id: 'channel-1',
    channel_is_active: true,
    provider_account_id: 'page-1',
    provider_thread_id: 'sender-1',
    external_participant_id: 'sender-1',
    last_inbound_at: '2026-05-26T14:30:00.000Z',
    ...overrides,
  };
}

function baseSmsConversation(overrides = {}) {
  return baseConversation({
    provider: CONVERSATION_PROVIDERS.TELNYX,
    provider_account_id: '+15552223333',
    provider_thread_id: '+15550001111',
    external_participant_id: '+15550001111',
    ...overrides,
  });
}

function baseSetting(overrides = {}) {
  return {
    id: 'setting-1',
    is_enabled: true,
    settings_json: { quietHours: { enabled: false } },
    ...overrides,
  };
}

function baseTemplate(overrides = {}) {
  return {
    id: 'template-1',
    channel: 'whatsapp',
    purpose: 'manual_follow_up',
    body_text: 'Hi {{ contact_name }}, thanks for reaching out.',
    status: 'active',
    provider_status: 'approved',
    is_enabled: true,
    metadata_json: { providerTemplateName: 'manual_follow_up', languageCode: 'en_US' },
    ...overrides,
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createManualSendClient({ duplicate = false, updateThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalized = normalizeSql(sql);
        calls.push({ sql: normalized, params });

        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into conversations')) {
          return { rows: [{ id: 'conversation-1' }] };
        }
        if (normalized.startsWith('insert into conversation_messages')) {
          return {
            rows: [{
              id: 'message-1',
              inserted: !duplicate,
              delivery_status: duplicate ? MESSAGE_DELIVERY_STATUSES.SENT : MESSAGE_DELIVERY_STATUSES.PENDING,
              external_message_id: duplicate ? 'provider-message-existing' : null,
              error_code: null,
              error_message: null,
            }],
          };
        }
        if (normalized.startsWith('update conversation_messages')) {
          if (updateThrows) throw new Error('database unavailable');
          return {
            rows: [{
              id: params[1],
              delivery_status: params[2],
              external_message_id: params[3],
              error_code: params[5],
              error_message: params[6],
            }],
          };
        }

        throw new Error('Unexpected query: ' + normalized);
      },
    },
  };
}

function baseSendContext(overrides = {}) {
  return {
    conversation: {
      ...baseConversation(),
      business_unit_id: 'bu-1',
      lead_id: 'lead-1',
    },
    channelSetting: baseSetting(),
    template: null,
    ...overrides,
  };
}

test('normalizes manual outbound requests and renders simple templates', () => {
  const request = normalizeManualOutboundRequest({
    channel: ' WhatsApp ',
    text: '  Hello  ',
    requestId: 'request-1',
  });

  assert.deepEqual(request, {
    channel: 'whatsapp',
    textBody: 'Hello',
    templateId: null,
    requestId: 'request-1',
  });
  assert.equal(
    renderManualTemplateBody('Hi {{ contact_name }} from {{company_name}}', {
      contact_name: 'Ada',
      company_name: 'AIT',
    }),
    'Hi Ada from AIT',
  );
});

test('allows a configured Messenger send inside the service window', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseConversation(),
    channelSetting: baseSetting(),
    metaConfig: META_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.MESSENGER,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.serviceWindowOpen, true);
});

test('allows a configured SMS send through a Telnyx conversation', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseSmsConversation(),
    channelSetting: baseSetting(),
    smsConfig: SMS_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.SMS,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    now: NOW,
  });

  assert.equal(result.ok, true);
});

test('allows SMS sends with configured Telnyx sender fallback', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseSmsConversation({ provider_account_id: '' }),
    channelSetting: baseSetting(),
    smsConfig: SMS_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.SMS,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    now: NOW,
  });

  assert.equal(result.ok, true);
});

test('blocks SMS sends without Telnyx provider config', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseSmsConversation(),
    channelSetting: baseSetting(),
    smsConfig: {},
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.SMS,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    now: NOW,
  });
  const codes = result.reasons.map((reason) => reason.code);

  assert.equal(result.ok, false);
  assert.equal(codes.includes(MANUAL_OUTBOUND_BLOCK_CODES.PROVIDER_CONFIG_MISSING), true);
});

test('blocks SMS sends unless live or test send mode is enabled', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseSmsConversation(),
    channelSetting: baseSetting(),
    smsConfig: {
      ...SMS_CONFIG,
      liveSendEnabled: false,
      testSendMode: false,
    },
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.SMS,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reasons.some((reason) => reason.code === MANUAL_OUTBOUND_BLOCK_CODES.SMS_SEND_DISABLED),
    true,
  );
});

test('blocks SMS sends when the recipient is outside the staging allowlist', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseSmsConversation({ external_participant_id: '+15550009999', provider_thread_id: '+15550009999' }),
    channelSetting: baseSetting(),
    smsConfig: SMS_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.SMS,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reasons.some((reason) => reason.code === MANUAL_OUTBOUND_BLOCK_CODES.SMS_RECIPIENT_NOT_ALLOWLISTED),
    true,
  );
});

test('blocks SMS sends without recipient identity', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseSmsConversation({
      provider_thread_id: '',
      external_participant_id: '',
    }),
    channelSetting: baseSetting(),
    smsConfig: SMS_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.SMS,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reasons.some((reason) => reason.code === MANUAL_OUTBOUND_BLOCK_CODES.RECIPIENT_MISSING),
    true,
  );
});

test('blocks by default when channel config, recipient identity, or consent posture is unsafe', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact({ isDoNotCall: true }),
    conversation: null,
    channelSetting: null,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.WHATSAPP,
      text: 'Manual follow-up',
      requestId: 'request-1',
    }),
    now: NOW,
  });
  const codes = result.reasons.map((reason) => reason.code);

  assert.equal(result.ok, false);
  assert.equal(codes.includes(MANUAL_OUTBOUND_BLOCK_CODES.CONTACT_BLOCKED), true);
  assert.equal(codes.includes(MANUAL_OUTBOUND_BLOCK_CODES.CHANNEL_SETTING_MISSING), true);
  assert.equal(codes.includes(MANUAL_OUTBOUND_BLOCK_CODES.RECIPIENT_MISSING), true);
});

test('blocks Messenger outside 24 hours and WhatsApp freeform outside 24 hours', () => {
  const staleConversation = baseConversation({ last_inbound_at: '2026-05-24T14:30:00.000Z' });
  const messenger = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: staleConversation,
    channelSetting: baseSetting(),
    metaConfig: META_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.MESSENGER,
      text: 'Checking in',
      requestId: 'request-1',
    }),
    now: NOW,
  });
  const whatsapp = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: staleConversation,
    channelSetting: baseSetting(),
    metaConfig: META_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.WHATSAPP,
      text: 'Checking in',
      requestId: 'request-2',
    }),
    now: NOW,
  });

  assert.equal(messenger.reasons[0].code, MANUAL_OUTBOUND_BLOCK_CODES.SERVICE_WINDOW_CLOSED);
  assert.equal(whatsapp.reasons[0].code, MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_REQUIRED);
});

test('requires approved provider templates for WhatsApp template sends', () => {
  const request = normalizeManualOutboundRequest({
    channel: CONVERSATION_CHANNELS.WHATSAPP,
    templateId: 'template-1',
    requestId: 'request-1',
  });
  const rejected = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseConversation({ last_inbound_at: '2026-05-24T14:30:00.000Z' }),
    channelSetting: baseSetting(),
    template: baseTemplate({ provider_status: 'pending' }),
    request,
    metaConfig: META_CONFIG,
    now: NOW,
  });
  const missingProviderName = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseConversation({ last_inbound_at: '2026-05-24T14:30:00.000Z' }),
    channelSetting: baseSetting(),
    template: baseTemplate({ metadata_json: {} }),
    request,
    metaConfig: META_CONFIG,
    now: NOW,
  });

  assert.equal(rejected.reasons[0].code, MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_NOT_APPROVED);
  assert.equal(missingProviderName.reasons[0].code, MANUAL_OUTBOUND_BLOCK_CODES.TEMPLATE_PROVIDER_NAME_MISSING);
});

test('requires prior inbound evidence for WhatsApp template sends', () => {
  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseConversation({ last_inbound_at: null }),
    channelSetting: baseSetting(),
    template: baseTemplate(),
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.WHATSAPP,
      templateId: 'template-1',
      requestId: 'request-1',
    }),
    metaConfig: META_CONFIG,
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reasons.some((reason) => reason.code === MANUAL_OUTBOUND_BLOCK_CODES.RECIPIENT_MISSING),
    true,
  );
});

test('blocks during quiet hours unless settings explicitly disable them', () => {
  assert.equal(isWithinQuietHours({
    now: new Date('2026-05-26T21:00:00.000Z'),
    settingsJson: {},
  }), true);

  const result = evaluateManualOutboundGuardrails({
    contact: baseContact(),
    conversation: baseConversation(),
    channelSetting: baseSetting({ settings_json: {} }),
    metaConfig: META_CONFIG,
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.MESSENGER,
      text: 'Thanks',
      requestId: 'request-1',
    }),
    now: new Date('2026-05-26T21:00:00.000Z'),
  });

  assert.equal(result.reasons[0].code, MANUAL_OUTBOUND_BLOCK_CODES.QUIET_HOURS);
});

test('short-circuits duplicate manual request ids without dispatching provider send', async () => {
  const { client, calls } = createManualSendClient({ duplicate: true });
  let providerCalls = 0;

  const result = await sendManualOutboundMessage(client, {
    organizationId: 'org-1',
    actorUserId: 'user-1',
    contact: baseContact(),
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.MESSENGER,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    context: baseSendContext(),
    metaConfig: META_CONFIG,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider should not be called for duplicates');
    },
    now: NOW,
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, MESSAGE_DELIVERY_STATUSES.SENT);
  assert.equal(result.providerMessageId, 'provider-message-existing');
  assert.equal(providerCalls, 0);

  const messageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(messageInsert.params[20], true);
  assert.equal(calls.some((call) => call.sql.startsWith('update conversation_messages')), false);
});

test('surfaces audit update failures after provider send without hiding provider result', async () => {
  const { client } = createManualSendClient({ updateThrows: true });

  const result = await sendManualOutboundMessage(client, {
    organizationId: 'org-1',
    actorUserId: 'user-1',
    contact: baseContact(),
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.MESSENGER,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    context: baseSendContext(),
    metaConfig: META_CONFIG,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ recipient_id: 'sender-1', message_id: 'provider-message-1' }),
    }),
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.status, MESSAGE_DELIVERY_STATUSES.SENT);
  assert.equal(result.providerMessageId, 'provider-message-1');
  assert.deepEqual(result.audit, {
    ok: false,
    code: 'audit_update_failed',
    message: 'database unavailable',
  });
});

test('sends SMS through Telnyx and records the outbound audit row as telnyx', async () => {
  const { client, calls } = createManualSendClient();
  const requests = [];

  const result = await sendManualOutboundMessage(client, {
    organizationId: 'org-1',
    actorUserId: 'user-1',
    contact: baseContact(),
    request: normalizeManualOutboundRequest({
      channel: CONVERSATION_CHANNELS.SMS,
      text: 'Thanks for reaching out',
      requestId: 'request-1',
    }),
    context: baseSendContext({ conversation: { ...baseSmsConversation(), business_unit_id: 'bu-1', lead_id: 'lead-1' } }),
    metaConfig: META_CONFIG,
    smsConfig: SMS_CONFIG,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data: {
            id: 'telnyx-message-1',
            to: [{ phone_number: '+15550001111', status: 'queued' }],
          },
        }),
      };
    },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, MESSAGE_DELIVERY_STATUSES.SENT);
  assert.equal(result.providerMessageId, 'telnyx-message-1');
  assert.equal(requests[0].url, 'https://api.telnyx.com/v2/messages');
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'request-1');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    from: '+15552223333',
    to: '+15550001111',
    text: 'Thanks for reaching out',
    messaging_profile_id: 'profile-1',
  });

  const messageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(messageInsert.params[5], CONVERSATION_CHANNELS.SMS);
  assert.equal(messageInsert.params[6], CONVERSATION_PROVIDERS.TELNYX);
  assert.equal(messageInsert.params[12], 'telnyx:sms:+15552223333:manual:request-1');
});
