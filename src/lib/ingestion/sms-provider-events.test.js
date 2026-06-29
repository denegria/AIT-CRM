import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ingestSmsProviderEvents,
} from './sms-provider-events.js';
import {
  SMS_EVENT_KINDS,
  flattenSmsProviderEvents,
  normalizeSmsPhone,
  smsProviderEventKey,
} from '../messaging/providers/sms.js';
import {
  SMS_CONSENT_EVENT_TYPES,
  SMS_CONSENT_STATUSES,
} from '../communication-consent/sms-consent.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function telnyxStopFixture(overrides = {}) {
  return {
    data: {
      id: 'telnyx-event-1',
      event_type: 'message.received',
      occurred_at: '2026-06-29T13:00:00.000Z',
      payload: {
        id: 'telnyx-message-1',
        from: { phone_number: '+15550001111' },
        to: [{ phone_number: '+15552223333' }],
        text: 'STOP',
        autoresponse_type: 'STOP',
        received_at: '2026-06-29T13:00:00.000Z',
        ...overrides.payload,
      },
      ...overrides.data,
    },
  };
}

function createServiceClient({
  duplicateMessage = false,
  existingConversation = null,
  existingContact = null,
  existingDeliveryMessageId = null,
  businessUnitId = 'bu-1',
  channelId = 'channel-sms-1',
  channelBusinessUnitId = 'bu-1',
  contactId = 'contact-1',
  leadId = 'lead-1',
  conversationId = 'conversation-1',
  conversationMessageId = 'conversation-message-1',
  conversationMessageInserted = true,
  sourceRowId = 'source-row-5',
  normalizedId = 'normalized-5',
  duplicateConsentEventId = null,
} = {}) {
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
        if (normalized.startsWith('select pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (normalized.startsWith('select id from import_batches where id = $1 for update')) {
          return { rows: [{ id: params[0] }] };
        }
        if (normalized.startsWith('select coalesce(max(source_row_number)')) {
          return { rows: [{ max_row: 4 }] };
        }
        if (normalized.startsWith('select cc.id, cc.business_unit_id::text as business_unit_id')) {
          return {
            rows: channelId
              ? [{ id: channelId, business_unit_id: channelBusinessUnitId }]
              : [],
          };
        }
        if (
          normalized.startsWith('select id from business_units')
          && normalized.includes('(id::text = $2 or lower(name) = lower($2))')
        ) {
          return { rows: businessUnitId ? [{ id: businessUnitId }] : [] };
        }
        if (
          normalized.startsWith('select id from business_units')
          && normalized.includes('order by name asc')
        ) {
          return { rows: businessUnitId ? [{ id: businessUnitId }] : [] };
        }
        if (
          normalized.startsWith('select 1 from conversation_messages')
          && normalized.includes("channel = 'sms'")
        ) {
          return { rows: duplicateMessage ? [{ exists: 1 }] : [] };
        }
        if (
          normalized.startsWith('select c.id::text as contact_id, l.id::text as lead_id')
          && normalized.includes('from conversations conv')
        ) {
          return {
            rows: existingConversation
              ? [{ contact_id: existingConversation.contact_id || null, lead_id: existingConversation.lead_id || null }]
              : [],
          };
        }
        if (
          normalized.startsWith('select c.id::text as contact_id, l.id::text as lead_id')
          && normalized.includes('from contacts c')
        ) {
          return {
            rows: existingContact
              ? [{ contact_id: existingContact.contact_id || null, lead_id: existingContact.lead_id || null }]
              : [],
          };
        }
        if (normalized.startsWith('insert into import_source_rows')) {
          return { rows: [{ id: sourceRowId }] };
        }
        if (normalized.startsWith('select u.id, u.name, u.email from users u')) {
          return { rows: [{ id: 'user-owner-1', name: 'Owner One', email: 'owner@example.com' }] };
        }
        if (normalized.startsWith('select id, name, email from users')) {
          return { rows: [{ id: 'user-owner-fallback', name: 'Fallback Owner', email: 'fallback@example.com' }] };
        }
        if (normalized.startsWith('insert into contacts')) {
          return { rows: [{ id: contactId }] };
        }
        if (normalized.startsWith('insert into leads')) {
          return { rows: [{ id: leadId }] };
        }
        if (normalized.startsWith('insert into activity_events')) {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into conversations')) {
          return { rows: [{ id: conversationId }] };
        }
        if (normalized.startsWith('insert into conversation_messages')) {
          return { rows: [{ id: conversationMessageId, inserted: conversationMessageInserted }] };
        }
        if (normalized.startsWith('select id from contact_channel_consent_events')) {
          return { rows: duplicateConsentEventId ? [{ id: duplicateConsentEventId }] : [] };
        }
        if (normalized.startsWith('insert into contact_channel_consents')) {
          return { rows: [{ id: 'consent-1', consent_status: params[5] }] };
        }
        if (normalized.startsWith('insert into contact_channel_consent_events')) {
          return { rows: [{ id: 'consent-event-1' }] };
        }
        if (normalized.startsWith('insert into import_normalized_records')) {
          return { rows: [{ id: normalizedId }] };
        }
        if (normalized.startsWith('insert into import_review_items')) {
          return { rows: [] };
        }
        if (
          normalized.startsWith('select id from conversation_messages')
          && normalized.includes('external_message_id = $3')
        ) {
          return { rows: existingDeliveryMessageId ? [{ id: existingDeliveryMessageId }] : [] };
        }
        if (normalized.startsWith('update conversation_messages')) {
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

test('normalizes SMS provider webhook shapes across Telnyx, Twilio, and Bandwidth', () => {
  const [telnyx] = flattenSmsProviderEvents('telnyx', telnyxStopFixture());
  assert.equal(telnyx.kind, SMS_EVENT_KINDS.INBOUND_MESSAGE);
  assert.equal(telnyx.provider, 'telnyx');
  assert.equal(telnyx.messageId, 'telnyx-message-1');
  assert.equal(telnyx.providerAccountId, '+15552223333');
  assert.equal(telnyx.participantPhone, '+15550001111');
  assert.equal(telnyx.consentKeyword, 'STOP');
  assert.equal(smsProviderEventKey(telnyx), 'telnyx:sms-event:telnyx-event-1');
  assert.equal(normalizeSmsPhone('(555) 222-3333'), '+5552223333');

  const [twilio] = flattenSmsProviderEvents('twilio', {
    MessageSid: 'SM123',
    MessageStatus: 'undelivered',
    From: '+15552223333',
    To: '+15550001111',
    ErrorCode: '30005',
  });
  assert.equal(twilio.kind, SMS_EVENT_KINDS.DELIVERY_STATUS);
  assert.equal(twilio.deliveryStatus, 'failed');
  assert.equal(twilio.messageId, 'SM123');

  const [bandwidth] = flattenSmsProviderEvents('bandwidth', [{
    type: 'message-received',
    time: '2026-06-29T13:00:00.000Z',
    message: {
      id: 'bw-message-1',
      owner: '+15552223333',
      from: '+15550001111',
      to: ['+15552223333'],
      text: 'Hello',
      direction: 'in',
    },
  }]);
  assert.equal(bandwidth.kind, SMS_EVENT_KINDS.INBOUND_MESSAGE);
  assert.equal(bandwidth.providerAccountId, '+15552223333');
  assert.equal(bandwidth.text, 'Hello');
});

test('promotes Telnyx inbound STOP into CRM, conversation, and SMS consent ledger', async () => {
  const { client, calls } = createServiceClient();
  const events = flattenSmsProviderEvents('telnyx', telnyxStopFixture());

  const result = await ingestSmsProviderEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events,
    smsConfig: {},
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.consentRecorded, 1);
  assert.equal(result.eventResults[0].action, 'created_sms_lead');
  assert.equal(result.eventResults[0].businessUnitId, 'bu-1');
  assert.equal(result.eventResults[0].channelId, 'channel-sms-1');
  assert.equal(result.eventResults[0].contactId, 'contact-1');
  assert.equal(result.eventResults[0].leadId, 'lead-1');
  assert.equal(result.eventResults[0].consentEventType, SMS_CONSENT_EVENT_TYPES.OPT_OUT);
  assert.equal(result.eventResults[0].consentStatus, SMS_CONSENT_STATUSES.OPTED_OUT);
  assert.equal(result.eventResults[0].conversationIdempotencyKey, 'telnyx:sms:+15552223333:telnyx-message-1');

  const channelLookup = calls.find((call) => call.sql.startsWith('select cc.id, cc.business_unit_id::text as business_unit_id'));
  assert.deepEqual(channelLookup.params, ['org-1', 'telnyx', ['+15552223333', '+15550001111']]);

  const contactInsert = calls.find((call) => call.sql.startsWith('insert into contacts'));
  assert.deepEqual(contactInsert.params, ['org-1', 'bu-1', 'SMS User 001111', '+15550001111']);

  const conversationInsert = calls.find((call) => call.sql.startsWith('insert into conversations'));
  assert.deepEqual(conversationInsert.params.slice(0, 12), [
    'org-1',
    'bu-1',
    'contact-1',
    'lead-1',
    'channel-sms-1',
    'sms',
    'telnyx',
    '+15552223333',
    '+15550001111',
    '+15550001111',
    'open',
    new Date('2026-06-29T13:00:00.000Z'),
  ]);

  const messageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(messageInsert.params[5], 'sms');
  assert.equal(messageInsert.params[6], 'telnyx');
  assert.equal(messageInsert.params[7], 'inbound');
  assert.equal(messageInsert.params[8], 'received');
  assert.equal(messageInsert.params[11], 'telnyx-message-1');
  assert.equal(messageInsert.params[12], 'telnyx:sms:+15552223333:telnyx-message-1');
  assert.equal(messageInsert.params[15], 'STOP');

  const consentInsert = calls.find((call) => call.sql.startsWith('insert into contact_channel_consent_events'));
  assert.equal(consentInsert.params[5], SMS_CONSENT_EVENT_TYPES.OPT_OUT);
  assert.equal(consentInsert.params[6], SMS_CONSENT_STATUSES.OPTED_OUT);
  assert.equal(consentInsert.params[10], 'telnyx');
  assert.equal(consentInsert.params[11], 'telnyx-event-1');
});

test('skips duplicate SMS provider message ids without CRM writes', async () => {
  const { client, calls } = createServiceClient({ duplicateMessage: true });
  const events = flattenSmsProviderEvents('telnyx', telnyxStopFixture());

  const result = await ingestSmsProviderEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events,
    smsConfig: {},
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.eventResults[0].skippedReason, 'duplicate_sms_message_id');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into import_source_rows')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contact_channel_consent_events')), false);
});

test('updates delivery status callbacks without creating duplicate messages', async () => {
  const { client, calls } = createServiceClient({ existingDeliveryMessageId: 'conversation-message-existing' });
  const events = flattenSmsProviderEvents('bandwidth', [{
    type: 'message-delivered',
    time: '2026-06-29T13:05:00.000Z',
    message: {
      id: 'outbound-provider-message-1',
      owner: '+15552223333',
      from: '+15552223333',
      to: ['+15550001111'],
      direction: 'out',
    },
  }]);

  const result = await ingestSmsProviderEvents(client, {
    organizationId: 'org-1',
    events,
    smsConfig: {},
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.deliveryUpdated, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.batchId, null);
  assert.equal(result.eventResults[0].conversationMessageId, 'conversation-message-existing');
  assert.equal(result.eventResults[0].deliveryStatus, 'delivered');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into conversation_messages')), false);

  const update = calls.find((call) => call.sql.startsWith('update conversation_messages'));
  assert.equal(update.params[1], 'conversation-message-existing');
  assert.equal(update.params[2], 'delivered');
  assert.equal(update.params[3], 'outbound-provider-message-1');
});
