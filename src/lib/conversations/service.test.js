import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONVERSATION_CHANNELS,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
} from './constants.js';
import {
  conversationIdentityKey,
  messageIdempotencyKey,
  messengerConversationMessageInput,
  normalizeConversationMessageInput,
  recordConversationMessage,
  whatsappConversationMessageInput,
} from './service.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createConversationClient({ duplicate = false } = {}) {
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
          return { rows: [{ id: 'message-1', inserted: !duplicate }] };
        }

        throw new Error('Unexpected query: ' + normalized);
      },
    },
  };
}

test('normalizes Messenger and WhatsApp events into the same conversation model', () => {
  const messenger = messengerConversationMessageInput({
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    pageId: 'page-1',
    senderId: 'sender-1',
    messageId: 'mid-1',
    text: 'Need a storefront sign',
    timestamp: 1779275460000,
    raw: { object: 'page' },
  });
  const whatsapp = whatsappConversationMessageInput({
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    phoneNumberId: 'phone-number-1',
    waId: '15551234567',
    messageId: 'wamid-1',
    text: 'Can I get a quote?',
    timestamp: 1779275460,
    raw: { object: 'whatsapp_business_account' },
  });

  assert.equal(messenger.channel, CONVERSATION_CHANNELS.MESSENGER);
  assert.equal(whatsapp.channel, CONVERSATION_CHANNELS.WHATSAPP);
  assert.equal(messenger.provider, 'meta');
  assert.equal(whatsapp.provider, 'meta');
  assert.equal(messenger.direction, MESSAGE_DIRECTIONS.INBOUND);
  assert.equal(whatsapp.direction, MESSAGE_DIRECTIONS.INBOUND);
  assert.equal(messenger.deliveryStatus, MESSAGE_DELIVERY_STATUSES.RECEIVED);
  assert.equal(whatsapp.deliveryStatus, MESSAGE_DELIVERY_STATUSES.RECEIVED);
  assert.equal(messenger.providerThreadId, 'sender-1');
  assert.equal(whatsapp.providerThreadId, '15551234567');
  assert.equal(messenger.idempotencyKey, 'meta:messenger:page-1:mid-1');
  assert.equal(whatsapp.idempotencyKey, 'meta:whatsapp:phone-number-1:wamid-1');
});

test('builds stable conversation and idempotency keys', () => {
  assert.equal(
    conversationIdentityKey({
      organizationId: 'org-1',
      provider: 'meta',
      channel: 'messenger',
      providerAccountId: 'page-1',
      providerThreadId: 'sender-1',
      externalParticipantId: 'sender-1',
    }),
    'org-1:meta:messenger:page-1:sender-1:sender-1',
  );
  assert.equal(
    messageIdempotencyKey({
      provider: 'meta',
      channel: 'messenger',
      providerAccountId: 'page-1',
      externalMessageId: 'mid-1',
    }),
    'meta:messenger:page-1:mid-1',
  );
});

test('rejects unsupported channels, directions, and statuses before persistence', () => {
  assert.throws(() => normalizeConversationMessageInput({
    organizationId: 'org-1',
    channel: 'sms',
    providerAccountId: 'phone-1',
    providerThreadId: 'thread-1',
    externalParticipantId: 'customer-1',
  }), /Unsupported conversation channel/);

  assert.throws(() => normalizeConversationMessageInput({
    organizationId: 'org-1',
    channel: 'messenger',
    direction: 'sideways',
    providerAccountId: 'page-1',
    providerThreadId: 'thread-1',
    externalParticipantId: 'customer-1',
  }), /Unsupported message direction/);

  assert.throws(() => normalizeConversationMessageInput({
    organizationId: 'org-1',
    channel: 'messenger',
    deliveryStatus: 'teleported',
    providerAccountId: 'page-1',
    providerThreadId: 'thread-1',
    externalParticipantId: 'customer-1',
  }), /Unsupported message delivery status/);
});

test('records conversation messages with provider-neutral idempotency', async () => {
  const { client, calls } = createConversationClient();
  const result = await recordConversationMessage(client, messengerConversationMessageInput({
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    pageId: 'page-1',
    senderId: 'sender-1',
    messageId: 'mid-1',
    text: 'Need a storefront sign',
    timestamp: 1779275460000,
    raw: { source: 'fixture' },
  }));

  assert.equal(result.conversationId, 'conversation-1');
  assert.equal(result.messageId, 'message-1');
  assert.equal(result.inserted, true);
  assert.equal(result.idempotencyKey, 'meta:messenger:page-1:mid-1');
  assert.equal(result.conversationKey, 'org-1:meta:messenger:page-1:sender-1:sender-1');

  const conversationInsert = calls.find((call) => call.sql.startsWith('insert into conversations'));
  assert.deepEqual(conversationInsert.params.slice(0, 12), [
    'org-1',
    'bu-1',
    'contact-1',
    'lead-1',
    null,
    'messenger',
    'meta',
    'page-1',
    'sender-1',
    'sender-1',
    'open',
    new Date(1779275460000),
  ]);

  const messageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(messageInsert.params[0], 'conversation-1');
  assert.equal(messageInsert.params[5], 'messenger');
  assert.equal(messageInsert.params[7], 'inbound');
  assert.equal(messageInsert.params[8], 'received');
  assert.equal(messageInsert.params[12], 'meta:messenger:page-1:mid-1');
  assert.equal(JSON.parse(messageInsert.params[16]).source, 'fixture');
});

test('duplicate provider events update the existing message instead of creating a second row', async () => {
  const { client } = createConversationClient({ duplicate: true });
  const result = await recordConversationMessage(client, whatsappConversationMessageInput({
    organizationId: 'org-1',
    phoneNumberId: 'phone-number-1',
    waId: '15551234567',
    messageId: 'wamid-1',
    text: 'Following up',
    timestamp: 1779275460,
  }));

  assert.equal(result.messageId, 'message-1');
  assert.equal(result.inserted, false);
  assert.equal(result.idempotencyKey, 'meta:whatsapp:phone-number-1:wamid-1');
});
