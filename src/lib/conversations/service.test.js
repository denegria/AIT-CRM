import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONVERSATION_CHANNELS,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
} from './constants.js';
import {
  conversationIdentityKey,
  filterConversationRowsForBusinessUnit,
  formatConversationMessageRow,
  formatConversationMessages,
  manualOutboundConversationMessageInput,
  messageIdempotencyKey,
  messengerConversationMessageInput,
  normalizeConversationMessageInput,
  recordConversationMessage,
  summarizeInboxConversations,
  updateConversationMessageDeliveryStatus,
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

test('normalizes manual outbound sends as pending audit records', () => {
  const message = manualOutboundConversationMessageInput({
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    channelId: 'channel-1',
    channel: 'whatsapp',
    providerAccountId: 'phone-number-1',
    providerThreadId: '15551234567',
    externalParticipantId: '15551234567',
    senderIdentity: 'phone-number-1',
    recipientIdentity: '15551234567',
    text: 'Manual follow-up',
    requestId: 'request-1',
    raw: { source: 'manual_outbound' },
  });

  assert.equal(message.direction, MESSAGE_DIRECTIONS.OUTBOUND);
  assert.equal(message.deliveryStatus, MESSAGE_DELIVERY_STATUSES.PENDING);
  assert.equal(message.idempotencyKey, 'meta:whatsapp:phone-number-1:manual:request-1');
  assert.equal(message.senderIdentity, 'phone-number-1');
  assert.equal(message.recipientIdentity, '15551234567');
});

test('updates outbound delivery audit state with provider ids and errors', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: normalizeSql(sql), params });
      return {
        rows: [{
          id: 'message-1',
          delivery_status: params[2],
          external_message_id: params[3],
          error_code: params[5],
          error_message: params[6],
        }],
      };
    },
  };

  const sent = await updateConversationMessageDeliveryStatus(client, {
    organizationId: 'org-1',
    messageId: 'message-1',
    deliveryStatus: 'sent',
    externalMessageId: 'provider-message-1',
    rawPayloadJson: { ok: true },
  });
  const failed = await updateConversationMessageDeliveryStatus(client, {
    organizationId: 'org-1',
    messageId: 'message-1',
    deliveryStatus: 'failed',
    errorCode: 'GRAPH_RESPONSE_ERROR',
    errorMessage: 'Rejected by provider',
  });

  assert.equal(sent.delivery_status, 'sent');
  assert.equal(sent.external_message_id, 'provider-message-1');
  assert.equal(failed.delivery_status, 'failed');
  assert.equal(failed.error_code, 'GRAPH_RESPONSE_ERROR');
  assert.equal(calls[0].params[4], JSON.stringify({ ok: true }));
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

test('formats conversation messages with provider-neutral linked context', () => {
  const payload = formatConversationMessageRow({
    message: {
      id: 'message-1',
      conversationId: 'conversation-1',
      businessUnitId: 'bu-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      provider: 'meta',
      channel: 'messenger',
      direction: 'inbound',
      deliveryStatus: 'received',
      providerAccountId: 'page-1',
      providerThreadId: 'sender-1',
      externalMessageId: 'mid-1',
      senderIdentity: 'sender-1',
      recipientIdentity: 'page-1',
      textBody: 'Can I get a channel letter quote?',
      occurredAt: new Date('2026-05-26T10:30:00.000Z'),
    },
    conversation: {
      id: 'conversation-1',
      status: 'open',
      providerThreadId: 'sender-1',
      externalParticipantId: 'sender-1',
      lastMessageAt: new Date('2026-05-26T10:30:00.000Z'),
    },
    channelConfig: {
      id: 'channel-1',
      label: 'AIT Signs Page',
      providerAccountId: 'page-1',
      isActive: true,
    },
    contact: {
      id: 'contact-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '555-0100',
    },
    lead: {
      id: 'lead-1',
      status: 'Qualified',
      sourceName: 'Messenger',
      sourceType: 'facebook_messenger',
    },
    businessUnit: {
      id: 'bu-1',
      name: 'AIT Signs',
      label: 'Division',
      color: '#2563eb',
    },
  });

  assert.equal(payload.providerLabel, 'Meta');
  assert.equal(payload.channelLabel, 'Messenger');
  assert.equal(payload.directionLabel, 'Inbound');
  assert.equal(payload.deliveryStatusLabel, 'Received');
  assert.equal(payload.timestamp, '2026-05-26T10:30:00.000Z');
  assert.equal(payload.text, 'Can I get a channel letter quote?');
  assert.equal(payload.identities.sender, 'sender-1');
  assert.equal(payload.conversation.statusLabel, 'Open');
  assert.equal(payload.channelConfig.label, 'AIT Signs Page');
  assert.equal(payload.contact.name, 'Ada Lovelace');
  assert.equal(payload.lead.sourceName, 'Messenger');
  assert.equal(payload.businessUnit.name, 'AIT Signs');
});

test('filters and orders conversation rows for business-unit scoped reads', () => {
  const rows = [
    {
      message: {
        id: 'older-hidden',
        businessUnitId: 'bu-hidden',
        provider: 'meta',
        channel: 'messenger',
        direction: 'inbound',
        deliveryStatus: 'received',
        occurredAt: new Date('2026-05-26T09:00:00.000Z'),
      },
    },
    {
      message: {
        id: 'newer-visible',
        businessUnitId: 'bu-1',
        provider: 'meta',
        channel: 'whatsapp',
        direction: 'outbound',
        deliveryStatus: 'sent',
        occurredAt: new Date('2026-05-26T11:00:00.000Z'),
      },
    },
    {
      message: {
        id: 'unassigned-visible',
        businessUnitId: null,
        provider: 'meta',
        channel: 'messenger',
        direction: 'inbound',
        deliveryStatus: 'received',
        occurredAt: new Date('2026-05-26T10:00:00.000Z'),
      },
    },
  ];

  assert.deepEqual(
    filterConversationRowsForBusinessUnit(rows, ['bu-1']).map((row) => row.message.id),
    ['newer-visible', 'unassigned-visible'],
  );
  assert.deepEqual(
    formatConversationMessages(rows, { businessUnitIds: ['bu-1'] }).map((message) => message.id),
    ['newer-visible', 'unassigned-visible'],
  );
  assert.deepEqual(
    filterConversationRowsForBusinessUnit(rows, []).map((row) => row.message.id),
    ['unassigned-visible'],
  );
});

test('summarizes inbox threads with derived owner and attention labels', () => {
  const messages = [
    {
      id: 'message-1',
      conversationId: 'conversation-1',
      channel: 'whatsapp',
      channelLabel: 'WhatsApp',
      providerLabel: 'Meta',
      direction: 'inbound',
      directionLabel: 'Inbound',
      deliveryStatus: 'received',
      deliveryStatusLabel: 'Received',
      text: 'Can I get updated pricing?',
      timestamp: '2026-06-29T16:00:00.000Z',
      createdAt: '2026-06-29T16:00:00.000Z',
      identities: { participant: '15551230001', sender: '15551230001', recipient: 'page-1' },
      conversation: { status: 'open', statusLabel: 'Open' },
      channelConfig: { label: 'AIT Signs WhatsApp' },
      contact: { id: 'contact-1', name: 'Ada Lovelace' },
      lead: { id: 'lead-1', status: 'Qualified', sourceName: 'Website Form', assignedUserId: 'user-2' },
      businessUnit: { id: 'bu-1', name: 'AIT Signs' },
    },
    {
      id: 'message-2',
      conversationId: 'conversation-2',
      channel: 'messenger',
      channelLabel: 'Messenger',
      providerLabel: 'Meta',
      direction: 'outbound',
      directionLabel: 'Outbound',
      deliveryStatus: 'failed',
      deliveryStatusLabel: 'Failed',
      text: 'Following up on your proof approval.',
      timestamp: '2026-06-29T14:00:00.000Z',
      createdAt: '2026-06-29T14:00:00.000Z',
      identities: { participant: 'fb-user-1', sender: 'page-1', recipient: 'fb-user-1' },
      conversation: { status: 'open', statusLabel: 'Open' },
      channelConfig: { label: 'AIT Signs Facebook' },
      contact: { id: 'contact-2', name: 'Grace Hopper' },
      lead: { id: 'lead-2', status: 'Proposal Sent', sourceName: 'Facebook Lead Ad', assignedUserId: 'user-1' },
      businessUnit: { id: 'bu-1', name: 'AIT Signs' },
    },
    {
      id: 'message-3',
      conversationId: 'conversation-3',
      channel: 'whatsapp',
      channelLabel: 'WhatsApp',
      providerLabel: 'Meta',
      direction: 'outbound',
      directionLabel: 'Outbound',
      deliveryStatus: 'delivered',
      deliveryStatusLabel: 'Delivered',
      text: 'We received your placement request.',
      timestamp: '2026-06-29T13:00:00.000Z',
      createdAt: '2026-06-29T13:00:00.000Z',
      identities: { participant: '15551230003', sender: 'page-1', recipient: '15551230003' },
      conversation: { status: 'open', statusLabel: 'Open' },
      channelConfig: { label: 'AIT USA WhatsApp' },
      contact: { id: 'contact-3', name: 'Katherine Johnson' },
      lead: { id: 'lead-3', status: 'New Lead', sourceName: 'Placement Test', assignedUserId: 'user-2' },
      businessUnit: { id: 'bu-2', name: 'AIT USA Institute' },
    },
  ];
  const tasks = [
    {
      id: 'task-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      title: 'Return pricing call',
      status: 'open',
      priority: 'high',
      dueAt: '2099-06-29T17:00:00.000Z',
      ownerUserId: 'user-1',
    },
    {
      id: 'task-2',
      contactId: null,
      leadId: 'lead-3',
      title: 'Review placement result',
      status: 'open',
      priority: 'high',
      dueAt: '2099-06-29T18:00:00.000Z',
      ownerUserId: 'user-1',
    },
  ];
  const users = [
    { id: 'user-1', name: 'Carlos Rivera', email: 'carlos@example.com' },
    { id: 'user-2', name: 'Dana Kim', email: 'dana@example.com' },
  ];

  const inbox = summarizeInboxConversations(messages, { tasks, users });

  assert.equal(inbox.length, 3);
  assert.equal(inbox[0].id, 'conversation-1');
  assert.equal(inbox[0].owner.label, 'Task owner: Carlos Rivera');
  assert.match(inbox[0].owner.reason, /Return pricing call/);
  assert.equal(inbox[0].attention.code, 'needs_reply');
  assert.equal(inbox[0].contact.href, '/contacts/contact-1');
  assert.equal(inbox[0].status.label, 'Open · Lead Qualified');
  assert.equal(inbox[1].owner.label, 'Lead owner: Carlos Rivera');
  assert.equal(inbox[1].attention.code, 'delivery_issue');
  assert.equal(inbox[2].owner.label, 'Task owner: Carlos Rivera');
  assert.match(inbox[2].owner.reason, /Review placement result/);
});
