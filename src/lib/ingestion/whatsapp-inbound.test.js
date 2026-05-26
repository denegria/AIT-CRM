import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  WHATSAPP_INBOUND_SOURCE_SHEET,
  ingestWhatsAppInboundEvents,
  normalizeWhatsAppPhoneIdentity,
  whatsappInboundEventKey,
} from './whatsapp-inbound.js';
import {
  createMetaProviderConfig,
  flattenMetaWhatsAppMessages,
  validateMetaAppSecretSignature,
} from '../messaging/providers/meta.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function whatsappFixture(overrides = {}) {
  const message = {
    from: '15550001111',
    id: 'wamid-1',
    timestamp: '1779275460',
    type: 'text',
    text: { body: 'Need a storefront sign' },
    ...overrides.message,
  };
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: overrides.entryId || 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+1 555 111 2222',
                phone_number_id: 'phone-number-1',
                ...overrides.metadata,
              },
              contacts: [
                {
                  profile: { name: 'Ada Signs' },
                  wa_id: '15550001111',
                  ...overrides.contact,
                },
              ],
              messages: [message],
              ...overrides.value,
            },
          },
        ],
      },
    ],
  };

  return flattenMetaWhatsAppMessages(payload)[0];
}

function createServiceClient({
  duplicateMessage = false,
  existingConversation = null,
  existingContact = null,
  businessUnitId = 'bu-1',
  channelId = null,
  channelBusinessUnitId = null,
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
          && normalized.includes("channel = 'whatsapp'")
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
    whatsappBusinessUnitMapRaw: JSON.stringify({ 'phone-number-1': 'Main Signs' }),
  });
}

test('builds stable WhatsApp inbound event keys and phone identities', () => {
  assert.equal(
    whatsappInboundEventKey(whatsappFixture()),
    'whatsapp-message:phone-number-1:wamid-1',
  );
  assert.equal(
    whatsappInboundEventKey({
      phoneNumberId: 'phone-number-1',
      waId: '15550001111',
      timestamp: '1779275460',
      messageType: 'text',
      text: 'fallback text',
    }),
    'whatsapp-fallback:phone-number-1:15550001111:1779275460:text:fallback text',
  );
  assert.equal(normalizeWhatsAppPhoneIdentity('+1 (555) 000-1111'), '15550001111');
});

test('uses signed WhatsApp Cloud API fixtures and rejects unsigned webhook bodies', () => {
  const bodyText = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'phone-number-1' },
              contacts: [{ profile: { name: 'Ada Signs' }, wa_id: '15550001111' }],
              messages: [{ from: '15550001111', id: 'wamid-1', timestamp: '1779275460', type: 'text', text: { body: 'Hi' } }],
            },
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

  const events = flattenMetaWhatsAppMessages(JSON.parse(bodyText));
  assert.equal(events.length, 1);
  assert.equal(events[0].phoneNumberId, 'phone-number-1');
  assert.equal(events[0].waId, '15550001111');
});

test('skips duplicate WhatsApp message ids without import or CRM writes', async () => {
  const { client, calls } = createServiceClient({ duplicateMessage: true });

  const result = await ingestWhatsAppInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [whatsappFixture()],
    metaConfig: metaConfig(),
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.eventResults[0].skippedReason, 'duplicate_whatsapp_message_id');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into import_source_rows')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into conversation_messages')), false);

  const duplicateLookup = calls.find((call) => (
    call.sql.startsWith('select 1 from conversation_messages') &&
    call.sql.includes("channel = 'whatsapp'")
  ));
  assert.deepEqual(duplicateLookup.params, ['org-1', 'phone-number-1', 'wamid-1']);
  assert.equal(duplicateLookup.sql.includes('organization_id = $1'), true);
  assert.equal(duplicateLookup.sql.includes('provider_account_id = $2'), true);
  assert.equal(duplicateLookup.sql.includes('external_message_id = $3'), true);
  assert.equal(duplicateLookup.sql.includes('business_unit_id'), false);
});

test('promotes clean WhatsApp messages into CRM and conversation tables', async () => {
  const { client, calls } = createServiceClient();

  const result = await ingestWhatsAppInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [whatsappFixture()],
    metaConfig: metaConfig(),
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 1);
  assert.equal(result.linked, 0);
  assert.equal(result.review, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.eventResults[0].eventKey, 'whatsapp-message:phone-number-1:wamid-1');
  assert.equal(result.eventResults[0].action, 'created_whatsapp_lead');
  assert.equal(result.eventResults[0].classificationAction, 'promote');
  assert.equal(result.eventResults[0].businessUnitId, 'bu-1');
  assert.equal(result.eventResults[0].sourceRowNumber, 5);
  assert.equal(result.eventResults[0].contactId, 'contact-1');
  assert.equal(result.eventResults[0].leadId, 'lead-1');
  assert.equal(result.eventResults[0].conversationIdempotencyKey, 'meta:whatsapp:phone-number-1:wamid-1');
  assert.equal(result.eventResults[0].providerConversationKey, 'org-1:meta:whatsapp:phone-number-1:15550001111:15550001111');

  const sourceRowInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  assert.equal(sourceRowInsert.params[1], WHATSAPP_INBOUND_SOURCE_SHEET);
  assert.equal(sourceRowInsert.params[2], 5);
  const rawValues = JSON.parse(sourceRowInsert.params[3]);
  assert.equal(rawValues.source, 'whatsapp_inbound');
  assert.equal(rawValues.whatsapp_wa_id, '15550001111');
  assert.equal(rawValues.phone_number_id, 'phone-number-1');
  assert.equal(rawValues.message_id, 'wamid-1');

  const contactInsert = calls.find((call) => call.sql.startsWith('insert into contacts'));
  assert.deepEqual(contactInsert.params, ['org-1', 'bu-1', 'Ada Signs', '+15550001111']);

  const leadInsert = calls.find((call) => call.sql.startsWith('insert into leads'));
  assert.deepEqual(leadInsert.params, [
    'org-1',
    'bu-1',
    'contact-1',
    'WhatsApp wa_id=15550001111 phone_number_id=phone-number-1 source_row_id=source-row-5',
    'user-owner-1',
  ]);

  const activityInsert = calls.find((call) => (
    call.sql.startsWith('insert into activity_events') &&
    call.params[5] === WHATSAPP_INBOUND_SOURCE_SHEET
  ));
  assert.equal(activityInsert.params[4], 'Need a storefront sign');
  assert.equal(activityInsert.params[5], WHATSAPP_INBOUND_SOURCE_SHEET);
  assert.equal(activityInsert.params[6], 5);

  const conversationInsert = calls.find((call) => call.sql.startsWith('insert into conversations'));
  assert.deepEqual(conversationInsert.params.slice(0, 12), [
    'org-1',
    'bu-1',
    'contact-1',
    'lead-1',
    null,
    'whatsapp',
    'meta',
    'phone-number-1',
    '15550001111',
    '15550001111',
    'open',
    new Date(1779275460000),
  ]);

  const conversationMessageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(conversationMessageInsert.params[0], 'conversation-1');
  assert.equal(conversationMessageInsert.params[3], 'contact-1');
  assert.equal(conversationMessageInsert.params[4], 'lead-1');
  assert.equal(conversationMessageInsert.params[5], 'whatsapp');
  assert.equal(conversationMessageInsert.params[7], 'inbound');
  assert.equal(conversationMessageInsert.params[8], 'received');
  assert.equal(conversationMessageInsert.params[9], 'phone-number-1');
  assert.equal(conversationMessageInsert.params[10], '15550001111');
  assert.equal(conversationMessageInsert.params[11], 'wamid-1');
  assert.equal(conversationMessageInsert.params[12], 'meta:whatsapp:phone-number-1:wamid-1');
  assert.equal(conversationMessageInsert.params[15], 'Need a storefront sign');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedContact = JSON.parse(normalizedInsert.params[2]);
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedContact.phone, '+15550001111');
  assert.equal(proposedContact.contact_id, 'contact-1');
  assert.equal(proposedLead.lead_id, 'lead-1');
  assert.equal(proposedLead.assigned_user_id, 'user-owner-1');
  assert.equal(proposedLead.first_message, 'Need a storefront sign');
  assert.equal(normalizedInsert.params[4], 0.8);
  assert.equal(normalizedInsert.params[5], 'promoted');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'WhatsApp message captured and linked to CRM.');
  assert.equal(reviewInsert.params[3], 'resolved');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'created_whatsapp_lead',
    normalizedRecordId: 'normalized-5',
    contactId: 'contact-1',
    leadId: 'lead-1',
  });
});

test('links later WhatsApp messages by phone identity with org and business-unit scoping', async () => {
  const { client, calls } = createServiceClient({
    existingContact: { contact_id: 'contact-existing', lead_id: 'lead-existing' },
  });

  const result = await ingestWhatsAppInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [whatsappFixture({ message: { id: 'wamid-2', text: { body: 'Following up' } } })],
    metaConfig: metaConfig(),
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 0);
  assert.equal(result.linked, 1);
  assert.equal(result.review, 0);
  assert.equal(result.eventResults[0].action, 'linked_message');
  assert.equal(result.eventResults[0].existingLead, true);
  assert.equal(result.eventResults[0].contactId, 'contact-existing');
  assert.equal(result.eventResults[0].leadId, 'lead-existing');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);

  const contactLookup = calls.find((call) => (
    call.sql.startsWith('select c.id::text as contact_id') &&
    call.sql.includes('from contacts c')
  ));
  assert.deepEqual(contactLookup.params, ['org-1', '15550001111', 'bu-1']);
  assert.equal(contactLookup.sql.includes('c.organization_id = $1'), true);
  assert.equal(contactLookup.sql.includes('c.primary_business_unit_id::text = $3'), true);
  assert.equal(contactLookup.sql.includes('l.organization_id = c.organization_id'), true);
  assert.equal(contactLookup.sql.includes('l.business_unit_id::text = $3'), true);

  const conversationMessageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(conversationMessageInsert.params[3], 'contact-existing');
  assert.equal(conversationMessageInsert.params[4], 'lead-existing');
  assert.equal(conversationMessageInsert.params[11], 'wamid-2');
});

test('routes WhatsApp messages through active conversation channel configuration', async () => {
  const { client } = createServiceClient({
    channelId: 'channel-1',
    channelBusinessUnitId: 'bu-channel',
    businessUnitId: 'bu-fallback',
  });

  const result = await ingestWhatsAppInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [whatsappFixture()],
    metaConfig: metaConfig(),
  });

  assert.equal(result.eventResults[0].businessUnitId, 'bu-channel');
  assert.equal(result.eventResults[0].channelId, 'channel-1');
});

test('records unsupported WhatsApp messages for review without creating CRM rows', async () => {
  const { client, calls } = createServiceClient();

  const result = await ingestWhatsAppInboundEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [whatsappFixture({
      message: {
        id: 'wamid-image',
        type: 'image',
        text: undefined,
        image: { id: 'media-1', mime_type: 'image/jpeg', sha256: 'sha' },
      },
    })],
    metaConfig: metaConfig(),
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 0);
  assert.equal(result.review, 1);
  assert.equal(result.eventResults[0].classificationAction, 'review');
  assert.equal(result.eventResults[0].classificationReason, 'WhatsApp image message requires review.');
  assert.equal(result.eventResults[0].conversationId, 'conversation-1');
  assert.equal(result.eventResults[0].conversationMessageId, 'conversation-message-1');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => (
    call.sql.startsWith('insert into activity_events') &&
    call.params[5] === WHATSAPP_INBOUND_SOURCE_SHEET
  )), false);

  const sourceRowInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  const rawValues = JSON.parse(sourceRowInsert.params[3]);
  assert.equal(rawValues.message_type, 'image');
  assert.equal(rawValues.attachments[0].id, 'media-1');

  const conversationMessageInsert = calls.find((call) => call.sql.startsWith('insert into conversation_messages'));
  assert.equal(conversationMessageInsert.params[3], null);
  assert.equal(conversationMessageInsert.params[4], null);
  assert.equal(conversationMessageInsert.params[12], 'meta:whatsapp:phone-number-1:wamid-image');
  assert.equal(conversationMessageInsert.params[15], '[WhatsApp image]');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedLead.lead_id, null);
  assert.equal(proposedLead.notes, 'WhatsApp message captured but needs review: WhatsApp image message requires review.');
  assert.equal(normalizedInsert.params[4], 0.3);
  assert.equal(normalizedInsert.params[5], 'needs_review');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'WhatsApp message needs review: WhatsApp image message requires review..');
  assert.equal(reviewInsert.params[3], 'pending');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'review_whatsapp_message',
    normalizedRecordId: 'normalized-5',
    contactId: null,
    leadId: null,
  });
});
