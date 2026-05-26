import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  MESSENGER_INBOUND_SOURCE_SHEET,
  ingestMessengerInboundEvents,
  messengerInboundEventKey,
} from './messenger-inbound.js';
import {
  createMetaProviderConfig,
  flattenMetaMessengerEvents,
  validateMetaAppSecretSignature,
} from '../messaging/providers/meta.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function messengerFixture(overrides = {}) {
  const message = {
    mid: 'msg-1',
    text: 'Need a storefront sign',
    ...overrides.message,
  };
  const messaging = {
    sender: { id: 'sender-1' },
    recipient: { id: 'page-1' },
    timestamp: 1779275460000,
    message,
    ...overrides.messaging,
  };
  const payload = {
    object: 'page',
    entry: [
      {
        id: overrides.entryId || 'page-1',
        time: 1779275460,
        messaging: [messaging],
      },
    ],
  };

  return flattenMetaMessengerEvents(payload)[0];
}

function createServiceClient({
  duplicateMessage = false,
  existingLead = null,
  businessUnitId = 'bu-1',
  contactId = 'contact-1',
  leadId = 'lead-1',
  conversationId = 'conversation-1',
  conversationMessageId = 'conversation-message-1',
  conversationMessageInserted = true,
  sourceRowId = 'source-row-5',
  normalizedId = 'normalized-5',
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
        if (
          normalized.startsWith('select 1 from import_normalized_records')
          && normalized.includes("proposed_lead_json->>'message_id'")
        ) {
          return { rows: duplicateMessage ? [{ exists: 1 }] : [] };
        }
        if (
          normalized.startsWith('select proposed_lead_json from import_normalized_records')
          && normalized.includes("proposed_lead_json->>'messenger_sender_id'")
        ) {
          return { rows: existingLead ? [{ proposed_lead_json: existingLead }] : [] };
        }
        if (
          normalized.startsWith('select l.id::text as lead_id')
          && normalized.includes("proposed_lead_json->>'messenger_sender_id'")
        ) {
          return {
            rows: existingLead
              ? [{ contact_id: existingLead.contact_id || null, lead_id: existingLead.lead_id || null }]
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
        if (normalized.startsWith('select u.id, u.name, u.email from users u')) {
          return { rows: [{ id: 'user-owner-1', name: 'Owner One', email: 'owner@example.com' }] };
        }
        if (normalized.startsWith('select id, name, email from users')) {
          return { rows: [{ id: 'user-owner-fallback', name: 'Fallback Owner', email: 'fallback@example.com' }] };
        }
        if (normalized.startsWith('insert into import_source_rows')) {
          return { rows: [{ id: sourceRowId }] };
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
        if (normalized.startsWith('insert into import_normalized_records')) {
          return { rows: [{ id: normalizedId }] };
        }
        if (normalized.startsWith('insert into import_review_items')) {
          return { rows: [] };
        }

        throw new Error('Unexpected query: ' + normalized);
      },
    },
  };
}

function metaConfig() {
  return createMetaProviderConfig({
    defaultPageAccessToken: 'page-token',
    pageBusinessUnitMapRaw: JSON.stringify({ 'page-1': 'Main Signs' }),
  });
}

test('builds stable Messenger inbound event keys', () => {
  assert.equal(
    messengerInboundEventKey(messengerFixture()),
    'facebook-messenger-message:page-1:msg-1',
  );
  assert.equal(
    messengerInboundEventKey({
      pageId: 'page-1',
      senderId: 'sender-1',
      timestamp: 1779275460000,
      text: 'fallback text',
    }),
    'facebook-messenger-fallback:page-1:sender-1:1779275460000:fallback text',
  );
});

test('uses signed Meta Page Messenger fixtures and rejects unsigned webhook bodies', () => {
  const bodyText = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: 'page-1',
        time: 1779275460,
        messaging: [
          {
            sender: { id: 'sender-1' },
            recipient: { id: 'page-1' },
            timestamp: 1779275460000,
            message: { mid: 'msg-1', text: 'Need a storefront sign' },
          },
        ],
      },
    ],
  });
  const config = createMetaProviderConfig({ appSecret: 'app-secret' });
  const signature = createHmac('sha256', config.appSecret).update(bodyText).digest('hex');

  assert.deepEqual(
    validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature}`, config }),
    { ok: true },
  );
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: '', config }).code, 'SIGNATURE_MISSING');
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature.slice(1)}`, config }).code, 'SIGNATURE_MISMATCH');

  const events = flattenMetaMessengerEvents(JSON.parse(bodyText));
  assert.equal(events.length, 1);
  assert.equal(events[0].pageId, 'page-1');
  assert.equal(events[0].senderId, 'sender-1');
});

test('ignores Page self-messages before profile fetch or audit writes', async () => {
  const { client, calls } = createServiceClient();
  let profileCalled = false;

  const result = await ingestMessengerInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [messengerFixture({ messaging: { sender: { id: 'page-1' } } })],
    metaConfig: metaConfig(),
    fetchMessengerProfile: async () => {
      profileCalled = true;
      throw new Error('Profile fetch should not run for ignored events');
    },
  });

  assert.equal(profileCalled, false);
  assert.equal(result.received, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.eventResults[0].classificationAction, 'ignore');
  assert.equal(result.eventResults[0].skippedReason, 'Ignoring Page self-message.');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into import_source_rows')), false);
});

test('skips duplicate message ids without profile fetch or import writes', async () => {
  const { client, calls } = createServiceClient({ duplicateMessage: true });
  let profileCalled = false;

  const result = await ingestMessengerInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [messengerFixture()],
    metaConfig: metaConfig(),
    fetchMessengerProfile: async () => {
      profileCalled = true;
      throw new Error('Profile fetch should not run for duplicate messages');
    },
  });

  assert.equal(profileCalled, false);
  assert.equal(result.received, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.eventResults[0].skippedReason, 'duplicate_messenger_message_id');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into import_source_rows')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into conversation_messages')), false);

  const duplicateLookup = calls.find((call) => (
    call.sql.startsWith('select 1 from import_normalized_records nr') &&
    call.sql.includes("proposed_lead_json->>'message_id'")
  ));
  assert.deepEqual(duplicateLookup.params, ['org-1', 'msg-1', 'page-1', 'bu-1']);
  assert.equal(duplicateLookup.sql.includes('join import_batches ib on ib.id = nr.import_batch_id'), true);
  assert.equal(duplicateLookup.sql.includes('ib.organization_id = $1'), true);
});

test('promotes clean Messenger messages into CRM and import audit tables', async () => {
  const { client, calls } = createServiceClient();
  const profile = { id: 'sender-1', name: 'Ada Signs', first_name: 'Ada' };

  const result = await ingestMessengerInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [messengerFixture()],
    metaConfig: metaConfig(),
    fetchMessengerProfile: async ({ senderId, pageId, config }) => {
      assert.equal(senderId, 'sender-1');
      assert.equal(pageId, 'page-1');
      assert.equal(config.defaultPageAccessToken, 'page-token');
      return { ok: true, profile };
    },
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 1);
  assert.equal(result.profileFetched, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.eventResults[0].eventKey, 'facebook-messenger-message:page-1:msg-1');
  assert.equal(result.eventResults[0].action, 'created_messenger_lead');
  assert.equal(result.eventResults[0].classificationAction, 'promote');
  assert.equal(result.eventResults[0].businessUnitId, 'bu-1');
  assert.equal(result.eventResults[0].sourceRowId, 'source-row-5');
  assert.equal(result.eventResults[0].sourceRowNumber, 5);
  assert.equal(result.eventResults[0].normalizedRecordId, 'normalized-5');
  assert.equal(result.eventResults[0].contactId, 'contact-1');
  assert.equal(result.eventResults[0].leadId, 'lead-1');
  assert.equal(result.eventResults[0].conversationId, 'conversation-1');
  assert.equal(result.eventResults[0].conversationMessageId, 'conversation-message-1');
  assert.equal(result.eventResults[0].conversationMessageInserted, true);
  assert.equal(result.eventResults[0].conversationIdempotencyKey, 'meta:messenger:page-1:msg-1');
  assert.equal(result.eventResults[0].providerConversationKey, 'org-1:meta:messenger:page-1:sender-1:sender-1');
  assert.equal(result.eventResults[0].messageText, 'Need a storefront sign');

  const sourceRowInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  assert.equal(sourceRowInsert.params[1], MESSENGER_INBOUND_SOURCE_SHEET);
  assert.equal(sourceRowInsert.params[2], 5);
  const rawValues = JSON.parse(sourceRowInsert.params[3]);
  assert.equal(rawValues.source, 'facebook_messenger');
  assert.equal(rawValues.messenger_sender_id, 'sender-1');
  assert.equal(rawValues.message_id, 'msg-1');
  assert.equal(rawValues.profile_fetch, 'ok');
  assert.deepEqual(rawValues.profile, profile);

  const contactInsert = calls.find((call) => call.sql.startsWith('insert into contacts'));
  assert.deepEqual(contactInsert.params, ['org-1', 'bu-1', 'Ada Signs']);

  const leadInsert = calls.find((call) => call.sql.startsWith('insert into leads'));
  assert.deepEqual(leadInsert.params, [
    'org-1',
    'bu-1',
    'contact-1',
    'Messenger sender_id=sender-1 page_id=page-1 source_row_id=source-row-5',
    'user-owner-1',
  ]);

  const activityInsert = calls.find((call) => (
    call.sql.startsWith('insert into activity_events') &&
    call.params[5] === MESSENGER_INBOUND_SOURCE_SHEET
  ));
  assert.equal(activityInsert.params[4], 'Need a storefront sign');
  assert.equal(activityInsert.params[5], MESSENGER_INBOUND_SOURCE_SHEET);
  assert.equal(activityInsert.params[6], 5);

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

  const conversationMessageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(conversationMessageInsert.params[0], 'conversation-1');
  assert.equal(conversationMessageInsert.params[3], 'contact-1');
  assert.equal(conversationMessageInsert.params[4], 'lead-1');
  assert.equal(conversationMessageInsert.params[5], 'messenger');
  assert.equal(conversationMessageInsert.params[7], 'inbound');
  assert.equal(conversationMessageInsert.params[8], 'received');
  assert.equal(conversationMessageInsert.params[9], 'page-1');
  assert.equal(conversationMessageInsert.params[10], 'sender-1');
  assert.equal(conversationMessageInsert.params[11], 'msg-1');
  assert.equal(conversationMessageInsert.params[12], 'meta:messenger:page-1:msg-1');
  assert.equal(conversationMessageInsert.params[15], 'Need a storefront sign');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedContact = JSON.parse(normalizedInsert.params[2]);
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedContact.contact_id, 'contact-1');
  assert.equal(proposedContact.name, 'Ada Signs');
  assert.equal(proposedLead.lead_id, 'lead-1');
  assert.equal(proposedLead.assigned_user_id, 'user-owner-1');
  assert.equal(proposedLead.first_message, 'Need a storefront sign');
  assert.equal(normalizedInsert.params[4], 0.8);
  assert.equal(normalizedInsert.params[5], 'promoted');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'Messenger message captured and linked to CRM.');
  assert.equal(reviewInsert.params[3], 'resolved');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'created_messenger_lead',
    normalizedRecordId: 'normalized-5',
    contactId: 'contact-1',
    leadId: 'lead-1',
  });
});

test('links later Messenger messages to an existing Messenger lead', async () => {
  const { client, calls } = createServiceClient({
    existingLead: { contact_id: 'contact-existing', lead_id: 'lead-existing' },
  });

  const result = await ingestMessengerInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [messengerFixture({ message: { mid: 'msg-2', text: 'Following up' } })],
    metaConfig: metaConfig(),
    fetchMessengerProfile: async () => ({ ok: true, profile: { id: 'sender-1', name: 'Ada Signs' } }),
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 0);
  assert.equal(result.linked, 1);
  assert.equal(result.eventResults[0].action, 'linked_message');
  assert.equal(result.eventResults[0].existingLead, true);
  assert.equal(result.eventResults[0].contactId, 'contact-existing');
  assert.equal(result.eventResults[0].leadId, 'lead-existing');
  assert.equal(result.eventResults[0].conversationId, 'conversation-1');
  assert.equal(result.eventResults[0].conversationMessageId, 'conversation-message-1');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);

  const existingLeadLookup = calls.find((call) => (
    call.sql.startsWith('select l.id::text as lead_id') &&
    call.sql.includes("proposed_lead_json->>'messenger_sender_id'")
  ));
  assert.deepEqual(existingLeadLookup.params, ['org-1', 'sender-1', 'page-1', 'bu-1']);
  assert.equal(existingLeadLookup.sql.includes('join import_batches ib on ib.id = nr.import_batch_id'), true);
  assert.equal(existingLeadLookup.sql.includes('l.organization_id = ib.organization_id'), true);
  assert.equal(existingLeadLookup.sql.includes('l.business_unit_id::text = $4'), true);
  assert.equal(existingLeadLookup.sql.includes('c.organization_id = ib.organization_id'), true);
  assert.equal(existingLeadLookup.sql.includes('c.primary_business_unit_id::text = $4'), true);

  const activityInsert = calls.find((call) => call.sql.startsWith('insert into activity_events'));
  assert.equal(activityInsert.params[2], 'contact-existing');
  assert.equal(activityInsert.params[3], 'lead-existing');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  assert.equal(JSON.parse(normalizedInsert.params[3]).lead_id, 'lead-existing');
  assert.equal(normalizedInsert.params[5], 'promoted');

  const conversationMessageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(conversationMessageInsert.params[3], 'contact-existing');
  assert.equal(conversationMessageInsert.params[4], 'lead-existing');
  assert.equal(conversationMessageInsert.params[11], 'msg-2');
});

test('records spam review and profile fetch failures without creating CRM rows', async () => {
  const { client, calls } = createServiceClient();

  const result = await ingestMessengerInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [messengerFixture({ message: { mid: 'msg-spam', text: 'crypto investment opportunity t.me/spam' } })],
    metaConfig: metaConfig(),
    fetchMessengerProfile: async () => ({
      ok: false,
      code: 'GRAPH_RESPONSE_ERROR',
      reason: 'Invalid page token',
      graphStatus: 400,
      graphError: { message: 'Invalid page token' },
    }),
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 0);
  assert.equal(result.review, 1);
  assert.equal(result.profileFetched, 0);
  assert.equal(result.eventResults[0].classificationAction, 'review');
  assert.equal(result.eventResults[0].classificationReason, 'Message matched basic spam filter.');
  assert.equal(result.eventResults[0].profileFetchReason, 'Invalid page token');
  assert.equal(result.eventResults[0].review, true);
  assert.equal(result.eventResults[0].conversationId, 'conversation-1');
  assert.equal(result.eventResults[0].conversationMessageId, 'conversation-message-1');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into activity_events')), false);

  const sourceRowInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  const rawValues = JSON.parse(sourceRowInsert.params[3]);
  assert.equal(rawValues.profile_fetch, 'failed');
  assert.equal(rawValues.profile_fetch_reason, 'Invalid page token');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedLead.lead_id, null);
  assert.equal(proposedLead.notes, 'Messenger message captured but needs review: Message matched basic spam filter.');
  assert.equal(normalizedInsert.params[4], 0.3);
  assert.equal(normalizedInsert.params[5], 'needs_review');

  const conversationMessageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(conversationMessageInsert.params[3], null);
  assert.equal(conversationMessageInsert.params[4], null);
  assert.equal(conversationMessageInsert.params[12], 'meta:messenger:page-1:msg-spam');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'Messenger message needs review: Message matched basic spam filter..');
  assert.equal(reviewInsert.params[3], 'pending');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'review_messenger_message',
    normalizedRecordId: 'normalized-5',
    contactId: null,
    leadId: null,
  });
});
